import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { ApplicationStore } = require(path.join(root, 'dist/app/core/application/applicationStore.js'));
const { startBrowserViewServer } = require(path.join(root, 'dist/app/extension/browser-view/browserViewServer.js'));
const { SDLCEngine } = require(path.join(root, 'dist/app/core/workflow/sdlc/engine.js'));
const { LanguageCapabilityRegistry } = require(path.join(root, 'dist/app/core/intelligence/languages/languageRegistry.js'));

const report = JSON.parse(await fsp.readFile(path.join(root, 'docs/evidence/runtime-results.json'), 'utf8'));
const engine = new SDLCEngine();
const intent = 'Add an evidence-backed Browser View for an intent-led Keystone task and preserve it through Task Handoff.';
const evidence = [
  { id: 'okf-browser', kind: 'api', label: 'Browser View /state and /command', summary: 'Authenticated loopback endpoints expose the same extension-host application state.', path: 'src/extension/browser-view/browserViewServer.ts', okfId: 'keystone:api:browser-view', confidence: 0.98 },
  { id: 'okf-store', kind: 'service', label: 'ApplicationStore', summary: 'One versioned state store broadcasts changes to VS Code and browser surfaces.', path: 'src/core/application/applicationStore.ts', okfId: 'keystone:service:application-store', confidence: 0.99 },
  { id: 'okf-handoff', kind: 'service', label: 'TaskStatePackageBuilder', summary: 'Encrypted Task Handoff retains the exact SDLC plan and continuation state.', path: 'src/core/workflow/handoff/taskStatePackage.ts', okfId: 'keystone:service:task-handoff', confidence: 0.97 },
  { id: 'okf-profile', kind: 'architecture', label: 'Authoritative OKF snapshot', summary: 'Graph, search, CPG, provenance and portable Markdown concepts share stable OKF identities.', path: 'src/core/intelligence/okf/store.ts', okfId: 'keystone:architecture:okf', confidence: 0.99 },
];
let plan = engine.createPlan(intent, {
  relevantFiles: ['src/extension/browser-view/browserViewServer.ts','src/webview/App.tsx','src/core/application/applicationStore.ts','src/core/workflow/handoff/taskStatePackage.ts'],
  relevantSymbols: ['startBrowserViewServer','ApplicationStore','App','TaskStatePackageBuilder'],
  relevantApis: ['Browser View /state and /command','Intent API'], relevantServices: ['ApplicationStore','Task Handoff'], dataEntities: ['SDLCPlan','KeystoneOkfSnapshot'],
  affectedFlows: ['VS Code command → application store → webview and Browser View','Intent → R&D → approved stories → SDLC → Task Handoff'],
  relatedTests: ['tests/unit/extension/browser-view/browserViewServer.test.ts','tests/unit/core/sdlc/engine.test.ts','tests/unit/core/okf/okfIntegration.test.ts'],
  missingTests: ['Remote workspace URI forwarding integration'], qaChecklist: ['90 Node tests pass','Strict TypeScript checks pass','Production build and VSIX verification pass'],
  securityRisk: 'Loopback authentication, origin validation and stale-state rejection are mandatory.', performanceRisk: 'Repository ingestion is unbounded and incremental; UI state remains summarized.',
  architecture: 'Monolithic VS Code extension with one extension-host application store', evidence,
  functionalRequirements: ['Both surfaces render and mutate one state.','Task Handoff restores the exact SDLC state.'],
  nonFunctionalRequirements: ['Git remains read-only.','Every completion requires explicit criteria and evidence.'], constraints: ['No second Keystone runtime in the browser.'],
  source: { kind: 'valueedge', featureId: '42', featureName: 'Shared Keystone Browser View' },
});
let research = plan.stories.find(item => item.type === 'research');
plan = engine.transition(plan, research.id, 'in-progress');
plan = engine.transition(plan, research.id, 'awaiting-validation');
research = plan.stories.find(item => item.type === 'research');
plan = engine.transition(plan, research.id, 'completed', { evidence: ['OKF evidence matrix contains source paths and stable identities.','Repository architecture, flows, tests, risks and constraints are documented.'], satisfiedCriteria: research.acceptanceCriteria });
plan = engine.approveSpecification(plan);
let design = plan.stories.find(item => item.type === 'design');
plan = engine.transition(plan, design.id, 'in-progress');

