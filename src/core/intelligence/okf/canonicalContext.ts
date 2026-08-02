import {
  buildOkfGraphView,
  type IntelligenceGraphMode,
  type IntelligenceGraphResult
} from "../explorer/intelligenceExplorer";
import { queryOkfSnapshot, type OkfQueryIntent, type OkfQueryResult } from "./queryEngine";
import type { KeystoneOkfSnapshot, OkfCanonicalEvidenceEnvelope } from "./types";
import type { IntelligenceRetrievalResult } from "../pipeline/retrieval";

/**
 * The canonical task-time selection produced from the promoted OKF snapshot.
 * Raw repository records may still be used to read source bodies, but selection,
 * relationships, and provenance must originate here whenever OKF is available.
 */
export interface CanonicalContextSelection {
  readonly query: OkfQueryResult;
  readonly graph: IntelligenceGraphResult;
  readonly unitIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly paths: readonly string[];
  readonly evidenceIds: readonly string[];
}

export function selectCanonicalContext(
  snapshot: KeystoneOkfSnapshot,
  text: string,
  options: {
    queryLimit?: number;
    graphLimit?: number;
    graphMode?: IntelligenceGraphMode;
    preferredPaths?: readonly string[];
  } = {}
): CanonicalContextSelection {
  const query = queryOkfSnapshot(snapshot, text, options.queryLimit ?? 40);
  const preferredPaths = new Set(options.preferredPaths ?? []);
  const preferredSeedIds = snapshot.units
    .filter((unit) => unit.lifecycle === "active" && preferredPaths.has(unitPath(unit) ?? ""))
    .map((unit) => unit.id);
  const seedIds = unique([...preferredSeedIds, ...query.items.map((item) => item.id)]).slice(0, 8);
  const graph = buildOkfGraphView(snapshot, {
    mode: options.graphMode ?? graphModeForIntent(query.intent),
    query: text,
    seedIds,
    depth: query.intent === "impact" ? 3 : 2,
    limit: options.graphLimit ?? 80
  });
  const unitIds = unique([
    ...query.items.map((item) => item.id),
    ...graph.nodes.map((node) => node.id)
  ]);
  const paths = unique(
    [...query.items.map((item) => item.path), ...graph.nodes.map((node) => node.path)].filter(
      (value): value is string => Boolean(value)
    )
  );
  const evidenceIds = unique([
    ...query.items.flatMap((item) => item.evidenceIds),
    ...graph.nodes.flatMap((node) => node.evidenceIds),
    ...graph.edges.flatMap((edge) => edge.evidenceIds)
  ]);
  const relationshipIds = unique(graph.edges.map((edge) => edge.id));
  return { query, graph, unitIds, relationshipIds, paths, evidenceIds };
}

export function canonicalEvidenceEnvelope(
  snapshot: KeystoneOkfSnapshot,
  selection: CanonicalContextSelection
): OkfCanonicalEvidenceEnvelope {
  return {
    snapshotDigest:
      snapshot.manifest.digests.snapshot ??
      snapshot.manifest.digests.okf ??
      snapshot.manifest.digests.graph ??
      "",
    extractionRunId: snapshot.manifest.extractionRunId,
    unitIds: selection.unitIds,
    relationshipIds: selection.relationshipIds,
    evidenceIds: selection.evidenceIds,
    paths: selection.paths,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Adapts the promoted OKF selection to the legacy retrieval shape used by the
 * context metrics and prompt digest. This is an adapter only: ranking comes
 * from the OKF query and graph, never from a second repository-wide search.
 */
export function canonicalRetrievalResult(
  selection: CanonicalContextSelection
): IntelligenceRetrievalResult {
  const queryByPath = new Map(
    selection.query.items.filter((item) => item.path).map((item) => [item.path!, item])
  );
  const graphByPath = new Map(
    selection.graph.nodes.filter((node) => node.path).map((node) => [node.path!, node])
  );
  const results = selection.paths.map((path, index) => {
    const queryItem = queryByPath.get(path);
    const graphNode = graphByPath.get(path);
    const reasons = [
      ...(queryItem ? [`OKF ${queryItem.reason}`] : []),
      ...(graphNode ? [`OKF graph ${selection.graph.mode} neighborhood`] : [])
    ];
    return {
      path,
      score: queryItem?.score ?? graphNode?.confidence ?? 1 / (index + 1),
      reasons: reasons.length ? reasons : ["canonical OKF selection"],
      evidenceMetadata: []
    };
  });
  return {
    mode: "canonical-okf",
    results,
    warnings: [...selection.query.warnings, ...selection.graph.warnings]
  };
}

function graphModeForIntent(intent: OkfQueryIntent): IntelligenceGraphMode {
  if (intent === "impact" || intent === "security" || intent === "performance") return "impact";
  if (intent === "flow") return "flows";
  if (intent === "callers" || intent === "callees") return "calls";
  if (intent === "tests") return "tests";
  if (intent === "data") return "flows";
  if (intent === "dependencies" || intent === "dependents") return "dependencies";
  if (intent === "api" || intent === "configuration" || intent === "documentation")
    return "architecture";
  return "repository";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function unitPath(unit: KeystoneOkfSnapshot["units"][number]): string | undefined {
  const value = unit.properties.path ?? unit.properties.filePath;
  return typeof value === "string" ? value : undefined;
}
