import { createHash, randomUUID } from "node:crypto";
import {
  CONTEXT_PACKAGE_SCHEMA_VERSION,
  ContextPackageSchema,
  type ContextExclusion,
  type ContextItem,
  type ContextPackage,
  type ContextSection,
  type RequiredFact,
  type StageContextProfile,
} from "../../shared/contracts/contextPackage";
import type { ContextPersistenceStore } from "./ContextPersistenceStore";
import { ContextDeduplicator } from "./ContextDeduplicator";
import { ContextCompressionService } from "./ContextCompressionService";
import { TokenBudgetOptimizer } from "./TokenBudgetOptimizer";
import { TokenCounterRegistry } from "./TokenCounterRegistry";

export interface DevelopmentContextBuildInput {
  workflowId: string; stageId: string; workItemId: string; executionProfileId: string;
  intent: string; workType: string; specification?: string; objective: string;
  objectiveRevision: number; specificationRevision?: number; budgetTokens: number; pinnedItemIds: string[];
  notes?: string;
  scope: Array<{ id: string; kind: "file" | "symbol"; workspaceRelativePath: string; content: string; symbol?: { entityId: string; name: string; kind: string; range?: { startLine: number; endLine: number } } }>;
  intelligenceSelections?: Array<{ id: string; kind: "call-flow"; label: string; entityIds: string[]; edgeIds: string[]; evidenceIds: string[]; intelligenceRevision: string; content: string }>;
  skill: { id: string; name: string; content: string; contentHash: string };
  instructions: Array<{ id: string; name: string; path: string; content: string; contentHash: string }>;
}

export class DevelopmentContextPackageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DevelopmentContextPackageError"; }
}

/** Development-stage adapter over Keystone's canonical context-compression primitives. */
export class DevelopmentContextPackageService {
  private readonly registry = new TokenCounterRegistry();
  private readonly deduplicator = new ContextDeduplicator();
  private readonly compressor = new ContextCompressionService();
  private readonly optimizer = new TokenBudgetOptimizer();

  constructor(private readonly store: ContextPersistenceStore, private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID) {}

