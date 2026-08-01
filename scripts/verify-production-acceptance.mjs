import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'keystone-production-acceptance-'));
const verifier = path.join(root, 'scripts', 'verify-production-cockpit.mjs');

try {
  await copyActualProject(root, workspaceRoot);
  const run = async mode => {
    const outputPath = path.join(workspaceRoot, `.acceptance-${mode}.json`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [verifier, workspaceRoot, mode, outputPath], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=2048' },
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Production ${mode} verifier exited with ${code}.`)));
    });
    return JSON.parse(await fsp.readFile(outputPath, 'utf8'));
  };

  console.error('[production-acceptance] persisted index');
  const index = await run('index');
  console.error(`[production-acceptance] index ready in ${index.elapsedMs}ms`);
  await new Promise(resolve => setTimeout(resolve, 250));
  console.error('[production-acceptance] authoritative query');
  const query = await run('query');
  console.error(`[production-acceptance] query ready in ${query.elapsedMs}ms`);
  await new Promise(resolve => setTimeout(resolve, 250));
  console.error('[production-acceptance] intent analysis');
  const analyze = await run('analyze');
  console.error(`[production-acceptance] intent ready in ${analyze.elapsedMs}ms`);
  assert(index.status === 'ready', 'Built production CockpitService did not complete persisted indexing.');
  assert(index.okfValid === true, 'Built production CockpitService did not promote a validated OKF snapshot.');
  assert(query.queryResults > 0 && query.queryEvidenceResults > 0, 'Persisted production snapshot returned no provenance-backed query result.');
  assert(/^okf-/.test(analyze.intentRetrievalMode), 'Production intent retrieval did not use authoritative OKF first.');
  assert(analyze.readOnlyGitEvidence === true, 'Production intent analysis did not attach read-only Git evidence.');
  assert(index.fileCount >= 100, `Production project indexed only ${index.fileCount} files.`);

  const report = {
    verifiedAt: new Date().toISOString(),
    sourceFingerprint: await sourceFingerprint(root),
    source: 'clean copy of current Keystone source/tests/scripts/config; generated state and build outputs excluded',
    ...index,
    ...query,
    ...analyze,
    indexElapsedMs: index.elapsedMs,
    queryElapsedMs: query.elapsedMs,
    intentElapsedMs: analyze.elapsedMs,
    persisted: true,
  };
  await fsp.mkdir(path.join(root, 'dist', 'evidence'), { recursive: true });
  await fsp.writeFile(path.join(root, 'dist', 'evidence', 'production-cockpit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await mergeCrossFeatureReport(report);
  console.log(JSON.stringify(report));
} finally {
  await removeTreeConcurrent(workspaceRoot);
}
// This file is a finite CLI orchestrator, not a product runtime. Each built
// Cockpit acceptance action above runs in its own process and must already have
// exited successfully. Terminate the orchestrator explicitly after its report
// and cleanup so inherited npm/stdio handles cannot make a successful source
// gate environment-dependent.
process.exit(0);


async function removeTreeConcurrent(target) {
  if (!fs.existsSync(target)) return;
  const files = [];
  const directories = [];
  const stack = [target];
  while (stack.length) {
    const directory = stack.pop();
    directories.push(directory);
    let entries = [];
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
      else files.push(full);
    }
  }
  for (let start = 0; start < files.length; start += 256) {
    await Promise.all(files.slice(start, start + 256).map(file => fsp.unlink(file).catch(() => undefined)));
  }
  directories.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const directory of directories) await fsp.rmdir(directory).catch(() => undefined);
}

async function mergeCrossFeatureReport(production) {
  const target = path.join(root, 'docs', 'FINAL_RUNTIME_RESULTS.json');
  try {
    const current = JSON.parse(await fsp.readFile(target, 'utf8'));
    current.actualProject = {
      source: production.source,
      files: production.fileCount,
      persisted: true,
      okfValid: production.okfValid,
      indexElapsedMs: production.indexElapsedMs,
      queryElapsedMs: production.queryElapsedMs,
      intentElapsedMs: production.intentElapsedMs,
      queryResults: production.queryResults,
      queryTraversals: production.queryTraversals,
      okfIntentRetrieval: production.intentRetrievalMode,
      readOnlyGitEvidence: production.readOnlyGitEvidence,
      copilotCustomizations: production.copilotCustomizations,
    };
    current.productionAcceptanceVerifiedAt = production.verifiedAt;
    await fsp.writeFile(target, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  } catch {
    // Cross-feature verification may not have been run when this acceptance
    // script is invoked independently. Its dist/evidence report still remains
    // authoritative for the persisted production gate.
  }
}

async function copyActualProject(sourceRoot, targetRoot) {
  const directories = ['src', 'tests', 'scripts'];
  const files = [
    'README.md', 'package.json', 'package-lock.json', 'esbuild.config.mjs', 'eslint.config.js',
    'prettier.config.js', 'vite.config.ts', 'vitest.config.ts', '.vscodeignore',
    'tsconfig.json', 'tsconfig.extension.json', 'tsconfig.webview.json', 'tsconfig.extension-test.json',
  ];
  for (const directory of directories) {
    const source = path.join(sourceRoot, directory);
    if (fs.existsSync(source)) await fsp.cp(source, path.join(targetRoot, directory), { recursive: true });
  }
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    if (!fs.existsSync(source)) continue;
    await fsp.mkdir(path.dirname(path.join(targetRoot, file)), { recursive: true });
    await fsp.copyFile(source, path.join(targetRoot, file));
  }
}

async function sourceFingerprint(sourceRoot) {
  const hash = crypto.createHash('sha256');
  for (const directory of ['src', 'tests', 'scripts']) await hashTree(path.join(sourceRoot, directory), sourceRoot, hash);
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.webview.json']) {
    const full = path.join(sourceRoot, file);
    if (fs.existsSync(full)) hash.update(file).update(await fsp.readFile(full));
  }
  return hash.digest('hex');
}

async function hashTree(directory, sourceRoot, hash) {
  if (!fs.existsSync(directory)) return;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashTree(full, sourceRoot, hash);
    else if (entry.isFile()) hash.update(path.relative(sourceRoot, full).replaceAll(path.sep, '/')).update(await fsp.readFile(full));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
