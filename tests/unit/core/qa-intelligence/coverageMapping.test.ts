/**
 * Tests for per-test coverage mapping.
 */

import { describe, it, expect, beforeEach } from '../../../support/testkit';
import { CoverageIndexManager, createCoverageAdapter, VitestAdapter, JestAdapter } from '@core/workflow/quality/coverageMapping';
import type { TestCoverage, TestFramework } from '@core/workflow/quality/coverageMapping';

function makeTestCoverage(overrides: Partial<TestCoverage> = {}): TestCoverage {
  return {
    testPath: 'src/__tests__/test.ts',
    testName: 'test',
    coveredFiles: [
      { filePath: 'src/index.ts', lines: [1, 2, 3] },
    ],
    framework: 'vitest',
    builtAtCommit: 'abc123',
    builtAt: Date.now(),
    ...overrides,
  };
}

describe('CoverageIndexManager', () => {
  let manager: CoverageIndexManager;

  beforeEach(() => {
    manager = new CoverageIndexManager({
      stalenessThresholdMs: 60 * 60 * 1000, // 1 hour for testing
    });
  });

  it('should start with no index', () => {
    expect(manager.getIndex()).toBeNull();
    expect(manager.isStale()).toBe(true);
  });

  it('should update the index', () => {
    const coverage = [makeTestCoverage()];
    manager.updateIndex(coverage);

    expect(manager.getIndex()).toBeDefined();
    expect(manager.getIndex()!.testCount).toBe(1);
    expect(manager.isStale()).toBe(false);
  });

  it('should get tests for a file', () => {
    const coverage = [
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/a.ts', lines: [1, 2] }] }),
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/b.ts', lines: [1, 2] }] }),
    ];
    manager.updateIndex(coverage);

    const testsForA = manager.getTestsForFile('src/a.ts');
    expect(testsForA).toHaveLength(1);
  });

  it('should get tests for a line', () => {
    const coverage = [
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/a.ts', lines: [1, 2, 3] }] }),
    ];
    manager.updateIndex(coverage);

    const testsForLine2 = manager.getTestsForLine('src/a.ts', 2);
    expect(testsForLine2).toHaveLength(1);

    const testsForLine5 = manager.getTestsForLine('src/a.ts', 5);
    expect(testsForLine5).toHaveLength(0);
  });

  it('should get affected tests from changed files (git diff inversion)', () => {
    const coverage = [
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/a.ts', lines: [1, 2] }] }),
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/b.ts', lines: [1, 2] }] }),
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/c.ts', lines: [1, 2] }] }),
    ];
    manager.updateIndex(coverage);

    const affected = manager.getAffectedTests(['src/a.ts', 'src/b.ts']);
    expect(affected).toHaveLength(2);
  });

  it('should return empty for unchanged files', () => {
    const coverage = [
      makeTestCoverage({ coveredFiles: [{ filePath: 'src/a.ts', lines: [1, 2] }] }),
    ];
    manager.updateIndex(coverage);

    const affected = manager.getAffectedTests(['src/unchanged.ts']);
    expect(affected).toHaveLength(0);
  });

  it('should clear the index', () => {
    manager.updateIndex([makeTestCoverage()]);
    expect(manager.getIndex()).toBeDefined();

    manager.clear();
    expect(manager.getIndex()).toBeNull();
    expect(manager.isStale()).toBe(true);
  });

  it('should detect staleness after threshold', () => {
    manager.updateIndex([makeTestCoverage()]);
    expect(manager.isStale()).toBe(false);

    // Simulate time passing by updating with old timestamp
    const oldIndex = {
      ...manager.getIndex()!,
      builtAt: Date.now() - 2 * 60 * 60 * 1000,
    };
    // Directly set the index to simulate staleness
    (manager as any).index = oldIndex;

    expect(manager.isStale()).toBe(true);
  });
});

describe('CoverageAdapter', () => {
  it('should create vitest adapter', () => {
    const adapter = createCoverageAdapter('vitest');
    expect(adapter.framework).toBe('vitest');
  });

  it('should create jest adapter', () => {
    const adapter = createCoverageAdapter('jest');
    expect(adapter.framework).toBe('jest');
  });

  it('should throw for unsupported framework', () => {
    expect(() => createCoverageAdapter('unknown')).toThrow();
  });
});

describe('VitestAdapter.parseCoverage', () => {
  const adapter = new VitestAdapter();

  it('should parse vitest V8 coverage format', () => {
    const vitestCoverage = {
      reportMetadata: {
        coverageMap: {
          'src/math.ts': {
            path: 'src/math.ts',
            s: { '1': 5, '2': 3, '3': 1 },
            f: { 'add': 5, 'subtract': 3 },
            b: { '1': [2, 0] },
          },
        },
      },
    };

    const result = adapter.parseCoverage(JSON.stringify(vitestCoverage));

    expect(result.length).toBe(1);
    expect(result[0].framework).toBe('vitest');
    expect(result[0].coveredFiles.length).toBe(1);
    expect(result[0].coveredFiles[0].lines).toEqual([1, 2, 3]);
    expect(result[0].coveredFiles[0].functions).toEqual(['add', 'subtract']);
  });

  it('should return empty array for invalid JSON', () => {
    const result = adapter.parseCoverage('not json');
    expect(result).toEqual([]);
  });

  it('should return empty array when no coverage map found', () => {
    const result = adapter.parseCoverage(JSON.stringify({}));
    expect(result).toEqual([]);
  });
});

describe('JestAdapter.parseCoverage', () => {
  const adapter = new JestAdapter();

  it('should parse jest coverage format', () => {
    const jestCoverage = {
      files: [
        {
          path: 'src/user.ts',
          statementMap: { '0': { start: { line: 1, column: 0 } } },
          s: { '0': 1, '1': 0 },
          fnMap: { 'getUser': { name: 'getUser' } },
        },
      ],
    };

    const result = adapter.parseCoverage(JSON.stringify(jestCoverage));

    expect(result.length).toBe(1);
    expect(result[0].framework).toBe('jest');
    expect(result[0].coveredFiles[0].filePath).toBe('src/user.ts');
    expect(result[0].coveredFiles[0].lines).toEqual([0]);
    expect(result[0].coveredFiles[0].functions).toEqual(['getUser']);
  });

  it('should return empty array for invalid JSON', () => {
    const result = adapter.parseCoverage('invalid');
    expect(result).toEqual([]);
  });
});
