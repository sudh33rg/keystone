import fs from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { createGapAnalyzer } from '@core/workflow/quality/qaGapAnalysis';
import { analyzeRepositoryPerformance, analyzeRepositorySecurity } from '@core/intelligence/analysis';
import { RepositoryModelBuilder } from '@core/intelligence/repository/model-builder';
import { ModernizationPlatformApi } from '@core/workflow/modernization/modernization-api';

type WorkerKind = 'qa' | 'security' | 'performance' | 'modernization';
const input = workerData as { kind: WorkerKind; root: string };

async function persist(name: string, value: unknown): Promise<void> {
  const target = path.join(input.root, '.keystone', 'background', `${name}.json`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

async function run(): Promise<unknown> {
  if (input.kind === 'qa') return createGapAnalyzer({ workspaceRoot: input.root }).analyzeQuick();
  if (input.kind === 'security') return analyzeRepositorySecurity(input.root);
  if (input.kind === 'performance') return analyzeRepositoryPerformance(input.root);
  const builder = new RepositoryModelBuilder();
  const repository = builder.build(input.root);
  return new ModernizationPlatformApi().propose({ repository, scanScope: { expectedFiles: repository.files.length, indexedFiles: repository.files.length, excludedPaths: builder.getExcludedPaths() } });
}

void run().then(async result => {
  await persist(input.kind, result);
  parentPort?.postMessage({ kind: input.kind, status: 'complete', result });
}).catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  await persist(input.kind, { kind: input.kind, status: 'failed', error: message, generatedAt: new Date().toISOString() }).catch(() => undefined);
  parentPort?.postMessage({ kind: input.kind, status: 'failed', error: message });
});
