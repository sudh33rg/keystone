import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '../../../support/testkit';

import { analyzeTypeScriptProject } from '@core/intelligence/cpg';

const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('analyzeTypeScriptProject', () => {
  it('uses tsconfig aliases and the type checker to bind calls to declarations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-semantic-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } }, include: ['src'] }));
    fs.writeFileSync(path.join(root, 'src', 'math.ts'), 'export function double(value: number) { return value * 2; }\n');
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), "import { double } from '@app/math';\nexport const result = double(2);\n[1].map(value => double(value));\n");
    fs.writeFileSync(path.join(root, 'src', 'types.ts'), 'export interface Runnable { run(): void; }\nexport class Base { run() {} }\nexport class Job extends Base implements Runnable { run() {} }\n');

    const result = analyzeTypeScriptProject(root, ['src/math.ts', 'src/main.ts', 'src/types.ts']);
    expect(result.projectConfig).toBe('tsconfig.json');
    expect(result.diagnostics).toBe(0);
    expect(result.calls).toContainEqual({
      sourcePath: 'src/main.ts', sourceLine: 2, callee: 'double',
      targetPath: 'src/math.ts', targetLine: 1, confidence: 1
    });
    expect(result.relationships).toContainEqual({
      kind: 'implements', sourcePath: 'src/types.ts', sourceLine: 3, sourceName: 'Job',
      targetPath: 'src/types.ts', targetLine: 1, targetName: 'Runnable', confidence: 1
    });
    expect(result.callbacks).toContainEqual(expect.objectContaining({ registrar: '[1].map', callback: '<anonymous>', sourcePath: 'src/main.ts', sourceLine: 3, confidence: 1 }));
    expect(result.relationships).toContainEqual({
      kind: 'overrides', sourcePath: 'src/types.ts', sourceLine: 3, sourceName: 'Job.run',
      targetPath: 'src/types.ts', targetLine: 2, targetName: 'Base.run', confidence: 1
    });
  });
});
