import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  evaluateEntities,
  evaluateRelationships,
  evaluateCapabilityMetrics,
  evaluateConfidenceClassification,
  validateFalsePositives,
  validateThresholds,
  DEFAULT_THRESHOLDS,
  resolveRelationshipType,
  type IntelligenceSnapshot,
  type IntelligenceGroundTruth,
  type ExpectedEntity,
  type ExpectedRelationship,
  type IntelligenceEvaluationReport,
} from '../../fixtures/benchmarks/evaluate';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSymbol(overrides: Partial<IntelligenceSnapshot['symbols'][0]> = {}): IntelligenceSnapshot['symbols'][0] {
  return {
    id: 'sym-1',
    name: 'Foo',
    qualifiedName: 'pkg/src/Foo.ts:Foo',
    kind: 'class',
    filePath: 'src/Foo.ts',
    startLine: 1,
    endLine: 10,
    metadata: {},
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRelationship(
  overrides: Partial<IntelligenceSnapshot['relationships'][0]> = {}
): IntelligenceSnapshot['relationships'][0] {
  return {
    id: 'rel-1',
    source: 'pkg/src/A.ts:Foo',
    target: 'pkg/src/B.ts:Bar',
    fromNodeId: 'n-a',
    toNodeId: 'n-b',
    type: 'keystone.core.CALLS',
    confidence: 'high',
    resolution: 'exact',
    evidenceIds: ['e-1'],
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<IntelligenceSnapshot> = {}): IntelligenceSnapshot {
  return {
    manifest: { generation: 1, schemaVersion: '1', extractorVersion: '1', status: 'ok', createdAt: '', updatedAt: '' },
    repository: { id: 'r', name: 'r', rootPath: '.', branch: 'main', headCommit: 'abc', identity: { path: '', hash: '' } },
    files: [],
    symbols: [],
    relationships: [],
    evidence: [],
    indexes: { byName: {}, byQualifiedName: {}, byPath: {}, byType: {}, incoming: {}, outgoing: {}, routeHandlers: {}, testTargets: {}, packageMembership: {}, configurationUsage: {} },
    diagnostics: [],
    ...overrides,
  };
}

function makeGroundTruth(overrides: Partial<IntelligenceGroundTruth> = {}): IntelligenceGroundTruth {
  return {
    repositoryId: 'test',
    entities: [],
    relationships: [],
    usages: [],
    flows: [],
    paths: [],
    impacts: [],
    tests: [],
    unresolved: [],
    ...overrides,
  };
}

// ── Evaluation metrics ────────────────────────────────────────────────────────

describe('computeMetrics', () => {
  it('returns correct precision/recall/F1 for perfect match', () => {
    const m = computeMetrics(5, 5, 5);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.truePositives).toBe(5);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(0);
  });

  it('returns correct values for partial match', () => {
    const m = computeMetrics(4, 6, 3);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.75);
    expect(m.f1).toBe(0.6);
  });

  it('returns 1.0 precision when no actual entities', () => {
    const m = computeMetrics(3, 0, 0);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0);
  });

  it('returns 1.0 recall when no expected entities', () => {
    const m = computeMetrics(0, 3, 0);
    expect(m.recall).toBe(1);
    expect(m.precision).toBe(0);
  });
});

describe('evaluateEntities', () => {
  it('matches entities by qualifiedName', () => {
    const expected: ExpectedEntity[] = [
      { kind: 'class', name: 'Foo', qualifiedName: 'pkg/src/Foo.ts:Foo', filePath: 'src/Foo.ts', startLine: 1, endLine: 10, confidence: 'exact' },
    ];
    const snapshot = makeSnapshot({ symbols: [makeSymbol({ qualifiedName: 'pkg/src/Foo.ts:Foo' })] });
    const result = evaluateEntities(expected, snapshot);
    expect(result.matched.size).toBe(1);
    expect(result.missingEntities).toHaveLength(0);
  });

  it('matches entities by name+filePath fallback', () => {
    const expected: ExpectedEntity[] = [
      { kind: 'class', name: 'Foo', filePath: 'src/Foo.ts', startLine: 1, endLine: 10, confidence: 'exact' },
    ];
    const snapshot = makeSnapshot({ symbols: [makeSymbol({ name: 'Foo', filePath: 'src/Foo.ts', qualifiedName: 'other:Foo' })] });
    const result = evaluateEntities(expected, snapshot);
    expect(result.matched.size).toBe(1);
  });

  it('correctly reports missing entities', () => {
    const expected: ExpectedEntity[] = [
      { kind: 'class', name: 'Foo', qualifiedName: 'pkg/Foo.ts:Foo', filePath: 'pkg/Foo.ts', startLine: 1, endLine: 10, confidence: 'exact' },
    ];
    const snapshot = makeSnapshot({ symbols: [makeSymbol({ qualifiedName: 'pkg/Bar.ts:Bar' })] });
    const result = evaluateEntities(expected, snapshot);
    expect(result.missingEntities).toContain('pkg/Foo.ts:Foo');
  });

  it('correctly reports false positive entities', () => {
    const expected: ExpectedEntity[] = [];
    const snapshot = makeSnapshot({ symbols: [makeSymbol({ qualifiedName: 'pkg/Extra.ts:Extra' })] });
    const result = evaluateEntities(expected, snapshot);
    expect(result.falsePositiveEntities).toContain('pkg/Extra.ts:Extra');
  });
});

