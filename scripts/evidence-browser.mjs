import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { ApplicationStore } = require(path.join(root, 'dist/app/core/application/applicationStore.js'));
const { CockpitService } = require(path.join(root, 'dist/app/core/integration/webview/cockpitService.js'));
const { startBrowserViewServer } = require(path.join(root, 'dist/app/extension/browser-view/browserViewServer.js'));
const { SDLCEngine } = require(path.join(root, 'dist/app/core/workflow/sdlc/engine.js'));

// Evidence Browser View intentionally runs the real production CockpitService against an
// existing repository fixture. No file counts, query results, OKF records, task evidence,
// SDLC research, or Browser View notifications below are handcrafted product state.
const evidenceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'keystone-live-browser-evidence-'));
await fsp.cp(path.join(root, 'tests', 'fixtures', 'extension-workspace'), evidenceRoot, { recursive: true });
await fsp.mkdir(path.join(evidenceRoot, '.github', 'agents'), { recursive: true });
await fsp.mkdir(path.join(evidenceRoot, '.github', 'skills', 'order-safety'), { recursive: true });
await fsp.mkdir(path.join(evidenceRoot, '.github', 'instructions'), { recursive: true });
await fsp.writeFile(path.join(evidenceRoot, '.github', 'agents', 'order-review.agent.md'), '# Order Review Agent\nReview order changes against repository evidence.\n');
await fsp.writeFile(path.join(evidenceRoot, '.github', 'skills', 'order-safety', 'SKILL.md'), '# Order safety\n- Preserve calculation behavior\n- Run impacted tests\n');
await fsp.writeFile(path.join(evidenceRoot, '.github', 'instructions', 'orders.instructions.md'), '# Order instructions\n- Preserve public order contracts\n');

const service = new CockpitService(evidenceRoot);
const indexed = await service.index(() => undefined);
if (indexed.status !== 'ready') throw new Error('Live evidence repository did not complete persisted indexing.');
const intent = 'Change the order total calculation safely and identify every impacted test.';
const task = await service.analyze(intent, { currentFile: 'src/orders.ts' });
const initialQuery = await service.queryIntelligence('What tests cover src/orders.ts?');
if (!initialQuery.items.length) throw new Error('Live evidence query returned no persisted OKF evidence.');

const engine = new SDLCEngine();
let plan = createPlan(engine, intent, task, indexed.intelligence?.architecture);
const store = new ApplicationStore({
  ...await service.loadState(),
  status: 'ready',
  taskAnalysis: task,
  sdlc: plan,
  notification: { level: 'info', message: `${initialQuery.answer} (${initialQuery.items.length} evidence-backed result(s))` },
});

let handle;
const dispatch = async message => {
  if (message.type === 'QUERY_INTELLIGENCE') {
    const result = await service.queryIntelligence(message.query);
    store.update({ notification: { level: 'info', message: result.answer } });
    handle.broadcast({ type: 'INTELLIGENCE_QUERY_RESULT', result });
    return;
  }
  if (message.type === 'ANALYZE_INTENT') {
    const result = await service.analyze(message.text, { currentFile: 'src/orders.ts' });
    store.update({ taskAnalysis: result, activeTask: result.taskWorkspace, status: 'ready' });
    handle.broadcast({ type: 'TASK_RESULT', result });
    return;
  }
  if (message.type === 'CREATE_SDLC_PLAN') {
    const current = store.snapshot().taskAnalysis ?? task;
    plan = createPlan(engine, message.intent, current, store.snapshot().intelligence?.architecture);
    store.update({ sdlc: plan });
    handle.broadcast({ type: 'SDLC_PLAN_RESULT', plan });
    return;
  }
  if (message.type === 'INDEX_REPO') {
    const refreshed = await service.index(() => undefined);
    store.update({ ...refreshed, status: refreshed.status });
    handle.broadcast({ type: 'STATE_UPDATE', state: refreshed });
    return;
  }
  if (message.type === 'LOAD_INTELLIGENCE') {
    const refreshed = await service.loadState();
    store.update(refreshed);
    return;
  }
  store.update({ notification: { level: 'info', message: `${message.type} accepted by the live evidence Browser View. Use the installed VS Code extension for IDE-only actions.` } });
};

handle = await startBrowserViewServer({ mediaRoot: path.join(root, 'dist/media'), store, dispatch });
await fsp.mkdir(path.join(root, 'docs', 'evidence'), { recursive: true });
await fsp.writeFile(path.join(root, 'docs', 'evidence', 'live-browser-state.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'real CockpitService persisted run over tests/fixtures/extension-workspace',
  indexed: { status: indexed.status, files: indexed.intelligence?.fileCount, okf: indexed.intelligence?.okf },
  query: initialQuery,
  task,
  plan,
}, null, 2)}\n`);
const url = handle.createBootstrapUrl();
const urlFile = process.env.KEYSTONE_EVIDENCE_URL_FILE || path.join(root, '.evidence-url');
await fsp.writeFile(urlFile, url, 'utf8');
console.log(url);

const close = async () => {
  await handle.dispose();
  await fsp.rm(evidenceRoot, { recursive: true, force: true });
  await fsp.rm(urlFile, { force: true }).catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(() => {});

function createPlan(sdlcEngine, text, result, architecture) {
  return sdlcEngine.createPlan(text, {
    relevantFiles: result.relevantFiles,
    relevantSymbols: result.relevantSymbols,
    relevantApis: result.relatedApis,
    relevantServices: result.impactedServices,
    affectedFlows: result.evidence?.filter(item => item.kind === 'flow').map(item => item.label),
    relatedTests: result.relatedTests,
    missingTests: result.missingTests,
    qaChecklist: result.qaChecklist,
    securityRisk: `${result.securityRisk} — ${result.detailedRisks?.securityRisk?.detail ?? ''}`,
    performanceRisk: `${result.performanceRisk} — ${result.detailedRisks?.performanceRisk?.detail ?? ''}`,
    architecture: architecture ?? 'Repository architecture derived from persisted intelligence',
    evidence: (result.evidence ?? []).map(item => ({ ...item, summary: item.summary ?? item.reason ?? item.label ?? 'Repository evidence selected by Keystone.' })),
    functionalRequirements: result.acceptanceCriteria ?? [],
    nonFunctionalRequirements: [...(result.securityConstraints ?? []), ...(result.performanceConstraints ?? [])],
    constraints: [...(result.architectureConstraints ?? []), 'Git and remote merge-request access remain read-only.'],
  });
}
