import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '../../../support/testkit';

import { buildRepositoryIntelligence, INTELLIGENCE_FAMILIES, INTELLIGENCE_STAGES, IntelligencePipelineCancelledError } from '@core/intelligence/pipeline';

const roots: string[] = [];
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-intelligence-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'vitest' }, dependencies: { react: '^19' } }));
  fs.writeFileSync(path.join(root, 'src', 'api.ts'), "import { save } from './repository';\nexport function route() { return save(); }\n");
  fs.writeFileSync(path.join(root, 'src', 'repository.ts'), 'export function save() { return true; }\n');
  fs.writeFileSync(path.join(root, 'tests', 'api.test.ts'), "import { route } from '../src/api';\ndescribe('api', () => it('works', () => route()));\n");
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture');
  return root;
}

afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('repository intelligence pipeline', () => {
  it('executes all stages in canonical order and summarizes active families', async () => {
    const root = fixture();
    const events: string[] = [];
    const snapshot = await buildRepositoryIntelligence(root, { cognitive: true, onProgress: (event) => events.push(event.stage) });

    expect(snapshot.stages.map((stage) => stage.id)).toEqual([...INTELLIGENCE_STAGES]);
    expect(snapshot.stages.every((stage) => stage.status === 'complete')).toBe(true);
    expect(snapshot.families.map((family) => family.id)).toEqual([...INTELLIGENCE_FAMILIES]);
    expect(snapshot.stages.filter((stage) => stage.cognitivelyEnriched).map((stage) => stage.id)).toEqual([
      'architecture', 'impact', 'context', 'sdlc-workflow', 'risk', 'documentation'
    ]);
    expect(events.at(-1)).toBe('runtime-observability');
    expect(fs.existsSync(path.join(root, '.keystone', 'intelligence', 'snapshot.json'))).toBe(true);
    expect(fs.readdirSync(path.join(root, '.keystone', 'intelligence', 'stages'))).toHaveLength(INTELLIGENCE_STAGES.length);
    expect(snapshot.ingestion).toEqual(expect.objectContaining({
      indexedFiles: 6,
      cpgEligibleFiles: 6,
      cpgIndexedFiles: 6,
      cpgShardsWritten: 6,
      discoveryMode: 'unbounded-incremental',
      completedWithoutFileCap: true
    }));
    expect(snapshot.ingestion.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.health.status).toBe('healthy');
    expect(snapshot.health.score).toBe(94);
    expect(snapshot.health.checks.find((check) => check.id === 'fallback-semantic-diagnostics')).toEqual(expect.objectContaining({ passed: true }));
    expect(snapshot.health.checks.find((check) => check.id === 'runtime-evidence')).toEqual(expect.objectContaining({ passed: false }));
    expect(snapshot.incremental.action).toBe('full');
    const apiDependency = snapshot.intelligence.dependencies.find((edge) =>
      edge.from === 'src/api.ts' &&
      edge.to === 'src/repository.ts' &&
      edge.kind === 'local'
    );
    expect(apiDependency).toEqual(expect.objectContaining({ from: 'src/api.ts', to: 'src/repository.ts', kind: 'local' }));
    expect(apiDependency?.evidence).toEqual(expect.objectContaining({
      source: 'heuristic',
      confidence: expect.any(Number),
      evidencePath: 'src/api.ts'
    }));
    expect(snapshot.intelligence.tests).toContainEqual(expect.objectContaining({
      testFile: 'tests/api.test.ts',
      targetFile: 'src/api.ts',
      confidence: 0.95,
      reason: 'test directly imports source file'
    }));
  });

  it('classifies an unchanged persisted repository for incremental skipping', async () => {
    const root = fixture();
    const first = await buildRepositoryIntelligence(root, { cognitive: false });
    const second = await buildRepositoryIntelligence(root, { cognitive: false });
    expect(second.incremental.action).toBe('skip');
    expect(second.incremental.filesToAnalyze).toEqual([]);
    expect(second.ingestion.reusedFiles).toBe(6);
    expect(second.ingestion.analyzedFiles).toBe(0);
    expect(second.ingestion.cpgShardsReused).toBe(6);
    expect(second.intelligence.symbols).toEqual(first.intelligence.symbols);
    expect(second.intelligence.dependencies).toEqual(first.intelligence.dependencies);
    expect(second.intelligence.apis).toEqual(first.intelligence.apis);
    expect(second.intelligence.tests).toEqual(first.intelligence.tests);
  });

  it('updates canonical cognitive knowledge without accumulating stale run entities', async () => {
    const root = fixture();
    await buildRepositoryIntelligence(root, { cognitive: true });
    await buildRepositoryIntelligence(root, { cognitive: true });

    const unitsPath = path.join(root, '.keystone', 'intelligence', 'okf', 'knowledge', 'units.jsonl');
    const units = fs.readFileSync(unitsPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { id: string; canonicalKey: string; lifecycle: string });
    expect(units.length).toBeGreaterThan(0);
    expect(new Set(units.map((entry) => entry.id)).size).toBe(units.length);
    expect(new Set(units.map((entry) => entry.canonicalKey)).size).toBe(units.length);
    expect(units.every((entry) => entry.lifecycle === 'active')).toBe(true);
    expect(fs.existsSync(path.join(root, '.keystone', 'knowledge'))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.keystone', 'intelligence', 'okf', 'manifest.json'), 'utf8')) as { parentExtractionRunId?: string; validation: { valid: boolean } };
    expect(manifest.validation.valid).toBe(true);
    expect(manifest.parentExtractionRunId).toBeDefined();
  });

  it('does not write index artifacts when persistence is disabled', async () => {
    const root = fixture();
    await buildRepositoryIntelligence(root, { persist: false, cognitive: false });
    expect(fs.existsSync(path.join(root, '.keystone', 'intelligence'))).toBe(false);
  });

  it('honors cancellation before ordered stage execution', async () => {
    const root = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(buildRepositoryIntelligence(root, { signal: controller.signal, cognitive: false })).rejects.toBeInstanceOf(IntelligencePipelineCancelledError);
    expect(fs.existsSync(path.join(root, '.keystone', 'intelligence', 'snapshot.json'))).toBe(false);
  });
});
