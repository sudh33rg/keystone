/**
 * TestDiscoveryService + TestMappingService + ImpactedTestRanker (spec §15, §16, §17).
 *
 * Deterministic discovery of tests from the existing IntelligenceSnapshot (test-flagged
 * files, test symbols, route/test targets indexes) and mapping to impacted production
 * entities via relationships. Ranking is explainable (§17).
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  ChangedSymbol,
  ImpactAnalysis,
  ImpactedTestReference,
} from "../../../shared/contracts/qaLifecycle";

export interface DiscoveredTest {
  id: string;
  displayName: string;
  filePath: string;
  layer: "unit" | "component" | "integration" | "contract" | "e2e" | "static";
  confidence: number;
  evidence: Array<{ id: string; kind: string; statement: string }>;
}

export class TestDiscoveryService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  discover(): DiscoveredTest[] {
    const out: DiscoveredTest[] = [];
    const testFiles = this.snapshot.files.filter((f) => f.isTest || f.category === "test");
    for (const f of testFiles) {
      const syms = this.snapshot.symbols.filter((s) => s.fileId === f.id);
      if (syms.length === 0) {
        out.push({
          id: `test-file:${f.id}`,
          displayName: f.relativePath.split("/").pop() ?? f.relativePath,
          filePath: f.relativePath,
          layer: inferLayer(f.relativePath),
          confidence: 0.6,
          evidence: f.evidenceIds.map((e) => ({
            id: e,
            kind: "file",
            statement: `Test file ${f.relativePath}`,
          })),
        });
      }
      for (const s of syms) {
        out.push({
          id: s.id,
          displayName: s.name,
          filePath: f.relativePath,
          layer: inferLayer(f.relativePath),
          confidence: s.confidence,
          evidence: s.evidenceIds.map((e) => ({
            id: e,
            kind: "symbol",
            statement: `Test symbol ${s.name}`,
          })),
        });
      }
    }
    return out;
  }
}

export class TestMappingService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  /** Map every discovered test to the production entities it references, with confidence + type. */
  map(discovered: DiscoveredTest[]): Array<{ test: DiscoveredTest; mappings: TestMapping[] }> {
    const out: Array<{ test: DiscoveredTest; mappings: TestMapping[] }> = [];
    for (const test of discovered) {
      const mappings = this.mappingsFor(test);
      out.push({ test, mappings });
    }
    return out;
  }

  private mappingsFor(test: DiscoveredTest): TestMapping[] {
    const result: TestMapping[] = [];
    const seen = new Set<string>();
    for (const r of this.snapshot.relationships) {
      if (r.sourceId !== test.id) continue;
      const target = r.targetId;
      const sym = this.snapshot.symbols.find((s) => s.id === target);
      if (!sym) continue;
      const f = this.snapshot.files.find((x) => x.id === sym.fileId);
      if (f?.isTest) continue; // only map to production entities
      const key = `${test.id}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = mappingType(r.type);
      const confidence =
        r.confidence >= 0.9
          ? "confirmed"
          : r.confidence >= 0.6
            ? "high-confidence"
            : r.confidence >= 0.4
              ? "inferred"
              : "unresolved";
      result.push({
        testId: test.id,
        productionEntityId: target,
        mappingType: type,
        confidence: r.confidence,
        confidenceLabel: confidence,
        evidence: r.evidenceIds.map((e) => ({
          id: e,
          kind: "relationship",
          statement: `Relationship ${r.type} to ${sym.name}`,
        })),
        source: "static",
        lastValidationRevision: this.snapshot.manifest.scanRevision.toString(),
      });
    }
    return result;
  }
}

export interface TestMapping {
  testId: string;
  productionEntityId: string;
  mappingType:
    | "direct-symbol"
    | "import"
    | "static-call"
    | "route"
    | "event"
    | "database"
    | "fixture"
    | "coverage"
    | "framework"
    | "naming"
    | "proximity"
    | "user";
  confidence: number;
  confidenceLabel: "confirmed" | "high-confidence" | "inferred" | "unresolved";
  evidence: Array<{ id: string; kind: string; statement: string }>;
  source: string;
  lastValidationRevision: string;
}

export class ImpactedTestRanker {
  rank(
    analysis: ImpactAnalysis,
    mappings: Array<{ test: DiscoveredTest; mappings: TestMapping[] }>,
    changedSymbols: ChangedSymbol[],
  ): ImpactedTestReference[] {
    const changedIds = new Set(changedSymbols.map((c) => c.symbolId));
    const flowEntityIds = new Set(
      analysis.flows.flatMap((f) => [
        ...f.changedStepEntityIds,
        ...f.indirectlyImpactedStepEntityIds,
      ]),
    );
    const contractIds = new Set(
      analysis.entities.filter((e) => e.isPublicContract).map((e) => e.entityId),
    );

    const refs: ImpactedTestReference[] = [];
    const seen = new Set<string>();
    for (const { test, mappings: ms } of mappings) {
      const hits = ms.filter((m) => isImpacted(analysis, m.productionEntityId));
      if (hits.length === 0) continue;
      if (seen.has(test.id)) continue;
      seen.add(test.id);

      const mapsChanged = hits.some((m) => changedIds.has(m.productionEntityId));
      const mapsContract = hits.some((m) => contractIds.has(m.productionEntityId));
      const mapsFlow = hits.some((m) => flowEntityIds.has(m.productionEntityId));
      const minConfidence = Math.min(...hits.map((m) => m.confidence));

      let ranking: ImpactedTestReference["ranking"];
      if (mapsChanged) ranking = "required";
      else if (mapsContract) ranking = "strongly-recommended";
      else if (mapsFlow) ranking = "supporting";
      else ranking = "regression";

      if (minConfidence < 0.4) ranking = "unresolved-candidate";
      if (minConfidence >= 0.6 && ranking === "regression") ranking = "optional";

      const reasons: string[] = [];
      if (mapsChanged) reasons.push("directly maps to a changed symbol");
      if (mapsContract) reasons.push("maps to a changed public contract");
      if (mapsFlow) reasons.push("maps to an affected engineering flow");
      reasons.push(`mapping confidence ${(minConfidence * 100).toFixed(0)}%`);
      reasons.push(`mapping types: ${[...new Set(hits.map((m) => m.mappingType))].join(", ")}`);

      refs.push({
        testId: test.id,
        displayName: test.displayName,
        mappedEntityIds: hits.map((m) => m.productionEntityId),
        ranking,
        confidence: minConfidence,
        reason: reasons.join("; "),
      });
    }
    return this.sort(refs);
  }

  private sort(refs: ImpactedTestReference[]): ImpactedTestReference[] {
    const order: Record<ImpactedTestReference["ranking"], number> = {
      required: 0,
      "strongly-recommended": 1,
      supporting: 2,
      regression: 3,
      optional: 4,
      "unresolved-candidate": 5,
    };
    return [...refs].sort(
      (a, b) => order[a.ranking] - order[b.ranking] || b.confidence - a.confidence,
    );
  }
}

function isImpacted(analysis: ImpactAnalysis, entityId: string): boolean {
  return analysis.entities.some((e) => e.entityId === entityId);
}

function mappingType(relType: string): TestMapping["mappingType"] {
  switch (relType) {
    case "calls":
      return "static-call";
    case "imports":
      return "import";
    case "references":
      return "direct-symbol";
    case "publishes":
      return "event";
    case "subscribes":
      return "event";
    case "reads":
      return "database";
    case "writes":
      return "database";
    default:
      return "direct-symbol";
  }
}

function inferLayer(path: string): DiscoveredTest["layer"] {
  if (/e2e|playwright|cypress/i.test(path)) return "e2e";
  if (/integration/i.test(path)) return "integration";
  if (/component|dom|react/i.test(path)) return "component";
  if (/contract|schema|openapi/i.test(path)) return "contract";
  return "unit";
}
