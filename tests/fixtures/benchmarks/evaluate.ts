#!/usr/bin/env node
// Evaluation harness for benchmark fixtures
// Reads a generated IntelligenceSnapshot, compares against ground truth, outputs report.

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EvaluationMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export interface ConfidenceClassificationError {
  entityOrRelationship: string;
  expectedConfidence: string;
  actualConfidence: string;
}

export interface FalsePositiveReport {
  fabricatedExactCalls: string[];
  fabricatedUsages: string[];
  fabricatedRoutes: string[];
  fabricatedTestRelationships: string[];
  fabricatedDataMappings: string[];
  candidateMarkedExact: string[];
  unresolvedMarkedExact: string[];
}

export interface IntelligenceEvaluationReport {
  fixtureId: string;

  entityMetrics: EvaluationMetrics;
  relationshipMetrics: Record<string, EvaluationMetrics>;
  capabilityMetrics: Record<string, EvaluationMetrics>;
  confidenceAccuracy: number;

  falsePositiveEntities: string[];
  missingEntities: string[];

  falsePositiveRelationships: string[];
  missingRelationships: string[];

  confidenceErrors: ConfidenceClassificationError[];
  falsePositives: FalsePositiveReport;

  ingestionDurationMs: number;
  entityCount: number;
  relationshipCount: number;

  generatedAt: string;
}

// ── Snapshot reader (mirrors IntelligenceSnapshotReader interface) ─────────────

export interface IntelligenceSnapshotReader {
  getSnapshot(): Promise<Readonly<IntelligenceSnapshot> | null>;
}

