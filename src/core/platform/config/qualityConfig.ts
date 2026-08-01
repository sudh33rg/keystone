/**
 * Runtime QA configuration.
 *
 * Repository discovery, impact analysis, and test planning deliberately have no
 * file-count or item-count ceilings. They operate over all indexed evidence and
 * remain cancellable/non-blocking at their call sites. The settings below are
 * execution-safety controls for repeated processes, not repository budgets.
 */
export interface TestDiscoveryConfig {
  includeHidden?: boolean;
  extraPatterns?: string[];
}

export interface FlakyDetectionConfig {
  runs?: number;
  threshold?: number;
  timeoutMs?: number;
  skipQuarantined?: boolean;
}

export interface QuarantineConfig {
  threshold?: number;
  ttlMs?: number;
}

export interface TestExecutionConfig {
  testCommand?: string;
  maxWorkers?: number;
  timeoutMs?: number;
  excludeQuarantined?: boolean;
}

export interface QAConfig {
  discovery: TestDiscoveryConfig;
  flakyDetection: FlakyDetectionConfig;
  quarantine: QuarantineConfig;
  execution: TestExecutionConfig;
}

export const DEFAULT_QA_CONFIG: QAConfig = {
  discovery: { includeHidden: false, extraPatterns: [] },
  flakyDetection: { runs: 5, threshold: 0.2, timeoutMs: 30_000, skipQuarantined: false },
  quarantine: { threshold: 0.5, ttlMs: 7 * 24 * 60 * 60 * 1000 },
  execution: { testCommand: undefined, maxWorkers: 4, timeoutMs: 300_000, excludeQuarantined: true },
};

export function loadConfig(filePath: string): QAConfig {
  try {
    const fs = require('node:fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    return merge(DEFAULT_QA_CONFIG, JSON.parse(content) as Partial<QAConfig>);
  } catch {
    return structuredClone(DEFAULT_QA_CONFIG);
  }
}

function merge(defaults: QAConfig, overrides: Partial<QAConfig>): QAConfig {
  return {
    discovery: { ...defaults.discovery, ...(overrides.discovery ?? {}) },
    flakyDetection: { ...defaults.flakyDetection, ...(overrides.flakyDetection ?? {}) },
    quarantine: { ...defaults.quarantine, ...(overrides.quarantine ?? {}) },
    execution: { ...defaults.execution, ...(overrides.execution ?? {}) },
  };
}
