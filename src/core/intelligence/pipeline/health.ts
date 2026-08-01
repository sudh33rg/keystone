import type { RepoIntelligence } from '../../domain/types';
import type { IntelligenceIngestionSummary, IntelligenceStageResult } from './types';
import type { RuntimeVerification } from './runtime';

export interface IntelligenceHealthReport {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly score: number;
  readonly checks: ReadonlyArray<{ id: string; passed: boolean; score: number; detail: string }>;
}

export function evaluateIntelligenceHealth(
  intelligence: RepoIntelligence,
  stages: readonly IntelligenceStageResult[],
  ingestion: IntelligenceIngestionSummary,
  runtime?: RuntimeVerification
): IntelligenceHealthReport {
  const local = intelligence.dependencies.filter(edge => edge.kind === 'local');
  const filePaths = new Set(intelligence.files.map(file => file.path));
  const resolvedLocal = local.filter(edge => filePaths.has(edge.to)).length;
  const tests = intelligence.tests;
  const mappedTests = tests.filter(test => test.targetFile && filePaths.has(test.targetFile)).length;
  const eligible = ingestion.cpgEligibleFiles;
  const checks = [
    check('stages', stages.every(stage => stage.status === 'complete'), ratio(stages.filter(stage => stage.status === 'complete').length, stages.length), `${stages.filter(stage => stage.status === 'complete').length}/${stages.length} stages complete`),
    check('coverage', ingestion.completedWithoutFileCap, ingestion.completedWithoutFileCap ? 1 : 0.5, ingestion.completedWithoutFileCap ? 'All discovered supported files were processed without a file cap' : 'Discovery did not complete'),
    check('local-imports', local.length === 0 || resolvedLocal === local.length, local.length === 0 ? 1 : ratio(resolvedLocal, local.length), `${resolvedLocal}/${local.length} local imports resolve to indexed files`),
    check('test-mapping', tests.length === 0 || mappedTests === tests.length, tests.length === 0 ? 1 : ratio(mappedTests, tests.length), `${mappedTests}/${tests.length} tests map to indexed source files`),
    check('cpg-coverage', eligible === 0 || ingestion.cpgIndexedFiles === eligible, eligible === 0 ? 1 : ratio(ingestion.cpgIndexedFiles, eligible), `${ingestion.cpgIndexedFiles}/${eligible} eligible files received CPG projections`)
  ];
  const cpgStage = stages.find(stage => stage.id === 'code-property-graph');
  if (cpgStage) {
    const configuredDiagnostics = Number(cpgStage.metrics.configuredCompilerDiagnostics ?? 0);
    checks.push(check('semantic-diagnostics', configuredDiagnostics === 0, configuredDiagnostics === 0 ? 1 : 0, `${configuredDiagnostics} compiler diagnostic(s) were observed in configured TypeScript projects`));
    const fallbackDiagnostics = Number(cpgStage.metrics.fallbackCompilerDiagnostics ?? 0);
    const fallbackFiles = Number(cpgStage.metrics.fallbackSemanticFiles ?? 0);
    const fallbackScore = fallbackFiles === 0 ? 1 : Math.max(0, 1 - fallbackDiagnostics / Math.max(fallbackFiles * 2, 1));
    checks.push(check('fallback-semantic-diagnostics', fallbackDiagnostics === 0, fallbackScore, `${fallbackDiagnostics} compiler diagnostic(s) were observed across ${fallbackFiles} files without a dedicated tsconfig`));
  }
  if (runtime) {
    checks.push(check(
      'runtime-evidence',
      !runtime.degraded,
      runtime.degraded ? 0.5 : 1,
      runtime.degraded ? runtime.warnings.join(' ') || 'Runtime evidence is unavailable' : `${runtime.evidence.length} runtime evidence signal(s) mapped`
    ));
  }
  const score = Math.round(checks.reduce((sum, item) => sum + item.score, 0) / checks.length * 100);
  return { status: score < 50 || stages.some(stage => stage.status === 'failed') ? 'unhealthy' : score < 90 ? 'degraded' : 'healthy', score, checks };
}

function check(id: string, passed: boolean, score: number, detail: string) {
  return { id, passed, score: Math.max(0, Math.min(1, score)), detail };
}

function ratio(value: number, total: number): number {
  return total === 0 ? 1 : value / total;
}
