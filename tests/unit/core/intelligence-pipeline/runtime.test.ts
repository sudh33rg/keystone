import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '../../../support/testkit';
import { buildRuntimeVerification, evaluateRemediationGate } from '@core/intelligence/pipeline/runtime';

const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('runtime verification and remediation gate', () => {
  it('correlates runtime evidence and allows only bounded, validated, approved remediation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-runtime-')); roots.push(root);
    fs.mkdirSync(path.join(root, '.keystone'), { recursive: true });
    fs.writeFileSync(path.join(root, '.keystone', 'telemetry-map.json'), JSON.stringify({ mappings: [{ id: 'trace-1', behaviorType: 'trace', sourcePath: 'src/auth.ts', signal: 'POST /login' }] }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    const verification = await buildRuntimeVerification(root, [{ id: 'finding-1', category: 'security', severity: 'medium', confidence: 0.6, title: 'Auth', description: '', filePath: 'src/auth.ts', evidence: [], provenance: 'test', remediation: '', lifecycle: 'active' }]);
    expect(verification.correlations).toEqual([{ findingId: 'finding-1', evidenceIds: ['trace-1'], confidence: 0.8 }]);
    expect(evaluateRemediationGate({ verification, affectedFiles: ['src/auth.ts'], approval: 'granted' })).toEqual({ allowed: true, reasons: [] });
    expect(evaluateRemediationGate({ verification, affectedFiles: ['src/auth.ts'], approval: 'required' }).allowed).toBe(false);
  });

  it('degrades safely without runtime evidence or validation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-runtime-empty-')); roots.push(root);
    const verification = await buildRuntimeVerification(root, []);
    expect(verification.degraded).toBe(true);
    expect(evaluateRemediationGate({ verification, affectedFiles: [], approval: 'required' }).allowed).toBe(false);
  });
});

