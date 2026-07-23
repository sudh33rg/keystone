import { createHash } from "node:crypto";
import type { IntelligenceRelationshipRecord, IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type { IntelligenceCanvasEdge, IntelligenceCanvasNode, IntelligenceGraphSlice } from "../../shared/contracts/intelligenceCanvas";
import type { QaChangeSet, QaChangedEntity, QaCoverageGap, QaImpactAnalysis, QaChangeImpact, QaTestMapping } from "../../shared/contracts/impactQa";

export class ImpactAnalysisService {
  constructor(private readonly snapshot: IntelligenceSnapshot, private readonly now = () => new Date().toISOString()) {}
  analyze(input: { workflowId: string; changeSet: QaChangeSet; changedEntities: QaChangedEntity[]; intelligenceRevision: string; depth: number; maxNodes: number; maxEdges: number }): QaImpactAnalysis {
    if (input.depth < 1 || input.depth > 3 || input.maxNodes < 1 || input.maxNodes > 200 || input.maxEdges < 1 || input.maxEdges > 400) throw new Error("Impact bounds are invalid.");
    const roots = input.changedEntities.flatMap((item) => item.entityId ? [item.entityId] : []);
    const impacts: QaChangeImpact[] = [];
    const included = new Set(roots); const edgeIds = new Set<string>(); const queue = roots.map((id) => ({ id, root: id, distance: 0, path: [] as string[] }));
    while (queue.length && included.size < input.maxNodes && edgeIds.size < input.maxEdges) {
      const current = queue.shift()!; if (current.distance >= input.depth) continue;
      const adjacent: Array<{ edge: IntelligenceRelationshipRecord; entityId: string; direction: "incoming" | "outgoing" }> = [];
      for (const edge of this.snapshot.relationships) {
        if (!allowed(edge.type)) continue;
        if (edge.targetId === current.id) adjacent.push({ edge, entityId: edge.sourceId, direction: "incoming" });
        else if (edge.sourceId === current.id) adjacent.push({ edge, entityId: edge.targetId, direction: "outgoing" });
      }
      for (const { edge, entityId, direction } of adjacent) {
        if (edgeIds.size >= input.maxEdges || included.size >= input.maxNodes) break;
        const entity = entityById(this.snapshot, entityId); if (!entity) continue;
        const file = fileFor(this.snapshot, entity.id); const isTest = Boolean(file?.isTest || file?.category === "test");
        const distance = current.distance + 1; const path = [...current.path, edge.id];
        edgeIds.add(edge.id); included.add(entity.id);
        if (!impacts.some((item) => item.entityId === entity.id && item.changedRootId === current.root)) impacts.push({ id: `impact:${current.root}:${entity.id}`, changedRootId: current.root, entityId: entity.id, label: label(entity), filePath: file?.relativePath, category: isTest ? "test" : flowEntity(entity) ? "affected-flow" : publicEntity(this.snapshot, entity.id) ? "contract" : distance === 1 ? direction === "outgoing" || edge.type.toLowerCase().includes("depend") || edge.type.toLowerCase().includes("import") ? "direct-dependent" : "direct-caller" : "transitive-dependent", relationshipPath: path, distance, confidence: edge.confidence, inferred: !["exact", "compiler", "framework"].includes(edge.resolution ?? "unresolved"), evidenceIds: edge.evidenceIds, reason: `${label(entity)} is connected to the changed root by ${edge.type} (${direction}) at distance ${distance}.` });
        if (!isTest && distance < input.depth) queue.push({ id: entity.id, root: current.root, distance, path });
      }
    }
    const impactedIds = new Set([...roots, ...impacts.map((item) => item.entityId)]);
    const mappedTests = testMappings(this.snapshot, impactedIds, impacts);
    const covered = new Set(mappedTests.map((item) => item.productionEntityId));
    const gaps: QaCoverageGap[] = roots.filter((id) => !covered.has(id)).map((id) => ({ id: `gap:${id}`, entityId: id, reason: "Changed production entity has no evidence-backed mapped test.", confidence: 1, recommendedTestLayer: "unit", blocking: publicEntity(this.snapshot, id) }));
    const affectedFlows = [...impacts.filter((item) => flowEntity(entityById(this.snapshot, item.entityId))).map((item) => item.entityId)];
    const contracts = [...new Set([...roots, ...impacts.map((item) => item.entityId)].filter((id) => publicEntity(this.snapshot, id)))];
    const riskFactors: QaImpactAnalysis["risk"]["factors"] = [];
    if (contracts.length) riskFactors.push({ id: "public-contract", description: `${contracts.length} changed public or exported contract(s).`, evidenceIds: contracts.flatMap((id) => entityById(this.snapshot, id)?.evidenceIds ?? []) });
    if (gaps.length) riskFactors.push({ id: "coverage-gap", description: `${gaps.length} changed entity or entities have no mapped test.`, evidenceIds: [] });
    if (impacts.filter((item) => item.distance === 1 && item.category !== "test").length >= 3) riskFactors.push({ id: "many-dependents", description: "The change has at least three direct production dependents.", evidenceIds: impacts.filter((item) => item.distance === 1).flatMap((item) => item.evidenceIds) });
    if (input.changedEntities.some((item) => item.changeType === "removed" || item.changeType === "signature-changed")) riskFactors.push({ id: "breaking-shape", description: "A symbol was removed or its signature changed.", evidenceIds: input.changedEntities.flatMap((item) => item.evidenceIds) });
    const persistenceImpacts = impacts.filter((item) => persistenceEntity(entityById(this.snapshot, item.entityId)));
    if (persistenceImpacts.length) riskFactors.push({ id: "persistence-interaction", description: `${persistenceImpacts.length} evidence-backed persistence interaction(s) are affected.`, evidenceIds: persistenceImpacts.flatMap((item) => item.evidenceIds) });
    if (affectedFlows.length) riskFactors.push({ id: "affected-flow", description: `${affectedFlows.length} entry-point flow(s) are affected.`, evidenceIds: impacts.filter((item) => affectedFlows.includes(item.entityId)).flatMap((item) => item.evidenceIds) });
    const graph = graphSlice(this.snapshot, roots, included, edgeIds, input);
    const createdAt = this.now(); const contentHash = sha({ change: input.changeSet.contentHash, revision: input.intelligenceRevision, impacts: impacts.map((item) => item.id), tests: mappedTests.map((item) => item.id), gaps: gaps.map((item) => item.id) });
    return { id: crypto.randomUUID(), workflowId: input.workflowId, changeSetId: input.changeSet.id, intelligenceRevision: input.intelligenceRevision, changedEntityIds: roots, impacts, affectedFlowIds: [...new Set(affectedFlows)], affectedContractIds: contracts, mappedTests, coverageGaps: gaps, graph, risk: { level: riskFactors.some((item) => item.id === "breaking-shape" || item.id === "public-contract" && gaps.length) ? "high" : riskFactors.length ? "medium" : "low", factors: riskFactors }, status: "ready-for-review", createdAt, contentHash, summary: impacts.length ? `${impacts.length} evidence-backed impact${impacts.length === 1 ? "" : "s"} from ${roots.length} changed root${roots.length === 1 ? "" : "s"}.` : "No evidence-backed downstream impact was found within the configured bounds." };
  }
}
function allowed(type: string): boolean { return /(calls|imports|depends|references|implements|extends|routes|publishes|subscribes)/i.test(type); }
function entityById(snapshot: IntelligenceSnapshot, id: string) { return snapshot.symbols.find((item) => item.id === id) ?? snapshot.files.find((item) => item.id === id); }
function fileFor(snapshot: IntelligenceSnapshot, id: string) { const entity = entityById(snapshot, id); return entity && "fileId" in entity ? snapshot.files.find((item) => item.id === entity.fileId) : snapshot.files.find((item) => item.id === id); }
function label(entity: ReturnType<typeof entityById>): string { return entity && "name" in entity ? entity.name : entity && "relativePath" in entity ? entity.relativePath : "Unknown"; }
function publicEntity(snapshot: IntelligenceSnapshot, id: string): boolean { const symbol = snapshot.symbols.find((item) => item.id === id); return Boolean(symbol?.exported || symbol?.visibility === "public" || symbol?.properties?.isRoute); }
function flowEntity(entity: ReturnType<typeof entityById>): boolean { return Boolean(entity && "properties" in entity && (entity.properties?.isEntryPoint || entity.properties?.isRoute)); }
function persistenceEntity(entity: ReturnType<typeof entityById>): boolean { return Boolean(entity && "properties" in entity && entity.properties?.isPersistence); }
function testMappings(snapshot: IntelligenceSnapshot, impacted: Set<string>, impacts: QaChangeImpact[]): QaTestMapping[] { const out: QaTestMapping[] = []; for (const edge of snapshot.relationships) { if (!impacted.has(edge.targetId)) continue; const file = fileFor(snapshot, edge.sourceId); if (!file?.isTest && file?.category !== "test") continue; out.push({ id: `mapping:${edge.id}`, productionEntityId: edge.targetId, testEntityId: edge.sourceId, testFilePath: file.relativePath, mappingType: /import/i.test(edge.type) ? "import" : /reference/i.test(edge.type) ? "symbol-reference" : "call", confidence: edge.confidence, evidenceIds: edge.evidenceIds, distance: impacts.find((item) => item.entityId === edge.targetId)?.distance ?? 0 }); } return [...new Map(out.map((item) => [`${item.testFilePath}:${item.productionEntityId}`, item])).values()]; }
function graphSlice(snapshot: IntelligenceSnapshot, roots: string[], included: Set<string>, edges: Set<string>, input: { depth: number; maxNodes: number; maxEdges: number; intelligenceRevision: string }): IntelligenceGraphSlice { const nodes: IntelligenceCanvasNode[] = [...included].map((id) => { const entity = entityById(snapshot, id)!; const file = fileFor(snapshot, id); const isSymbol = "range" in entity; return { id, label: label(entity), qualifiedLabel: "qualifiedName" in entity ? entity.qualifiedName || label(entity) : label(entity), kind: file?.isTest ? "test" : "relativePath" in entity ? "file" : /class/i.test(String(entity.type)) ? "class" : /method/i.test(String(entity.type)) ? "method" : /function/i.test(String(entity.type)) ? "function" : "unknown", filePath: file?.relativePath ?? "", ...(isSymbol ? { range: { startLine: entity.range.startLine, startColumn: entity.range.startColumn, endLine: entity.range.endLine, endColumn: entity.range.endColumn } } : {}), confidence: "confidence" in entity ? entity.confidence : 1, inferred: false, expandable: { inbound: true, outbound: true } }; }); const graphEdges: IntelligenceCanvasEdge[] = snapshot.relationships.filter((item) => edges.has(item.id)).map((item) => ({ id: item.id, sourceId: item.sourceId, targetId: item.targetId, relationshipType: normalizeRelationship(item.type), label: item.type, confidence: item.confidence, inferred: !["exact", "compiler", "framework"].includes(item.resolution ?? "unresolved"), evidenceIds: item.evidenceIds })); const truncated = included.size >= input.maxNodes || edges.size >= input.maxEdges; return { rootEntityIds: roots, nodes, edges: graphEdges, request: { mode: "calls", direction: "inbound", depth: input.depth, relationshipTypes: ["calls", "imports", "depends-on"], maxNodes: input.maxNodes, maxEdges: input.maxEdges, minimumConfidence: 0 }, truncation: { truncated, nodeLimitReached: included.size >= input.maxNodes, edgeLimitReached: edges.size >= input.maxEdges, expandableEntityIds: truncated ? [...included] : [] }, intelligenceRevision: input.intelligenceRevision }; }
function normalizeRelationship(type: string): IntelligenceCanvasEdge["relationshipType"] { const value = type.toLowerCase().replace(/_/g, "-").replace(/^keystone\.core\./, ""); return value === "depends-on" || value === "imports" || value === "calls" ? value : "unknown"; }
function sha(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
