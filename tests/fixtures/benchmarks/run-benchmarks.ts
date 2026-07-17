#!/usr/bin/env node
// CLI benchmark runner — runs all fixtures and produces a terminal summary.
// Usage: npx tsx tests/fixtures/benchmarks/run-benchmarks.ts [--report-dir <dir>]

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateFixture, DEFAULT_THRESHOLDS, type IntelligenceSnapshot } from './evaluate';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMetrics(metrics: ReturnType<typeof evaluateFixture>['entityMetrics']): string {
  const p = metrics.precision.toFixed(3);
  const r = metrics.recall.toFixed(3);
  const f = metrics.f1.toFixed(3);
  return `${p} / ${r} / ${f}`;
}

function formatFP(fp: ReturnType<typeof evaluateFixture>['falsePositives']): string {
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
    const gtModule = await import(gtUrl.href);
    const groundTruth = gtModule.groundTruth;

    // Load synthetic snapshot (each fixture ships a snapshot.json)
    const snapshotPath = join(fixturePath, 'snapshot.json');
    let snapshot: IntelligenceSnapshot;
    try {
      const snapshotRaw = readFileSync(snapshotPath, 'utf-8');
      snapshot = JSON.parse(snapshotRaw);
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
    const passed = report.entityMetrics.precision >= DEFAULT_THRESHOLDS.entityPrecisionMin
      && report.entityMetrics.recall >= DEFAULT_THRESHOLDS.entityRecallMin;

    results.push({ fixture, report, passed });
    if (!passed) anyFailed = true;
  }

  // ── Terminal summary ──────────────────────────────────────────────────────

  console.log('\n  Benchmark Report');
  console.log('  ' + '─'.repeat(72));
  console.log('  %-24s  %10s  %10s  %10s  %s', 'Fixture', 'precision', 'recall', 'f1', 'false positives');
  console.log('  ' + '─'.repeat(72));

  for (const { fixture, report, passed } of results) {
    const status = passed ? '✓' : '✗';
    const [p, r, f] = formatMetrics(report.entityMetrics).split(' / ');
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