const capabilityRegistry = new LanguageCapabilityRegistry().summary().map((item, index) => ({
  ...item,
  files: index < 7 ? [180,74,28,18,16,14,12][index] : 0,
  semanticProvider: item.semanticEnrichment === 'built-in' ? 'Built-in compiler semantics' : 'Deterministic grammar; VS Code language-service enrichment when installed',
  deterministicFiles: index < 7 ? [180,74,28,18,16,14,12][index] : 0,
  semanticFiles: item.parser === 'typescript' ? (index === 0 ? 180 : 74) : 0,
}));
const task = {
  intentType: 'feature', route: 'Copilot Chat after approval', reason: 'Repository evidence links the Browser View, shared state and Task Handoff boundaries.', tokenReduction: 71,
  relevantFiles: ['src/extension/browser-view/browserViewServer.ts','src/core/application/applicationStore.ts','src/webview/App.tsx','src/core/workflow/handoff/taskStatePackage.ts'],
  relevantSymbols: ['startBrowserViewServer','ApplicationStore','App','TaskStatePackageBuilder'], relatedTests: ['browserViewServer.test.ts','engine.test.ts','okfIntegration.test.ts'], missingTests: ['Remote workspace URI forwarding integration'],
  qaChecklist: ['Strict typecheck','90 Node tests','Browser auth/origin/stale-state scenarios','VSIX integrity'], securityRisk: 'low', performanceRisk: 'low', modernizationNotes: [],
  copilotPrompt: 'Implement only the approved design story using the attached evidence-backed context. Keep Git read-only and return validation evidence.',
  contextTokens: { raw: 18420, selected: 5830, prompt: 5280, packets: 4, tier: 'evidence-ranked' },
  contextManifest: { delegationTokenBudget: 6000, usedTokens: 5280, selectedFiles: 4, omittedFiles: 348, protectedFiles: 4, traceableEvidence: 18, generatedAt: new Date().toISOString() },
  contextSections: evidence.map((item, i) => ({ path: item.path, reason: item.summary, preview: `Evidence-backed excerpt for ${item.label}`, estimatedTokens: 700 + i * 80, score: 0.98 - i * .03, evidence: [item] })),
  relatedApis: ['Browser View /state and /command'], impactedServices: ['ApplicationStore','Task Handoff'], architectureConstraints: ['One extension-host runtime','One React application'], securityConstraints: ['Loopback only','One-time bootstrap','Same-origin commands'], performanceConstraints: ['No ingestion file cap','Incremental reuse'], acceptanceCriteria: plan.backlogStories.flatMap(item => item.acceptanceCriteria).slice(0,8),
  repoSkills: [{ id:'skill-okf',name:'OKF evidence workflow',description:'Trace every decision to promoted OKF evidence.',guidance:['Use stable OKF IDs','Preserve provenance'] }], evidence,
  taskWorkspace: { id: 'task-browser-view', name: 'Shared Browser View' },
};
const now = new Date().toISOString();
const state = {
  status: 'ready', workspace: { name: 'Keystone', root, branch: 'feature/browser-view' },
  intelligence: {
    fileCount: report.actualProject.files, projectTypes: ['TypeScript','React','VS Code Extension','Node.js'], architecture: 'Monolithic VS Code extension · shared application state · authoritative OKF', git: { branch: 'feature/browser-view', changedFiles: ['src/webview/App.tsx','src/core/intelligence/okf/bundle.ts'] },
    languageCapabilities: capabilityRegistry, universalTextFiles: 3,
    okf: { profile: 'https://keystone.local/okf/profiles/repository-intelligence/v2', version: '2.0.0', extractionRunId: 'run-evidence-20260731', units: 223, relationships: 408, observations: report.okfObservations, evidence: report.okfEvidence, active: 223, deleted: 4, graphNodes: 223, graphEdges: 408, cpgBindings: report.allLanguageCpgShards, validated: true, portableBundle: { path: '.keystone/intelligence/okf-bundle', conceptFiles: report.portableOkfBundle.concepts, validated: true, profile: 'OKF 0.2 Markdown/YAML bundle', generatedAt: now }, evidenceSamples: evidence.map(item => ({ id:item.id,path:item.path,method:'deterministic parser + source evidence',observedAt:now })) },
    stages: [{id:'discovery',label:'Discovery',status:'complete',progress:100,itemCount:report.actualProject.files},{id:'semantic',label:'Semantic extraction',status:'complete',progress:100,itemCount:report.actualProject.symbols},{id:'okf',label:'OKF promotion',status:'complete',progress:100,itemCount:223},{id:'projections',label:'Graph · Search · CPG',status:'complete',progress:100,itemCount:408}],
    families: [{id:'architecture',label:'Architecture',status:'ready',itemCount:18},{id:'api',label:'APIs',status:'ready',itemCount:14},{id:'tests',label:'Tests',status:'ready',itemCount:34},{id:'risk',label:'Risks',status:'ready',itemCount:7}],
  },
  taskAnalysis: task, sdlc: plan,
  intelligenceActivity: [
    {id:'a1',timestamp:now,type:'discovery',message:`Discovered ${report.actualProject.files} project files without a repository cap.`,progress:100},
    {id:'a2',timestamp:now,type:'okf',message:`Promoted ${report.portableOkfBundle.concepts} portable OKF concepts with provenance.`,progress:100},
    {id:'a3',timestamp:now,type:'sdlc',message:`Generated ${plan.backlogStories.length} repository-derived user and quality stories.`,progress:100},
    {id:'a4',timestamp:now,type:'browser',message:'Browser View authenticated and synchronized to application state version 8.',progress:100},
  ],
  operations: [
    {id:'op-index',kind:'intelligence',status:'completed',progress:100,message:'Incremental intelligence snapshot promoted atomically.',updatedAt:now},
    {id:'op-context',kind:'analysis',status:'completed',progress:100,message:'Evidence-ranked context pack created: 5,280 delegation tokens.',updatedAt:now},
    {id:'op-design',kind:'delegation',status:'running',progress:42,message:'Design story is active and awaiting approved Copilot delegation.',updatedAt:now},
  ], handoffs: [], notification: { level:'info', message:'All evidence views use one shared extension-host state.' },
};
await fsp.mkdir(path.join(root, 'docs', 'evidence'), { recursive: true });
await fsp.writeFile(path.join(root, 'docs', 'evidence', 'demo-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
const store = new ApplicationStore(state);
const handle = await startBrowserViewServer({ mediaRoot: path.join(root, 'dist/media'), store, dispatch: message => {
  if (message.type === 'QUERY_INTELLIGENCE') store.update({ notification: { level:'info', message:`Query accepted: ${message.query}` } });
} });
const url = handle.createBootstrapUrl();
const urlFile = process.env.KEYSTONE_EVIDENCE_URL_FILE || path.join(root, '.evidence-url');
await fsp.writeFile(urlFile, url, 'utf8');
console.log(url);
const close = async () => { await handle.dispose(); try { await fsp.rm(urlFile, { force:true }); } catch {} process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
await new Promise(() => {});
