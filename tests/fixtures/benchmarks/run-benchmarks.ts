#!/usr/bin/env node
// CLI benchmark runner — runs all fixtures and produces a terminal summary.
// Usage: npm run test:intelligence-benchmark -- [--report-dir <dir>]

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IntelligenceEvaluationReport, IntelligenceGroundTruth, IntelligenceSnapshot, ThresholdConfig } from './evaluate';

interface EvaluatorModule {
  evaluateFixture: (fixtureId: string, snapshot: IntelligenceSnapshot, groundTruth: IntelligenceGroundTruth, ingestionDurationMs: number) => IntelligenceEvaluationReport;
  validateThresholds: (report: IntelligenceEvaluationReport, thresholds?: ThresholdConfig) => boolean;
  DEFAULT_THRESHOLDS: ThresholdConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMetrics(metrics: IntelligenceEvaluationReport['entityMetrics']): string {
  const p = metrics.precision.toFixed(3);
  const r = metrics.recall.toFixed(3);
  const f = metrics.f1.toFixed(3);
  return `${p} / ${r} / ${f}`;
}

function formatFP(fp: IntelligenceEvaluationReport['falsePositives']): string {
  const parts: string[] = [];
  if (fp.fabricatedExactCalls.length) parts.push(`calls:${fp.fabricatedExactCalls.length}`);
  if (fp.fabricatedUsages.length) parts.push(`usages:${fp.fabricatedUsages.length}`);
  if (fp.fabricatedRoutes.length) parts.push(`routes:${fp.fabricatedRoutes.length}`);
  if (fp.fabricatedTestRelationships.length) parts.push(`tests:${fp.fabricatedTestRelationships.length}`);
  if (fp.fabricatedDataMappings.length) parts.push(`maps:${fp.fabricatedDataMappings.length}`);
  if (fp.candidateMarkedExact.length) parts.push(`cand→exact:${fp.candidateMarkedExact.length}`);
  if (fp.unresolvedMarkedExact.length) parts.push(`unres→exact:${fp.unresolvedMarkedExact.length}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const evaluatorUrl = pathToFileURL(join(process.cwd(), 'tests/fixtures/benchmarks/evaluate.ts'));
  const evaluator = await loadModule(evaluatorUrl.href) as EvaluatorModule;
  const { evaluateFixture, validateThresholds, DEFAULT_THRESHOLDS } = evaluator;
  const args = process.argv.slice(2);
  let reportDir = join(process.cwd(), 'tests/fixtures/benchmarks/reports');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report-dir') {
      const next = args[i + 1];
      if (next) {
        reportDir = resolve(next);
        i++;
      }
    }
  }

  // Scan for fixtures
  const fixturesDir = join(process.cwd(), 'tests/fixtures/benchmarks');
  const entries = readdirSync(fixturesDir).filter((e) => {
    const full = join(fixturesDir, e);
    try {
      return readdirSync(full).includes('ground-truth.ts');
    } catch {
      return false; // not a directory
    }
  });

  if (entries.length === 0) {
    console.error('No fixtures found with ground-truth.ts');
    process.exit(1);
  }

  mkdirSync(reportDir, { recursive: true });

  const results: Array<{ fixture: string; report: ReturnType<typeof evaluateFixture>; passed: boolean }> = [];
  let anyFailed = false;

  for (const fixture of entries) {
    const fixturePath = join(fixturesDir, fixture);

    // Load ground truth
    const gtUrl = pathToFileURL(join(fixturePath, 'ground-truth.ts'));
    const groundTruth = readGroundTruth(await loadModule(gtUrl.href));

    // Load synthetic snapshot (each fixture ships a snapshot.json)
    const snapshotPath = join(fixturePath, 'snapshot.json');
    let snapshot: IntelligenceSnapshot;
    try {
      const snapshotRaw = readFileSync(snapshotPath, 'utf-8');
      snapshot = readSnapshot(snapshotRaw);
    } catch {
      console.error(`  ⚠ ${fixture}: no snapshot.json — skipping`);
      continue;
    }

    // Run evaluation
    const report = evaluateFixture(
      groundTruth.repositoryId,
      snapshot,
      groundTruth,
      0
    );
    const passed = validateThresholds(report, DEFAULT_THRESHOLDS);

    results.push({ fixture, report, passed });
    if (!passed) anyFailed = true;
  }

  // ── Terminal summary ──────────────────────────────────────────────────────

  console.log('\n  Benchmark Report');
  console.log('  ' + '─'.repeat(72));
  console.log(`  ${'Fixture'.padEnd(24)}  ${'precision'.padStart(10)}  ${'recall'.padStart(10)}  ${'f1'.padStart(10)}  false positives`);
  console.log('  ' + '─'.repeat(72));

  for (const { fixture, report, passed } of results) {
    const status = passed ? '✓' : '✗';
    const [p = '0.000', r = '0.000', f = '0.000'] = formatMetrics(report.entityMetrics).split(' / ');
    console.log(`  ${status} ${fixture.padEnd(22)}  ${p.padStart(10)}  ${r.padStart(10)}  ${f.padStart(10)}  ${formatFP(report.falsePositives)}`);
  }

  console.log('  ' + '─'.repeat(72));

  // ── Save detailed reports ─────────────────────────────────────────────────

  for (const { fixture, report } of results) {
    writeFileSync(
      join(reportDir, `${fixture}.json`),
      JSON.stringify(report, null, 2)
    );
  }

  console.log(`\n  ${results.length} fixtures evaluated, ${results.filter(r => r.passed).length} passed`);
  console.log(`  Reports saved to ${reportDir}\n`);

  if (anyFailed) process.exit(1);
}

async function loadModule(url: string): Promise<unknown> { return import(url) as Promise<unknown>; }
function readGroundTruth(value: unknown): IntelligenceGroundTruth { if (!value || typeof value !== 'object' || !('groundTruth' in value)) throw new Error('The benchmark ground-truth module does not export groundTruth.'); const groundTruth: unknown = value.groundTruth; if (!groundTruth || typeof groundTruth !== 'object' || !('repositoryId' in groundTruth) || typeof groundTruth.repositoryId !== 'string' || !('entities' in groundTruth) || !Array.isArray(groundTruth.entities) || !('relationships' in groundTruth) || !Array.isArray(groundTruth.relationships)) throw new Error('The benchmark ground truth has an invalid shape.'); return groundTruth as IntelligenceGroundTruth; }
function readSnapshot(text: string): IntelligenceSnapshot { const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || !('manifest' in value) || !('symbols' in value) || !Array.isArray(value.symbols) || !('relationships' in value) || !Array.isArray(value.relationships)) throw new Error('The benchmark snapshot has an invalid shape.'); return value as IntelligenceSnapshot; }

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