  async build(input: DevelopmentContextBuildInput): Promise<ContextPackage> {
    const previous = this.store.getByWorkItem(input.workItemId);
    const started = Date.now();
    const { counter, warning } = this.registry.resolveSafe();
    const tokenizer = counter.info();
    const rawItems = this.rawItems(input, counter);
    const rawBaselineTokens = counter.countSections(rawItems.map((item) => item.content));
    const overlap = mergeOverlappingSymbols(rawItems, counter);
    const deduped = this.deduplicator.deduplicate(overlap.items);
    const compressed = this.compressor.compress(deduped.items, developmentProfile(input.budgetTokens), counter);
    const instructionTokens = counter.countSections(input.instructions.map((item) => item.content));
    const skillTokens = counter.count(input.skill.content);
    const specificationTokens = counter.count(input.specification ?? "");
    const reservedOutputTokens = Math.min(2_000, Math.max(400, Math.round(input.budgetTokens * 0.2)));
    const budget = { requestedTokens: input.budgetTokens, reservedInstructionTokens: instructionTokens, reservedOutputTokens, availableContextTokens: Math.max(0, input.budgetTokens - instructionTokens - reservedOutputTokens - skillTokens), tokenizerId: tokenizer.id };
    const optimized = this.optimizer.optimize({ items: compressed.items, budget, reservedSectionTokens: { contract: 80, skills: skillTokens, instructions: instructionTokens, specification: 0 }, pinnedIds: input.pinnedItemIds, counter });
    const exclusions: ContextExclusion[] = [...overlap.exclusions, ...deduped.exclusions, ...optimized.excluded.map((entry) => ({ ...entry, reason: "over-budget" as const }))];
    const facts = requiredFacts(input, optimized.included);
    const criticalMissing = facts.some((fact) => fact.critical && fact.state !== "satisfied");
    const blocked = optimized.impossible || criticalMissing;
    const compressedTokens = optimized.included.reduce((sum, item) => sum + item.tokenCount, 0);
    const reductionTokens = Math.max(0, rawBaselineTokens - compressedTokens);
    const reductionPercentage = rawBaselineTokens ? Math.min(100, (reductionTokens / rawBaselineTokens) * 100) : 0;
    const timestamp = this.now();
    const contentHash = hash({ input: inputFingerprint(input), items: optimized.included.map((item) => [item.id, item.compressedContentHash, item.pinned]), exclusions: exclusions.map((item) => [item.item.id, item.reason]), budget });
    const sections = buildSections(optimized.included, compressed.summarizedItemIds);
    const satisfied = facts.filter((fact) => fact.state === "satisfied").length;
    const packageValue: ContextPackage = ContextPackageSchema.parse({
      schemaVersion: CONTEXT_PACKAGE_SCHEMA_VERSION, id: this.createId(), contentFingerprint: contentHash,
      workflowId: input.workflowId, stageId: input.stageId, workItemId: input.workItemId, executionProfileId: input.executionProfileId,
      sourceSnapshot: { intelligenceRevision: `development-objective:${input.objectiveRevision}`, specificationRevision: String(input.specificationRevision ?? 0), instructionRevisionHash: hash(input.instructions.map((item) => item.contentHash)), workspaceRevision: inputFingerprint(input), createdAt: timestamp },
      budget,
      rawBaseline: { candidateCount: rawItems.length, sourceCount: rawItems.length, tokenCount: rawBaselineTokens, byteCount: rawItems.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), tokensBySourceType: tokenGroups(rawItems), tokenizer, sources: baselineSources(input) },
      compressed: { itemCount: optimized.included.length, tokenCount: compressedTokens, byteCount: optimized.included.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), reductionTokens, reductionPercentage },
      coverage: { requiredFacts: facts.length, retainedRequiredFacts: satisfied, unresolvedRequiredFacts: facts.filter((fact) => fact.state !== "satisfied").map((fact) => fact.id), completenessScore: facts.length ? satisfied / facts.length : 1, confidence: facts.length ? satisfied / facts.length : 1 },
      requiredFacts: facts, sections, exclusions,
      warnings: [...(warning ? [{ code: "tokenizer-approximation", severity: "warning" as const, message: warning }] : []), ...optimized.warnings, ...(criticalMissing ? [{ code: "context-incomplete", severity: "error" as const, message: "Critical required context is missing or partial. Approval is blocked." }] : [])],
      items: optimized.included, renderedPrompt: "", completePromptTokens: compressedTokens + instructionTokens + skillTokens,
      metrics: { rawBaselineTokens, compressedContextTokens: compressedTokens, completePromptTokens: compressedTokens + instructionTokens + skillTokens, outputTokenReservation: reservedOutputTokens, tokensRemoved: reductionTokens, reductionPercentage, candidateCount: rawItems.length, retainedItemCount: optimized.included.length, summarizedItemCount: compressed.summarizedItemIds.length, excludedItemCount: exclusions.length, duplicateTokensRemoved: deduped.duplicateTokensRemoved, structuralCompressionSavings: compressed.structuralSavings, instructionTokens, skillTokens, specificationTokens, repositoryIntelligenceTokens: optimized.included.filter((item) => item.sourceType === "repository-file" || item.sourceType === "symbol" || item.sourceType === "call-flow").reduce((sum, item) => sum + item.tokenCount, 0), completenessScore: facts.length ? satisfied / facts.length : 1, compressionConfidence: tokenizer.confidence, tokenizerId: tokenizer.id, tokenizerMeasurement: tokenizer.measurement, buildDurationMs: Date.now() - started },
      metadata: { status: blocked ? "blocked" : "ready", createdAt: timestamp, updatedAt: timestamp, contentHash, version: 1 },
    });
    if (previous) await this.store.supersede(previous.id, packageValue.id);
    return this.store.upsert(packageValue);
  }

  get(workItemId: string): ContextPackage | undefined { return this.store.getByWorkItem(workItemId); }
  async ensureFresh(input: DevelopmentContextBuildInput): Promise<boolean> { const pkg = this.store.getByWorkItem(input.workItemId); if (!pkg) return false; if (pkg.sourceSnapshot.workspaceRevision !== inputFingerprint(input)) { const all = [...pkg.items, ...pkg.exclusions.map((entry) => entry.item)]; const changedSource = input.scope.find((scope) => { const stored = all.find((item) => item.id === `scope:${scope.id}`); return !stored || stored.rawContentHash !== hash(scope.content); }); const changedInstruction = input.instructions.find((instruction) => { const stored = all.find((item) => item.id === `instruction:${instruction.id}`); return !stored || stored.rawContentHash !== hash(instruction.content); }); const storedSkill = all.find((item) => item.id === `skill:${input.skill.id}`); const reason = changedSource ? `Selected source changed: ${changedSource.workspaceRelativePath}.` : changedInstruction ? `Instruction content changed: ${changedInstruction.path}.` : !storedSkill || storedSkill.rawContentHash !== hash(input.skill.content) ? `Skill content changed: ${input.skill.name}.` : "A persisted workflow input, budget, or user note changed."; await this.invalidate(input.workItemId, reason); return false; } return pkg.metadata.status !== "stale"; }

  async approve(workItemId: string, packageId: string, revision: number, fingerprint: string): Promise<ContextPackage> {
    const pkg = this.requireCurrent(workItemId, packageId);
    if (pkg.metadata.version !== revision) throw new DevelopmentContextPackageError("package-revision-conflict", "Context revision conflict. Reload the current package and try again.");
    if (pkg.metadata.contentHash !== fingerprint) throw new DevelopmentContextPackageError("package-revision-conflict", "Context fingerprint changed. Regenerate and review the current package.");
    if (pkg.metadata.status === "blocked") throw new DevelopmentContextPackageError("package-incomplete", "Blocked context cannot be approved. Resolve missing critical facts or increase the token budget.");
    if (pkg.metadata.status === "stale") throw new DevelopmentContextPackageError("package-stale", "Stale context cannot be approved. Regenerate the package.");
    if (pkg.metadata.status === "approved") throw new DevelopmentContextPackageError("package-revision-conflict", "Context revision conflict. This revision is already approved.");
    return this.store.upsert({ ...pkg, metadata: { ...pkg.metadata, status: "approved", approvedAt: this.now(), updatedAt: this.now() } });
  }

  async changeBudget(input: DevelopmentContextBuildInput, packageId: string, revision: number, budgetTokens: number): Promise<ContextPackage> {
    const pkg = this.requireCurrent(input.workItemId, packageId);
    if (pkg.metadata.version !== revision) throw new DevelopmentContextPackageError("package-revision-conflict", "Context revision conflict. Reload the current package and try again.");
    return this.build({ ...input, budgetTokens });
  }

  async pin(workItemId: string, packageId: string, revision: number, itemId: string, pinned: boolean): Promise<ContextPackage> {
    const pkg = this.assertEditable(workItemId, packageId, revision);
    const items = pkg.items.map((item) => item.id === itemId ? { ...item, pinned, reasons: [...new Set([...item.reasons, pinned ? "Pinned by the user." : "User pin removed."])] } : item);
    return this.persistMutation(pkg, items, pkg.exclusions);
  }

  async remove(workItemId: string, packageId: string, revision: number, itemId: string, overrideRequired: boolean): Promise<ContextPackage> {
    const pkg = this.assertEditable(workItemId, packageId, revision); const item = pkg.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new DevelopmentContextPackageError("context-item-not-found", "The selected context item was not found in this revision.");
    if (item.importance === "required" && !overrideRequired) throw new DevelopmentContextPackageError("context-required-removal", "Required context needs an explicit warning override before removal.");
    return this.persistMutation(pkg, pkg.items.filter((candidate) => candidate.id !== itemId), [...pkg.exclusions, { item, reason: "user-removed", tokensRemoved: item.tokenCount, restorable: true, detail: overrideRequired ? "Required context removed with explicit warning override." : "Removed by the user." }]);
  }

  async restore(workItemId: string, packageId: string, revision: number, itemId: string): Promise<ContextPackage> {
    const pkg = this.assertEditable(workItemId, packageId, revision); const exclusion = pkg.exclusions.find((candidate) => candidate.item.id === itemId && candidate.restorable);
    if (!exclusion) throw new DevelopmentContextPackageError("context-item-not-restorable", "The selected context item cannot be restored.");
    return this.persistMutation(pkg, [...pkg.items, { ...exclusion.item, included: true }], pkg.exclusions.filter((candidate) => candidate !== exclusion));
  }

  async invalidate(workItemId: string, reason: string): Promise<void> { const pkg = this.store.getByWorkItem(workItemId); if (pkg && !["stale", "superseded"].includes(pkg.metadata.status)) await this.store.markStale(pkg.id, reason); }

  private requireCurrent(workItemId: string, packageId: string): ContextPackage {
    const pkg = this.store.getByWorkItem(workItemId);
    if (!pkg || pkg.id !== packageId) throw new DevelopmentContextPackageError("package-revision-conflict", "Context revision conflict. Reload the current package and try again.");
    return pkg;
  }

  private assertEditable(workItemId: string, packageId: string, revision: number): ContextPackage { const pkg = this.requireCurrent(workItemId, packageId); if (pkg.metadata.version !== revision) throw new DevelopmentContextPackageError("package-revision-conflict", "Context revision conflict. Reload the current package and try again."); if (["approved", "delegated", "superseded"].includes(pkg.metadata.status)) throw new DevelopmentContextPackageError("package-revision-conflict", "Approved and superseded context revisions are read-only. Regenerate before editing."); return pkg; }
  private async persistMutation(pkg: ContextPackage, items: ContextItem[], exclusions: ContextExclusion[]): Promise<ContextPackage> { const compressedTokens = items.reduce((sum, item) => sum + item.tokenCount, 0); const reductionTokens = Math.max(0, pkg.rawBaseline.tokenCount - compressedTokens); const facts = pkg.requiredFacts.map((fact) => { const satisfiedBy = fact.satisfiedBy.filter((id) => items.some((item) => item.id === id)); return { ...fact, satisfiedBy, state: satisfiedBy.length ? "satisfied" as const : "missing" as const, reason: satisfiedBy.length ? fact.reason : "Required context was removed from this revision." }; }); const requiredRemoved = exclusions.some((entry) => entry.reason === "user-removed" && entry.item.importance === "required"); const blocked = requiredRemoved || facts.some((fact) => fact.critical && fact.state !== "satisfied"); const contentHash = hash({ items: items.map((item) => [item.id, item.compressedContentHash, item.pinned]), exclusions: exclusions.map((item) => [item.item.id, item.reason]), budget: pkg.budget }); const reductionPercentage = pkg.rawBaseline.tokenCount ? (reductionTokens / pkg.rawBaseline.tokenCount) * 100 : 0; const next: ContextPackage = { ...pkg, contentFingerprint: contentHash, items, exclusions, sections: buildSections(items, items.filter((item) => item.contentMode === "summary" || item.contentMode === "signature" || item.contentMode === "contract").map((item) => item.id)), compressed: { ...pkg.compressed, itemCount: items.length, tokenCount: compressedTokens, byteCount: items.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), reductionTokens, reductionPercentage }, requiredFacts: facts, coverage: { ...pkg.coverage, retainedRequiredFacts: facts.filter((fact) => fact.state === "satisfied").length, unresolvedRequiredFacts: blocked ? [...new Set([...facts.filter((fact) => fact.state !== "satisfied").map((fact) => fact.id), ...(requiredRemoved ? ["required-context-removed"] : [])])] : [], completenessScore: blocked ? Math.min(.99, facts.length ? facts.filter((fact) => fact.state === "satisfied").length / facts.length : 0) : 1 }, metrics: { ...pkg.metrics, compressedContextTokens: compressedTokens, tokensRemoved: reductionTokens, reductionPercentage, retainedItemCount: items.length, excludedItemCount: exclusions.length, summarizedItemCount: items.filter((item) => item.contentMode === "summary" || item.contentMode === "signature" || item.contentMode === "contract").length, completenessScore: blocked ? .5 : 1 }, metadata: { ...pkg.metadata, status: blocked ? "blocked" : "ready", contentHash, updatedAt: this.now() } }; return this.store.upsert(ContextPackageSchema.parse(next)); }

  private rawItems(input: DevelopmentContextBuildInput, counter: ReturnType<TokenCounterRegistry["resolveSafe"]>["counter"]): ContextItem[] {
    const specs: Array<{ id: string; title: string; type: ContextItem["sourceType"]; content: string; importance: ContextItem["importance"]; ref?: ContextItem["sourceReference"] }> = [
      { id: "development:intent", title: "Workflow intent", type: "workflow-intent", content: input.intent, importance: "required" },
      { id: "development:work-type", title: "Work type", type: "workflow-intent", content: input.workType, importance: "required" },
      ...(input.specification ? [{ id: "development:specification", title: "Specification", type: "specification" as const, content: input.specification, importance: "required" as const }] : []),
      { id: "development:objective", title: "Development objective", type: "workflow-intent", content: input.objective, importance: "required" },
      ...input.scope.map((item) => ({ id: `scope:${item.id}`, title: item.symbol ? `${item.symbol.name} (${item.symbol.kind})` : item.workspaceRelativePath, type: item.kind === "symbol" ? "symbol" as const : "repository-file" as const, content: item.content, importance: "required" as const, ref: { filePath: item.workspaceRelativePath, ...(item.symbol ? { symbolId: item.symbol.entityId, startLine: item.symbol.range?.startLine, endLine: item.symbol.range?.endLine } : {}) } })),
      ...(input.intelligenceSelections ?? []).map((item) => ({ id: `intelligence:${item.id}`, title: item.label, type: "call-flow" as const, content: item.content, importance: "supporting" as const })),
      { id: `skill:${input.skill.id}`, title: input.skill.name, type: "skill", content: input.skill.content, importance: "required" },
      ...input.instructions.map((item) => ({ id: `instruction:${item.id}`, title: item.name, type: "instruction" as const, content: item.content, importance: "required" as const, ref: { filePath: item.path } })),
      ...(input.notes?.trim() ? [{ id: "development:user-notes", title: "User notes", type: "user-note" as const, content: input.notes.trim(), importance: "optional" as const }] : []),
    ];
    return specs.map((item) => { const tokens = counter.count(item.content); const contentHash = hash(item.content); return { id: item.id, title: item.title, sourceType: item.type, sourceReference: item.ref ?? {}, contentMode: item.type === "symbol" ? "signature" : "full", importance: item.importance, relevanceScore: item.importance === "required" ? 100 : 50, confidence: 1, tokenCount: tokens, rawTokenCount: tokens, savedTokens: 0, reasons: [item.importance === "required" ? "Required persisted Development input." : "User-provided supporting context."], dependencies: [], satisfiesRequiredFacts: [], content: item.content, rawContentHash: contentHash, compressedContentHash: contentHash, pinned: input.pinnedItemIds.includes(item.id), freshness: "current", included: true }; });
  }
}

