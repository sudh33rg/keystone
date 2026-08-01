import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '../../../support/testkit';
import { executeTests } from '../../../../src/core/workflow/quality/testExecution';

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'keystone-test-exec-'));
  roots.push(root);
  return root;
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('test execution', () => {
  it('executes the built filtered command and parses counts without looping', async () => {
    const root = fixture();
    writeFileSync(join(root, 'runner.js'), "console.log(process.argv.slice(2).join('|')); console.log('3 tests passed');\n");
    const result = await executeTests({ command: 'node runner.js', cwd: root, testPathPattern: 'tests/a test.ts', timeoutMs: 2_000 });
    expect(result.exitCode).toBe(0);
    expect(result.command).toContain("'tests/a test.ts'");
    expect(result.output).toContain('tests/a test.ts');
    expect(result.passed).toBe(3);
  });

  it('resolves a timed-out command instead of leaving the caller pending', async () => {
    const root = fixture();
    writeFileSync(join(root, 'slow.js'), 'setTimeout(() => {}, 5000);\n');
    const result = await executeTests({ command: 'node slow.js', cwd: root, timeoutMs: 40 });
    expect(result.exitCode).toBe(-1);
    expect(result.output).toContain('Keystone terminated the test command');
  });

  it('aborts a running command cooperatively', async () => {
    const root = fixture();
    writeFileSync(join(root, 'slow.js'), 'setTimeout(() => {}, 5000);\n');
    const controller = new AbortController();
    const promise = executeTests({ command: 'node slow.js', cwd: root, timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 40);
    const result = await promise;
    expect(result.exitCode).toBe(-2);
  });
});