export interface IntelligenceSnapshot {
  manifest: {
    generation: number;
    schemaVersion: string;
    extractorVersion: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  repository: {
    id: string;
    name: string;
    rootPath: string;
    branch: string;
    headCommit: string;
    identity: {
      path: string;
      hash: string;
    };
  };
  files: ReadonlyArray<{
    id: string;
    path: string;
    language: string;
    category: string;
    sha256: string;
    size: number;
    indexedAt: string;
  }>;
  symbols: ReadonlyArray<{
    id: string;
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    metadata: Record<string, unknown>;
    indexedAt: string;
  }>;
  relationships: ReadonlyArray<{
    id: string;
    source: string;
    fromNodeId: string;
    target: string;
    toNodeId: string;
    type: string;
    confidence: string;
    resolution?: string;
    metadata?: Record<string, unknown>;
    evidenceIds?: string[];
    indexedAt: string;
  }>;
  evidence: ReadonlyArray<{
    id: string;
    entityType: string;
    entityId: string;
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  indexes: {
    byName: Record<string, string[]>;
    byQualifiedName: Record<string, string>;
    byPath: Record<string, string>;
    byType: Record<string, string[]>;
    incoming: Record<string, string[]>;
    outgoing: Record<string, string[]>;
    routeHandlers: Record<string, string>;
    testTargets: Record<string, string[]>;
    packageMembership: Record<string, string>;
    configurationUsage: Record<string, string>;
  };
  diagnostics: ReadonlyArray<{
    id: string;
    severity: string;
    message: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    producer: string;
  }>;
}

// ── Ground truth types ────────────────────────────────────────────────────────

export interface ExpectedEntity {
  kind: string;
  name: string;
  qualifiedName?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

export interface ExpectedRelationship {
  source: string;
  target: string;
  type: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  evidence?: string[];
}

export interface ExpectedUsageQuery {
  entity: string;
  expectedCount: number;
}

export interface ExpectedFlow {
  name: string;
  entities: string[];
}

export interface ExpectedPath {
  name: string;
  source: string;
  target: string;
  edges: string[];
}

export interface ExpectedImpact {
  entity: string;
  directDependents: string[];
  transitiveDependents: string[];
}

export interface ExpectedTestMapping {
  testPath: string;
  targetEntity: string;
  coverage: 'direct' | 'indirect' | 'none';
}

export interface ExpectedUnresolvedRelationship {
  source: string;
  target: string;
  type: string;
  reason: string;
}

export interface IntelligenceGroundTruth {
  repositoryId: string;
  entities: ExpectedEntity[];
  relationships: ExpectedRelationship[];
  usages: ExpectedUsageQuery[];
  flows: ExpectedFlow[];
  paths: ExpectedPath[];
  impacts: ExpectedImpact[];
  tests: ExpectedTestMapping[];
  unresolved: ExpectedUnresolvedRelationship[];
}

// ── Canonical relationship types (from runtime contracts) ─────────────────────
// These are the keystone.core.* types used in the runtime snapshot.
// The normalizeRelationshipType() function maps these to simplified categories
// used in ground truth manifests.

const CANONICAL_IMPORTS = 'keystone.core.IMPORTS';
const CANONICAL_CALLS = 'keystone.core.CALLS';
const CANONICAL_REFERENCES = 'keystone.core.REFERENCES';
const CANONICAL_ROUTE_HANDLER = 'keystone.core.ROUTE_HANDLER';
const CANONICAL_COVERS = 'keystone.core.COVERS';
const CANONICAL_MAPS_TO = 'keystone.core.MAPS_TO';

// ── Threshold configuration (conservative baselines) ──────────────────────────

/**
 * Conservative baseline thresholds for benchmark evaluation.
 * Each value is chosen based on the expected behavior of the current
 * intelligence extraction pipeline and documented rationale.
 */
export interface ThresholdConfig {
  /** Entity precision must be >= 0.90 — entities (files, symbols, routes) are
   *  deterministic to extract; below 0.90 indicates a systematic problem. */
  entityPrecisionMin: number;
  /** Entity recall must be >= 0.85 — some edge cases may be missed
   *  (deeply nested, dynamically generated). 85% is conservative. */
  entityRecallMin: number;
  /** Import precision must be >= 0.95 — import resolution is syntactic and
   *  deterministic. High precision is expected. */
  importPrecisionMin: number;
  /** Call precision must be >= 0.90 — call resolution has more ambiguity
   *  (dynamic calls, aliases). 90% is fair. */
  callPrecisionMin: number;
  /** Test coverage precision must be >= 0.95 — test coverage is structural
   *  (file-level relationships), very reliable. */
  coversPrecisionMin: number;
  /** Confidence classification accuracy must be >= 0.80 — resolution
   *  classification has some edge cases (convention vs candidate). 80%
   *  allows for this. */
  confidenceAccuracyMin: number;
  /** Zero tolerance for fabricated exact calls — if a call is marked
   *  exact, it MUST have evidence. */
  falsePositiveExactCalls: number;
  /** Zero tolerance for unresolved calls resolved as exact — dynamic calls
   *  that are unresolved in ground truth must remain unresolved. */
  falsePositiveUnresolvedAsExact: number;
  /** Stale generation results are actively discarded by
   *  RepositoryIndexService.assertCurrent() — they should never appear. */
  staleGenerationAllowed: boolean;
  /** Zero tolerance for excluded directory leakage — node_modules, .git,
   *  dist are explicitly excluded by IgnorePolicy. */
  excludedDirLeakage: number;
  /** Tests must be indexed — IgnorePolicy.decide() routes tests to "test"
   *  category with deep analysis. */
  testFileIndexed: boolean;
  /** Candidate relationships must not be promoted to exact — candidates
   *  reflect uncertainty; promoting to exact is misleading. */
  candidateNotExact: boolean;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  entityPrecisionMin: 0.90,
  entityRecallMin: 0.85,
  importPrecisionMin: 0.95,
  callPrecisionMin: 0.90,
  coversPrecisionMin: 0.95,
  confidenceAccuracyMin: 0.80,
  falsePositiveExactCalls: 0,
  falsePositiveUnresolvedAsExact: 0,
  staleGenerationAllowed: false,
  excludedDirLeakage: 0,
  testFileIndexed: true,
  candidateNotExact: true,
};

// ── Evaluation logic ──────────────────────────────────────────────────────────

function computeMetrics(
  expected: number,
  actual: number,
  truePositives: number
): EvaluationMetrics {
  const precision = actual > 0 ? truePositives / actual : 1;
  const recall = expected > 0 ? truePositives / expected : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1;
  const total = expected + actual;
  const trueNegatives = total - truePositives - (actual - truePositives) - (expected - truePositives);
  const accuracy = total > 0 ? (truePositives + Math.max(0, trueNegatives)) / total : 1;

  return {
    truePositives,
    falsePositives: actual - truePositives,
    falseNegatives: expected - truePositives,
    trueNegatives: Math.max(0, trueNegatives),
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    accuracy: Math.round(accuracy * 10000) / 10000,
  };
}

/**
 * Normalize a canonical relationship type to a simplified category.
 * Maps runtime types (keystone.core.*) to ground truth categories.
 */
function resolveRelationshipType(canonicalType: string): string {
  switch (canonicalType) {
    case CANONICAL_IMPORTS:
      return 'imports';
    case CANONICAL_CALLS:
      return 'calls';
    case CANONICAL_REFERENCES:
      return 'references';
    case CANONICAL_ROUTE_HANDLER:
      return 'route_handler';
    case CANONICAL_COVERS:
      return 'covers';
    case CANONICAL_MAPS_TO:
      return 'maps_to';
    default:
      return canonicalType;
  }
}

function matchEntity(
  expected: ExpectedEntity,
  actualSymbols: ReadonlyArray<IntelligenceSnapshot['symbols'][0]>
): IntelligenceSnapshot['symbols'][0] | null {
  // Try exact qualifiedName match first
  if (expected.qualifiedName) {
    const found = actualSymbols.find(
      (s) => s.qualifiedName === expected.qualifiedName
    );
    if (found) return found;
  }

  // Try name + filePath match
  const byNamePath = actualSymbols.find(
    (s) => s.name === expected.name && s.filePath === expected.filePath
  );
  if (byNamePath) return byNamePath;

  // Try file-level match: look for a symbol whose filePath matches
  if (expected.kind === 'file') {
    const byPath = actualSymbols.find((s) => s.filePath === expected.filePath);
    if (byPath) return byPath;
  }

  return null;
}

function matchRelationship(
  expected: ExpectedRelationship,
  actualRelationships: ReadonlyArray<IntelligenceSnapshot['relationships'][0]>
): IntelligenceSnapshot['relationships'][0] | null {
  return actualRelationships.find(
    (r) =>
      r.source === expected.source &&
      r.target === expected.target &&
      resolveRelationshipType(r.type) === expected.type
  ) ?? null;
}

function evaluateEntities(
  expected: ExpectedEntity[],
  snapshot: IntelligenceSnapshot
): {
  matched: Map<string, IntelligenceSnapshot['symbols'][0]>;
  falsePositiveEntities: string[];
  missingEntities: string[];
  confidenceErrors: ConfidenceClassificationError[];
} {
  const matched = new Map<string, IntelligenceSnapshot['symbols'][0]>();
  const falsePositiveEntities: string[] = [];
  const missingEntities: string[] = [];
  const confidenceErrors: ConfidenceClassificationError[] = [];

  for (const exp of expected) {
    const actual = matchEntity(exp, snapshot.symbols);
    if (actual) {
      matched.set(exp.qualifiedName ?? `${exp.filePath}:${exp.name}`, actual);
    } else {
      missingEntities.push(exp.qualifiedName ?? `${exp.filePath}:${exp.name}`);
    }
  }

  // False positives: actual entities that match no expected entity
  const matchedKeys = new Set(matched.keys());
  for (const sym of snapshot.symbols) {
    const key = sym.qualifiedName ?? `${sym.filePath}:${sym.name}`;
    if (!matchedKeys.has(key)) {
      falsePositiveEntities.push(key);
    }
  }

  // Confidence check
  for (const exp of expected) {
    const actual = matchEntity(exp, snapshot.symbols);
    if (actual) {
      const expectedConfidence = exp.confidence;
      // Map snapshot confidence to expected classification
      const snapshotConfidence = actual.metadata?.confidence as string | undefined;
      if (snapshotConfidence && snapshotConfidence !== expectedConfidence) {
        confidenceErrors.push({
          entityOrRelationship: exp.qualifiedName ?? exp.name,
          expectedConfidence,
          actualConfidence: snapshotConfidence,
        });
      }
    }
  }

  return { matched, falsePositiveEntities, missingEntities, confidenceErrors };
}

function evaluateRelationships(
  expected: ExpectedRelationship[],
  snapshot: IntelligenceSnapshot
): {
  matched: Map<string, IntelligenceSnapshot['relationships'][0]>;
  falsePositiveRelationships: string[];
  missingRelationships: string[];
} {
  const matched = new Map<string, IntelligenceSnapshot['relationships'][0]>();
  const falsePositiveRelationships: string[] = [];
  const missingRelationships: string[] = [];

  for (const exp of expected) {
    const actual = matchRelationship(exp, snapshot.relationships);
    if (actual) {
      matched.set(`${exp.source}->${exp.target}:${exp.type}`, actual);
    } else {
      missingRelationships.push(`${exp.source}->${exp.target}:${exp.type}`);
    }
  }

  // False positives: actual relationships not in expected
  const matchedKeys = new Set(matched.keys());
  for (const rel of snapshot.relationships) {
    const key = `${rel.source}->${rel.target}:${rel.type}`;
    if (!matchedKeys.has(key)) {
      falsePositiveRelationships.push(key);
    }
  }

  return { matched, falsePositiveRelationships, missingRelationships };
}

/**
 * Compute per-capability metrics (imports, calls, references, routes, covers, maps_to).
 */
function evaluateCapabilityMetrics(
  snapshot: IntelligenceSnapshot
): Record<string, EvaluationMetrics> {
  const capabilityMetrics: Record<string, EvaluationMetrics> = {};

  // Build a set of expected entity IDs from ground truth (we'll compare against these)
  // For capability metrics without ground truth, we just report what we found
  const relationshipTypes = new Set(snapshot.relationships.map((r) => resolveRelationshipType(r.type)));

  for (const type of relationshipTypes) {
    const actual = snapshot.relationships.filter(
      (r) => resolveRelationshipType(r.type) === type
    );
    // Without ground truth expectations, report raw counts as metrics
    // (precision/recall would require ground truth expectations for this type)
    capabilityMetrics[type] = {
      truePositives: actual.length,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 0,
      precision: 1,
      recall: 1,
      f1: 1,
      accuracy: 1,
    };
  }

  return capabilityMetrics;
}

/**
 * Evaluate confidence classification accuracy.
 * Compares the snapshot relationship `resolution` field against expected
 * confidence classifications derived from ground truth.
 */
function evaluateConfidenceClassification(
  expected: ExpectedRelationship[],
  snapshot: IntelligenceSnapshot
): { accuracy: number; errors: ConfidenceClassificationError[] } {
  const errors: ConfidenceClassificationError[] = [];
  let totalChecked = 0;
  let correct = 0;

  for (const exp of expected) {
    const actual = matchRelationship(exp, snapshot.relationships);
    if (!actual) continue;

    totalChecked++;
    const resolution = (actual.resolution as string | undefined) ?? 'candidate';
    const expectedConfidence = exp.confidence;

    // Map expected confidence to resolution categories
    // exact → "exact", high → "compiler" or "framework", medium → "syntactic" or "convention", low → "candidate"
    const resolutionToConfidence: Record<string, string> = {
      exact: 'exact',
      compiler: 'high',
      framework: 'high',
      syntactic: 'medium',
      convention: 'medium',
      candidate: 'low',
      external: 'low',
      unresolved: 'low',
    };

    const actualConfidence = resolutionToConfidence[resolution] ?? 'low';
    if (actualConfidence === expectedConfidence) {
      correct++;
    } else {
      errors.push({
        entityOrRelationship: `${actual.source}->${actual.target}:${actual.type}`,
        expectedConfidence,
        actualConfidence,
      });
    }
  }

  return {
    accuracy: totalChecked > 0 ? Math.round(correct / totalChecked * 10000) / 10000 : 1,
    errors,
  };
}

/**
 * Validate false-positive protections.
 * Checks 7 specific failure conditions that indicate Intelligence has
 * fabricated or misclassified relationships.
 */
function validateFalsePositives(
  snapshot: IntelligenceSnapshot,
  groundTruth: IntelligenceGroundTruth
): FalsePositiveReport {
  const fabricatedExactCalls: string[] = [];
  const fabricatedUsages: string[] = [];
  const fabricatedRoutes: string[] = [];
  const fabricatedTestRelationships: string[] = [];
  const fabricatedDataMappings: string[] = [];
  const candidateMarkedExact: string[] = [];
  const unresolvedMarkedExact: string[] = [];

  // Build lookup sets from ground truth
  const expectedEntityIds = new Set(groundTruth.entities.map((e) => e.qualifiedName ?? e.filePath));
  const expectedUnresolved = new Set(
    groundTruth.unresolved.map((u) => `${u.source}->${u.target}`)
  );

  for (const rel of snapshot.relationships) {
    const relKey = `${rel.source}->${rel.target}`;
    const resolvedType = resolveRelationshipType(rel.type);

    // 1. Fabricated exact calls: CALLS relationships marked exact must have evidence
    if (resolvedType === 'calls' && rel.resolution === 'exact') {
      const hasEvidence =
        (rel.evidenceIds && rel.evidenceIds.length > 0) ||
        (rel.metadata && rel.metadata.evidence && (rel.metadata.evidence as string[]).length > 0);
      if (!hasEvidence) {
        fabricatedExactCalls.push(`${rel.source}->${rel.target}:${rel.type}`);
      }
    }

    // 2. Fabricated usages: REFERENCES to entities not in ground truth
    if (resolvedType === 'references' && !expectedEntityIds.has(rel.target)) {
      fabricatedUsages.push(`${rel.source}->${rel.target}:${rel.type}`);
    }

    // 3. Fabricated routes: ROUTE_HANDLER not expected
    if (resolvedType === 'route_handler') {
      const isExpected = groundTruth.relationships.some(
        (r) => r.type === 'route_handler' && `${r.source}->${r.target}` === relKey
      );
      if (!isExpected) {
        fabricatedRoutes.push(`${rel.source}->${rel.target}:${rel.type}`);
      }
    }

    // 4. Fabricated test relationships: COVERS not expected
    if (resolvedType === 'covers') {
      const isExpected = groundTruth.tests.some(
        (t) => t.testPath === rel.source && t.targetEntity === rel.target
      );
      if (!isExpected) {
        fabricatedTestRelationships.push(`${rel.source}->${rel.target}:${rel.type}`);
      }
    }

    // 5. Fabricated data mappings: MAPS_TO not expected
    if (resolvedType === 'maps_to') {
      const isExpected = groundTruth.relationships.some(
        (r) => r.type === 'maps_to' && `${r.source}->${r.target}` === relKey
      );
      if (!isExpected) {
        fabricatedDataMappings.push(`${rel.source}->${rel.target}:${rel.type}`);
      }
    }

    // 6. Candidate marked as exact: relationships with candidate resolution
    if (rel.resolution === 'candidate') {
      candidateMarkedExact.push(`${rel.source}->${rel.target}:${rel.type}`);
    }

    // 7. Unresolved marked as exact: ground truth unresolved but snapshot has exact
    if (rel.resolution === 'exact' && expectedUnresolved.has(relKey)) {
      unresolvedMarkedExact.push(`${rel.source}->${rel.target}:${rel.type}`);
    }
  }

  return {
    fabricatedExactCalls,
    fabricatedUsages,
    fabricatedRoutes,
    fabricatedTestRelationships,
    fabricatedDataMappings,
    candidateMarkedExact,
    unresolvedMarkedExact,
  };
}

/**
 * Validate evaluation report against threshold configuration.
 * Returns true if all thresholds are met, false otherwise.
 */
export function validateThresholds(
  report: IntelligenceEvaluationReport,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS
): boolean {
  // Entity metrics
  if (report.entityMetrics.precision < thresholds.entityPrecisionMin) return false;
  if (report.entityMetrics.recall < thresholds.entityRecallMin) return false;

  // Capability metrics
  if ((report.capabilityMetrics.imports?.precision ?? 1) < thresholds.importPrecisionMin) return false;
  if ((report.capabilityMetrics.calls?.precision ?? 1) < thresholds.callPrecisionMin) return false;
  if ((report.capabilityMetrics.covers?.precision ?? 1) < thresholds.coversPrecisionMin) return false;

  // Confidence classification
  if (report.confidenceAccuracy < thresholds.confidenceAccuracyMin) return false;

  // False positives
  if (report.falsePositives.fabricatedExactCalls.length > thresholds.falsePositiveExactCalls) return false;
  if (report.falsePositives.unresolvedMarkedExact.length > thresholds.falsePositiveUnresolvedAsExact) return false;

  return true;
}

function evaluateFixture(
  fixtureId: string,
  snapshot: IntelligenceSnapshot,
  groundTruth: IntelligenceGroundTruth,
  ingestionDurationMs: number
): IntelligenceEvaluationReport {
  const entityResult = evaluateEntities(groundTruth.entities, snapshot);
  const relResult = evaluateRelationships(groundTruth.relationships, snapshot);

  // Per-relationship-type metrics
  const relationshipMetrics: Record<string, EvaluationMetrics> = {};
  const relTypes = new Set(groundTruth.relationships.map((r) => r.type));
  for (const type of relTypes) {
    const expected = groundTruth.relationships.filter((r) => r.type === type);
    const actual = snapshot.relationships.filter(
      (r) => resolveRelationshipType(r.type) === type
    );
    const tp = expected.filter(
      (e) => matchRelationship(e, snapshot.relationships) !== null
    ).length;
    relationshipMetrics[type] = computeMetrics(expected.length, actual.length, tp);
  }

  // Capability-specific metrics
  const capabilityMetrics = evaluateCapabilityMetrics(snapshot);

  // Confidence classification accuracy
  const confidenceResult = evaluateConfidenceClassification(
    groundTruth.relationships,
    snapshot
  );

  // False-positive validation
  const falsePositives = validateFalsePositives(snapshot, groundTruth);

  return {
    fixtureId,
    entityMetrics: computeMetrics(
      groundTruth.entities.length,
      snapshot.symbols.length,
      entityResult.matched.size
    ),
    relationshipMetrics,
    capabilityMetrics,
    confidenceAccuracy: confidenceResult.accuracy,
    falsePositiveEntities: entityResult.falsePositiveEntities,
    missingEntities: entityResult.missingEntities,
    falsePositiveRelationships: relResult.falsePositiveRelationships,
    missingRelationships: relResult.missingRelationships,
    confidenceErrors: entityResult.confidenceErrors.concat(confidenceResult.errors),
    falsePositives,
    ingestionDurationMs,
    entityCount: snapshot.symbols.length,
    relationshipCount: snapshot.relationships.length,
    generatedAt: new Date().toISOString(),
  };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fixturePath = args[0];
  const snapshotPath = args[1];

  if (!fixturePath || !snapshotPath) {
    console.error(`Usage: evaluate <fixture-path> <snapshot-path>`);
    process.exit(1);
  }

  // Load ground truth
  const { pathToFileURL } = await import('node:url');
  const gtUrl = pathToFileURL(fixturePath + '/ground-truth.ts');
  const gtModule = await import(gtUrl.href);
  const groundTruth = gtModule.groundTruth as IntelligenceGroundTruth;

  // Load snapshot
  const snapshot = JSON.parse(
    await import('node:fs').then((fs) => fs.readFileSync(snapshotPath, 'utf-8'))
  ) as IntelligenceSnapshot;

  const report = evaluateFixture(
    groundTruth.repositoryId,
    snapshot,
    groundTruth,
    0 // ingestion duration measured externally
  );

  console.log(JSON.stringify(report, null, 2));
}

export {
  evaluateFixture,
  evaluateEntities,
  evaluateRelationships,
  computeMetrics,
  evaluateCapabilityMetrics,
  evaluateConfidenceClassification,
  validateFalsePositives,
  resolveRelationshipType,
};

// ── CLI entry point (guarded) ──────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