function developmentProfile(budget: number): StageContextProfile { return { id: "development-context-v1", stageType: "development", name: "Development context", description: "Bounded Development inputs", requiredCategories: ["workflow-intent", "specification", "repository-file", "symbol", "skill", "instruction"], preferredCategories: ["user-note"], excludedCategories: [], relationshipTraversalDepth: 1, defaultTokenBudget: budget, minimumCompletenessThreshold: 1, compressionStrategies: ["structural-summary", "signature", "contract-extraction"], requiredSafetyEvidence: [], requiredPriorStageOutputs: [], overrides: {}, source: "built-in", version: 1 }; }
function baselineSources(input: DevelopmentContextBuildInput): string[] { return ["workflow intent", "work type", ...(input.specification ? ["specification"] : []), "development objective", ...input.scope.map((item) => item.symbol?.range ? `${item.workspaceRelativePath}:${item.symbol.range.startLine}-${item.symbol.range.endLine}` : item.workspaceRelativePath), ...(input.intelligenceSelections ?? []).map((item) => `${item.label} @ Intelligence ${item.intelligenceRevision}`), input.skill.name, ...input.instructions.map((item) => item.path), ...(input.notes?.trim() ? ["user notes"] : [])]; }
function requiredFacts(input: DevelopmentContextBuildInput, items: ContextItem[]): RequiredFact[] { const present = new Set(items.map((item) => item.id)); const facts: Array<[string, string, RequiredFact["category"], string[]]> = [["objective", "Development objective", "target-behaviour", ["development:objective"]], ["source-scope", "Selected source scope", "changed-symbol", input.scope.map((item) => `scope:${item.id}`)], ["skill", "Selected Development skill", "output-format", [`skill:${input.skill.id}`]], ["instructions", "Selected repository instructions", "repository-convention", input.instructions.map((item) => `instruction:${item.id}`)]]; return facts.map(([id, description, category, candidates]) => { const satisfiedBy = candidates.filter((item) => present.has(item)); const satisfied = candidates.length > 0 && satisfiedBy.length === candidates.length; return { id, description, category, critical: true, state: satisfied ? "satisfied" : satisfiedBy.length ? "partially-satisfied" : "missing", satisfiedBy, reason: satisfied ? "All persisted inputs are retained." : "Required persisted input is absent from the compressed package." }; }); }
function buildSections(items: ContextItem[], summarized: string[]): ContextSection[] { const sections: ContextSection[] = (["required", "supporting", "optional"] as const).flatMap((importance): ContextSection[] => { const selected = items.filter((item) => item.importance === importance); return selected.length ? [{ group: importance, title: `${importance[0]!.toUpperCase()}${importance.slice(1)}`, itemIds: selected.map((item) => item.id), tokenCount: selected.reduce((sum, item) => sum + item.tokenCount, 0) }] : []; }); if (summarized.length) sections.push({ group: "summarized", title: "Summarized", itemIds: summarized, tokenCount: items.filter((item) => summarized.includes(item.id)).reduce((sum, item) => sum + item.tokenCount, 0), compressionStrategy: "deterministic-structural-summary" }); return sections; }
function tokenGroups(items: ContextItem[]): Record<string, number> { return items.reduce<Record<string, number>>((groups, item) => ({ ...groups, [item.sourceType]: (groups[item.sourceType] ?? 0) + item.rawTokenCount }), {}); }
function inputFingerprint(input: DevelopmentContextBuildInput): string { return hash({ workflowId: input.workflowId, stageId: input.stageId, workItemId: input.workItemId, executionProfileId: input.executionProfileId, intent: input.intent, workType: input.workType, specification: input.specification, objective: input.objective, objectiveRevision: input.objectiveRevision, specificationRevision: input.specificationRevision, budgetTokens: input.budgetTokens, notes: input.notes, skill: input.skill, scope: input.scope.map((item) => ({ ...item, content: hash(item.content) })), intelligenceSelections: (input.intelligenceSelections ?? []).map((item) => ({ ...item, content: hash(item.content) })), instructions: input.instructions.map((item) => ({ id: item.id, hash: item.contentHash })) }); }
function hash(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function mergeOverlappingSymbols(items: ContextItem[], counter: ReturnType<TokenCounterRegistry["resolveSafe"]>["counter"]): { items: ContextItem[]; exclusions: ContextExclusion[] } { const retained: ContextItem[] = []; const exclusions: ContextExclusion[] = []; for (const item of items) { if (item.sourceType !== "symbol" || item.sourceReference.startLine === undefined || item.sourceReference.endLine === undefined) { retained.push(item); continue; } const overlap = retained.find((candidate) => candidate.sourceType === "symbol" && candidate.sourceReference.filePath === item.sourceReference.filePath && candidate.sourceReference.startLine !== undefined && candidate.sourceReference.endLine !== undefined && candidate.sourceReference.startLine <= item.sourceReference.endLine! && item.sourceReference.startLine! <= candidate.sourceReference.endLine); if (!overlap) { retained.push(item); continue; } const content = [...new Set(`${overlap.content}\n${item.content}`.split("\n"))].join("\n"); const tokenCount = counter.count(content); const merged = { ...overlap, title: `${overlap.title} + ${item.title}`, content, tokenCount, rawTokenCount: overlap.rawTokenCount + item.rawTokenCount, savedTokens: Math.max(0, overlap.rawTokenCount + item.rawTokenCount - tokenCount), sourceReference: { ...overlap.sourceReference, startLine: Math.min(overlap.sourceReference.startLine!, item.sourceReference.startLine), endLine: Math.max(overlap.sourceReference.endLine!, item.sourceReference.endLine) }, reasons: [...new Set([...overlap.reasons, `Merged overlapping symbol range ${item.sourceReference.filePath}:${item.sourceReference.startLine}-${item.sourceReference.endLine}.`])], compressedContentHash: hash(content), compressionStrategy: "overlapping-range-merge" }; retained[retained.indexOf(overlap)] = merged; exclusions.push({ item, reason: "relationship-duplicate", tokensRemoved: Math.max(0, overlap.tokenCount + item.tokenCount - tokenCount), restorable: true, detail: `Merged into ${overlap.id}; the original source reference remains here for traceability.` }); } return { items: retained, exclusions }; }