describe('evaluateRelationships', () => {
  it('matches relationships by source/target/type', () => {
    const expected: ExpectedRelationship[] = [
      { source: 'pkg/A.ts:Foo', target: 'pkg/B.ts:Bar', type: 'imports', confidence: 'exact' },
    ];
    const snapshot = makeSnapshot({
      relationships: [makeRelationship({ source: 'pkg/A.ts:Foo', target: 'pkg/B.ts:Bar', type: 'keystone.core.IMPORTS' })],
    });
    const result = evaluateRelationships(expected, snapshot);
    expect(result.matched.size).toBe(1);
    expect(result.missingRelationships).toHaveLength(0);
  });

  it('detects false positive relationships', () => {
    const expected: ExpectedRelationship[] = [];
    const snapshot = makeSnapshot({
      relationships: [makeRelationship({ source: 'pkg/A.ts:Foo', target: 'pkg/B.ts:Bar', type: 'keystone.core.CALLS' })],
    });
    const result = evaluateRelationships(expected, snapshot);
    expect(result.falsePositiveRelationships.length).toBe(1);
  });
});

// ── Capability-specific metrics ───────────────────────────────────────────────

describe('evaluateCapabilityMetrics', () => {
  it('computes import precision/recall correctly', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ type: 'keystone.core.IMPORTS' }),
        makeRelationship({ type: 'keystone.core.IMPORTS' }),
      ],
    });
    const metrics = evaluateCapabilityMetrics(snapshot);
    expect(metrics.imports?.truePositives).toBe(2);
  });

  it('computes call precision/recall correctly', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ type: 'keystone.core.CALLS' }),
      ],
    });
    const metrics = evaluateCapabilityMetrics(snapshot);
    expect(metrics.calls?.truePositives).toBe(1);
  });

  it('computes covers precision/recall correctly', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ type: 'keystone.core.COVERS' }),
      ],
    });
    const metrics = evaluateCapabilityMetrics(snapshot);
    expect(metrics.covers?.truePositives).toBe(1);
  });

  it('returns empty metrics for unseen capability types', () => {
    const snapshot = makeSnapshot({ relationships: [] });
    const metrics = evaluateCapabilityMetrics(snapshot);
    expect(Object.keys(metrics)).toHaveLength(0);
  });
});

describe('evaluateConfidenceClassification', () => {
  it('computes accuracy correctly', () => {
    const expected: ExpectedRelationship[] = [
      { source: 'A', target: 'B', type: 'calls', confidence: 'exact' },
      { source: 'C', target: 'D', type: 'calls', confidence: 'low' },
    ];
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ source: 'A', target: 'B', type: 'keystone.core.CALLS', resolution: 'exact' }),
        makeRelationship({ source: 'C', target: 'D', type: 'keystone.core.CALLS', resolution: 'candidate' }),
      ],
    });
    const result = evaluateConfidenceClassification(expected, snapshot);
    expect(result.accuracy).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('handles missing resolution field', () => {
    const expected: ExpectedRelationship[] = [
      { source: 'A', target: 'B', type: 'calls', confidence: 'low' },
    ];
    const snapshot = makeSnapshot({
      relationships: [makeRelationship({ source: 'A', target: 'B', type: 'keystone.core.CALLS', resolution: undefined })],
    });
    const result = evaluateConfidenceClassification(expected, snapshot);
    // Default resolution is 'candidate' which maps to 'low'
    expect(result.accuracy).toBe(1);
  });
});

// ── False-positive protections ────────────────────────────────────────────────

describe('validateFalsePositives', () => {
  it('detects fabricated exact calls without evidence', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({
          type: 'keystone.core.CALLS',
          resolution: 'exact',
          evidenceIds: [],
          metadata: {},
        }),
      ],
    });
    const report = validateFalsePositives(snapshot, makeGroundTruth());
    expect(report.fabricatedExactCalls).toHaveLength(1);
  });

  it('allows exact calls with evidence', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({
          type: 'keystone.core.CALLS',
          resolution: 'exact',
          evidenceIds: ['e-1'],
        }),
      ],
    });
    const report = validateFalsePositives(snapshot, makeGroundTruth());
    expect(report.fabricatedExactCalls).toHaveLength(0);
  });

  it('does not mistake an honestly classified candidate for an exact relationship', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ resolution: 'candidate' }),
      ],
    });
    const report = validateFalsePositives(snapshot, makeGroundTruth());
    expect(report.candidateMarkedExact).toHaveLength(0);
  });

  it('detects a candidate relationship carrying exact confidence', () => {
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ resolution: 'candidate', confidence: 'exact' }),
      ],
    });
    const report = validateFalsePositives(snapshot, makeGroundTruth());
    expect(report.candidateMarkedExact).toHaveLength(1);
  });

  it('detects unresolved relationships resolved as exact', () => {
    const gt = makeGroundTruth({
      unresolved: [{ source: 'A', target: 'B', type: 'calls', reason: 'dynamic' }],
    });
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ source: 'A', target: 'B', type: 'keystone.core.CALLS', resolution: 'exact' }),
      ],
    });
    const report = validateFalsePositives(snapshot, gt);
    expect(report.unresolvedMarkedExact).toHaveLength(1);
  });

  it('allows expected test coverage relationships', () => {
    const gt = makeGroundTruth({
      tests: [{ testPath: 'tests/A.test.ts', targetEntity: 'pkg/A.ts:Foo', coverage: 'direct' }],
    });
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ source: 'tests/A.test.ts', target: 'pkg/A.ts:Foo', type: 'keystone.core.COVERS' }),
      ],
    });
    const report = validateFalsePositives(snapshot, gt);
    expect(report.fabricatedTestRelationships).toHaveLength(0);
  });

  it('detects unexpected test coverage relationships', () => {
    const gt = makeGroundTruth({ tests: [] });
    const snapshot = makeSnapshot({
      relationships: [
        makeRelationship({ source: 'tests/A.test.ts', target: 'pkg/Extra.ts:Extra', type: 'keystone.core.COVERS' }),
      ],
    });
    const report = validateFalsePositives(snapshot, gt);
    expect(report.fabricatedTestRelationships).toHaveLength(1);
  });
});

// ── Threshold validation ──────────────────────────────────────────────────────

describe('validateThresholds', () => {
  it('passes when all metrics meet thresholds', () => {
    const report = passingReport();
    expect(validateThresholds(report, DEFAULT_THRESHOLDS)).toBe(true);
  });

  it('fails when entity precision is below threshold', () => {
    const report = passingReport(); report.entityMetrics.precision = 0.8;
    expect(validateThresholds(report, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('fails when false positive exact calls exceed threshold', () => {
    const report = passingReport(); report.falsePositives.fabricatedExactCalls = ['bad-call'];
    expect(validateThresholds(report, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('fails when a candidate is promoted to exact confidence', () => {
    const report = passingReport(); report.falsePositives.candidateMarkedExact = ['bad-candidate'];
    expect(validateThresholds(report, DEFAULT_THRESHOLDS)).toBe(false);
  });
});

function passingReport(): IntelligenceEvaluationReport { const metrics = { truePositives: 1, falsePositives: 0, falseNegatives: 0, trueNegatives: 1, precision: 1, recall: 1, f1: 1, accuracy: 1 }; return { fixtureId: 'test', entityMetrics: { ...metrics }, relationshipMetrics: {}, capabilityMetrics: { imports: { ...metrics }, calls: { ...metrics }, covers: { ...metrics } }, confidenceAccuracy: 1, falsePositiveEntities: [], missingEntities: [], falsePositiveRelationships: [], missingRelationships: [], confidenceErrors: [], falsePositives: { fabricatedExactCalls: [], fabricatedUsages: [], fabricatedRoutes: [], fabricatedTestRelationships: [], fabricatedDataMappings: [], candidateMarkedExact: [], unresolvedMarkedExact: [] }, ingestionDurationMs: 0, entityCount: 1, relationshipCount: 1, generatedAt: '2026-07-17T00:00:00Z' }; }

// ── resolveRelationshipType ──────────────────────────────────────────────────

describe('resolveRelationshipType', () => {
  it('maps canonical types to simplified categories', () => {
    expect(resolveRelationshipType('keystone.core.IMPORTS')).toBe('imports');
    expect(resolveRelationshipType('keystone.core.CALLS')).toBe('calls');
    expect(resolveRelationshipType('keystone.core.REFERENCES')).toBe('references');
    expect(resolveRelationshipType('keystone.core.ROUTE_HANDLER')).toBe('route_handler');
    expect(resolveRelationshipType('keystone.core.COVERS')).toBe('covers');
    expect(resolveRelationshipType('keystone.core.MAPS_TO')).toBe('maps_to');
  });

  it('passes through unknown types', () => {
    expect(resolveRelationshipType('custom.type')).toBe('custom.type');
  });
});

// ── DEFAULT_THRESHOLDS ───────────────────────────────────────────────────────

describe('DEFAULT_THRESHOLDS', () => {
  it('contains all required fields', () => {
    const keys = Object.keys(DEFAULT_THRESHOLDS);
    expect(keys).toContain('entityPrecisionMin');
    expect(keys).toContain('entityRecallMin');
    expect(keys).toContain('importPrecisionMin');
    expect(keys).toContain('callPrecisionMin');
    expect(keys).toContain('coversPrecisionMin');
    expect(keys).toContain('confidenceAccuracyMin');
    expect(keys).toContain('falsePositiveExactCalls');
    expect(keys).toContain('falsePositiveUnresolvedAsExact');
    expect(keys).toContain('staleGenerationAllowed');
    expect(keys).toContain('excludedDirLeakage');
    expect(keys).toContain('testFileIndexed');
    expect(keys).toContain('candidateNotExact');
  });
});
