import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

import { indexRepository } from '../ingestion/repoIndexer';
import type { RepoIntelligence } from '../../domain/types';
import { INTELLIGENCE_FAMILIES, INTELLIGENCE_STAGES, type IntelligenceFamily, type IntelligenceFamilySummary, type IntelligencePipelineOptions, type IntelligenceStageId, type IntelligenceStageResult, type RepositoryIntelligenceSnapshot } from './types';
import { analyzeTypeScriptProject, buildTypeScriptCpg, buildUniversalCpg, CpgShardStore, type TypeScriptSemanticResult } from '../cpg';
import { OkfSnapshotStore } from '../okf/store';
import { analyzeRepositoryGraph, type RepositoryGraphAnalysis } from './derivedGraph';
import { evaluateIntelligenceHealth } from './health';
import { planIncrementalUpdate } from './incremental';
import { buildIntelligenceFindings } from './findings';
import { buildRuntimeVerification, type RuntimeVerification } from './runtime';
import { buildRepositoryEvolution, type RepositoryEvolution } from './evolution';
import { analyzeDeadCode, type DeadCodeCandidate } from './deadCode';

const execFileAsync = promisify(execFile);
const STORE = '.keystone/intelligence';

type StageDefinition = { id: IntelligenceStageId; label: string; family: IntelligenceFamily; cognitive?: boolean; analyze(context: StageContext): Promise<StageProjection> | StageProjection };
type StageProjection = { summary: string; items?: string[]; metrics?: Record<string, number | string | boolean> };
type StageContext = { root: string; persist: boolean; intelligence: RepoIntelligence; graph: RepositoryGraphAnalysis; runtime: RuntimeVerification; semantic: TypeScriptSemanticResult; evolution: RepositoryEvolution; deadCode: readonly DeadCodeCandidate[]; previous: Map<IntelligenceStageId, IntelligenceStageResult> };

export async function buildRepositoryIntelligence(root: string, options: IntelligencePipelineOptions = {}): Promise<RepositoryIntelligenceSnapshot> {
  const startedAt = new Date().toISOString();
  const runId = `intelligence-${Date.now().toString(36)}`;
  if (options.signal?.aborted) throw new IntelligencePipelineCancelledError('structural');
  const previousSnapshot = await readSnapshot(root);
  if (options.persist !== false) await fs.rm(path.join(root, STORE, 'stages'), { recursive: true, force: true });
  let intelligence: RepoIntelligence;
  try {
    intelligence = await indexRepository(root, {
      persist: options.persist,
      signal: options.signal,
      onDiscovery: (discovered, file) => options.onProgress?.({ stage: 'structural', order: 1, total: STAGES.length, progress: 1, message: `Discovering ${file} (${discovered} files found; no cap)` }),
      onFile: (indexed, total, file) => options.onProgress?.({ stage: 'structural', order: 1, total: STAGES.length, progress: Math.min(4, Math.round((indexed / Math.max(total, 1)) * 4)), message: `Indexing ${file} (${indexed}/${total})` }),
      semanticEnricher: options.semanticEnricher
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new IntelligencePipelineCancelledError('structural');
    if (options.signal?.aborted) throw new IntelligencePipelineCancelledError('structural');
    throw error;
  }
  const graph = analyzeRepositoryGraph(intelligence);
  const semanticPaths = intelligence.files.filter(file => /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path) && !file.isGenerated).map(file => file.path);
  const semantic = analyzeTypeScriptProject(root, semanticPaths);
  const incremental = planIncrementalUpdate(previousSnapshot?.intelligence, intelligence);
  const evolution = await buildRepositoryEvolution(root, incremental);
  const deadCode = analyzeDeadCode(intelligence, graph, semantic);
  const findings = buildIntelligenceFindings(intelligence, graph, evolution, deadCode);
  const runtime = await buildRuntimeVerification(root, findings);
  const context: StageContext = { root, persist: options.persist !== false, intelligence, graph, runtime, semantic, evolution, deadCode, previous: new Map() };
  const stages: IntelligenceStageResult[] = [];

  for (let index = 0; index < STAGES.length; index += 1) {
    const definition = STAGES[index];
    if (options.signal?.aborted) throw new IntelligencePipelineCancelledError(definition.id);
    const progress = Math.round((index / STAGES.length) * 100);
    options.onProgress?.({ stage: definition.id, order: index + 1, total: STAGES.length, progress, message: `Building ${definition.label}...` });
    const stageStarted = new Date();
    try {
      const projection = await definition.analyze(context);
      const completedAt = new Date();
      const items = projection.items ?? [];
      const result: IntelligenceStageResult = { id: definition.id, order: index + 1, label: definition.label, family: definition.family, status: 'complete', startedAt: stageStarted.toISOString(), completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - stageStarted.getTime(), itemCount: items.length, summary: projection.summary, items, metrics: projection.metrics ?? {}, cognitivelyEnriched: Boolean(definition.cognitive) };
      stages.push(result);
      context.previous.set(definition.id, result);
      if (options.persist !== false) await writeJson(root, `${STORE}/stages/${String(index + 1).padStart(2, '0')}-${definition.id}.json`, result);
    } catch (error) {
      if (error instanceof IntelligencePipelineCancelledError) throw error;
      const completedAt = new Date();
      stages.push({ id: definition.id, order: index + 1, label: definition.label, family: definition.family, status: 'failed', startedAt: stageStarted.toISOString(), completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - stageStarted.getTime(), itemCount: 0, summary: 'Stage failed.', items: [], metrics: {}, cognitivelyEnriched: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const status = stages.some((stage) => stage.status === 'failed') ? 'degraded' : 'ready';
  const cpgMetrics = context.previous.get('code-property-graph')?.metrics ?? {};
  const ingestion = {
    inputFingerprint: fingerprint(intelligence),
    indexedFiles: intelligence.files.length,
    indexedBytes: intelligence.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    discoveryMode: 'unbounded-incremental' as const,
    completedWithoutFileCap: true,
    cpgEligibleFiles: Number(cpgMetrics.eligibleFiles ?? 0),
    cpgIndexedFiles: Number(cpgMetrics.indexedFiles ?? 0),
    reusedFiles: intelligence.incrementalStats?.reusedFiles ?? 0,
    analyzedFiles: intelligence.incrementalStats?.analyzedFiles ?? intelligence.files.length,
    cpgShardsWritten: Number(cpgMetrics.shardsWritten ?? 0),
    cpgShardsReused: Number(cpgMetrics.shardsReused ?? 0),
    cpgShardsDeleted: Number(cpgMetrics.shardsDeleted ?? 0),
    warnings: []
  };
  const snapshot: RepositoryIntelligenceSnapshot = {
    version: 1,
    status,
    workspaceRoot: root,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    intelligence,
    stages,
    families: summarizeFamilies(stages),
    ingestion,
    health: evaluateIntelligenceHealth(intelligence, stages, ingestion, runtime),
    incremental,
    findings,
    runtime,
    semantic,
    evolution,
    deadCode
  };
  if (options.persist !== false) await writeJson(root, `${STORE}/snapshot.json`, snapshot);
  options.onProgress?.({ stage: 'runtime-observability', order: STAGES.length, total: STAGES.length, progress: 100, message: status === 'ready' ? 'All repository intelligence families are ready.' : 'Repository intelligence completed with failed stages.' });
  return snapshot;
}

export class IntelligencePipelineCancelledError extends Error {
  constructor(readonly stage: IntelligenceStageId) { super(`Intelligence pipeline cancelled before ${stage}.`); this.name = 'IntelligencePipelineCancelledError'; }
}

function summarizeFamilies(stages: IntelligenceStageResult[]): IntelligenceFamilySummary[] {
  return INTELLIGENCE_FAMILIES.map((id) => {
    const familyStages = stages.filter((stage) => stage.family === id);
    const completedStages = familyStages.filter((stage) => stage.status === 'complete').length;
    return { id, label: familyLabel(id), stageCount: STAGES.filter((stage) => stage.family === id).length, completedStages, itemCount: familyStages.reduce((sum, stage) => sum + stage.itemCount, 0), status: familyStages.some((stage) => stage.status === 'failed') ? 'failed' : completedStages === STAGES.filter((stage) => stage.family === id).length ? 'complete' : 'pending' };
  });
}

function familyLabel(id: IntelligenceFamily): string { return ({ 'repository-structure': 'Repository Structure Intelligence', 'code-graph': 'Code Graph Intelligence', 'build-test-qa': 'Build, Test, and QA Intelligence', 'architecture-sdlc': 'Architecture and SDLC Intelligence', 'context-token': 'Context and Token Intelligence', 'runtime-analysis': 'Runtime and Observability Intelligence' })[id]; }
function stage(id: IntelligenceStageId, label: string, family: IntelligenceFamily, analyze: StageDefinition['analyze'], cognitive = false): StageDefinition { return { id, label, family, analyze, cognitive }; }
function pathsMatching(intelligence: RepoIntelligence, pattern: RegExp): string[] { return intelligence.files.map((file) => file.path).filter((file) => pattern.test(file)); }
function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function fingerprint(intelligence: RepoIntelligence): string {
  const input = intelligence.files
    .map((file) => `${file.path}\0${file.sizeBytes}\0${file.lineCount}\0${file.contentHash ?? ''}\0${file.structuralHash ?? ''}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(input).digest('hex');
}
async function readJsonFile(root: string, relative: string): Promise<Record<string, unknown> | undefined> { try { return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')) as Record<string, unknown>; } catch { return undefined; } }
async function readSnapshot(root: string): Promise<RepositoryIntelligenceSnapshot | undefined> { try { return JSON.parse(await fs.readFile(path.join(root, STORE, 'snapshot.json'), 'utf8')) as RepositoryIntelligenceSnapshot; } catch { return undefined; } }
async function writeJson(root: string, relative: string, value: unknown): Promise<void> { const target = path.join(root, relative); const temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temporary, target); }

const STAGES: StageDefinition[] = [
  stage('structural', 'Structural Intelligence', 'repository-structure', ({ intelligence }) => { const roots = unique(intelligence.files.map((file) => file.path.split('/')[0])); return { summary: `${intelligence.files.length} files across ${roots.length} repository roots.`, items: roots, metrics: { files: intelligence.files.length, generated: intelligence.files.filter((file) => file.isGenerated).length, roots: roots.length } }; }),
  stage('language-framework', 'Language & Framework Intelligence', 'repository-structure', ({ intelligence }) => { const languages = unique(intelligence.files.map((file) => file.language).filter(Boolean)); return { summary: `${languages.length} languages and ${intelligence.frameworkHints.length} framework signals detected.`, items: [...languages, ...intelligence.frameworkHints], metrics: { languages: languages.length, frameworks: intelligence.frameworkHints.length } }; }),
  stage('build-script', 'Build & Script Intelligence', 'build-test-qa', async ({ root, intelligence }) => { const manifests = pathsMatching(intelligence, /(^|\/)(package\.json|pom\.xml|build\.gradle|Cargo\.toml|pyproject\.toml|Makefile)$/i); const pkg = await readJsonFile(root, 'package.json'); const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : []; return { summary: `${manifests.length} build manifests and ${scripts.length} root scripts detected.`, items: [...manifests, ...scripts.map((value) => `script:${value}`)], metrics: { manifests: manifests.length, scripts: scripts.length } }; }),
  stage('configuration', 'Configuration Intelligence', 'repository-structure', ({ intelligence }) => { const configs = pathsMatching(intelligence, /(^|\/)(tsconfig|vite|eslint|prettier|\.env|\.github|\.vscode|docker|k8s|helm|config)/i); return { summary: `${configs.length} configuration artifacts indexed.`, items: configs, metrics: { configs: configs.length } }; }),
  stage('symbol', 'Symbol Intelligence', 'code-graph', ({ intelligence }) => ({ summary: `${intelligence.symbols.length} code symbols indexed.`, items: intelligence.symbols.slice(0, 100).map((symbol) => `${symbol.kind}:${symbol.name} — ${symbol.filePath}:${symbol.line}`), metrics: { symbols: intelligence.symbols.length, exported: intelligence.symbols.filter((symbol) => symbol.exportStatus === 'exported').length } })),
  stage('dependency', 'Dependency Intelligence', 'code-graph', ({ intelligence }) => ({ summary: `${intelligence.dependencies.length} dependency edges indexed.`, items: intelligence.dependencies.slice(0, 100).map((edge) => `${edge.from} → ${edge.to}`), metrics: { dependencies: intelligence.dependencies.length, packages: intelligence.dependencies.filter((edge) => edge.kind === 'package').length } })),
  stage('api-route', 'API / Route Intelligence', 'code-graph', ({ intelligence }) => ({ summary: `${intelligence.apis.length} API and route endpoints indexed.`, items: intelligence.apis.map((api) => `${api.method} ${api.path} — ${api.filePath}:${api.line}`), metrics: { endpoints: intelligence.apis.length } })),
  stage('data-persistence', 'Data & Persistence Intelligence', 'architecture-sdlc', ({ intelligence }) => { const items = pathsMatching(intelligence, /(schema|migration|model|entity|repository|dao|database|prisma|sequelize|typeorm|drizzle|sql)/i); return { summary: `${items.length} persistence-related artifacts detected.`, items, metrics: { artifacts: items.length } }; }),
  stage('test', 'Test Intelligence', 'build-test-qa', ({ intelligence }) => ({ summary: `${intelligence.tests.length} test-to-source mappings indexed.`, items: intelligence.tests.map((test) => `${test.testFile}${test.targetFile ? ` → ${test.targetFile}` : ''}`), metrics: { tests: intelligence.files.filter((file) => file.isTest).length, mappings: intelligence.tests.length } })),
  stage('call-graph', 'Call Graph Intelligence', 'code-graph', ({ graph }) => ({
    summary: `${graph.localEdges.length} resolved file-flow edges across ${graph.communities.length} communities and ${graph.flows.length} entry-point flows.`,
    items: [
      ...graph.hubs.slice(0, 20).map(hub => `hub:${hub.path} — degree ${hub.degree}`),
      ...graph.cycles.slice(0, 10).map(cycle => `cycle:${cycle.join(' → ')}`)
    ],
    metrics: { edges: graph.localEdges.length, hubs: graph.hubs.length, cycles: graph.cycles.length, entryPoints: graph.entryPoints.length, communities: graph.communities.length, executionFlows: graph.flows.length, orphanSourceFiles: graph.orphanSourceFiles.length }
  })),
  stage('code-property-graph', 'Code Property Graph Intelligence', 'code-graph', async ({ root, persist, intelligence, semantic }) => {
    const eligible = intelligence.files.filter((file) => !file.isGenerated);
    let nodes = 0;
    let astEdges = 0;
    let eogEdges = 0;
    let cfgEdges = 0;
    let dfgEdges = 0;
    let cdgEdges = 0;
    const items: string[] = [];
    const shardStore = persist ? new CpgShardStore(root) : undefined;
    const okfSnapshot = persist ? await new OkfSnapshotStore(root).read() : undefined;
    const bindings = (okfSnapshot?.units ?? []).filter(unit => unit.lifecycle === 'active' && (unit.kind === 'file' || unit.kind === 'test' || unit.kind === 'documentation' || unit.kind === 'configuration' || unit.kind === 'symbol'));
    const resolveOkfId = (sourcePath: string, line: number, name?: string): string | undefined => {
      const symbol = bindings.find(unit => unit.kind === 'symbol' && unit.properties.filePath === sourcePath && unit.properties.line === line && (!name || unit.name === name));
      if (symbol) return symbol.id;
      return bindings.find(unit => (unit.kind === 'file' || unit.kind === 'test' || unit.kind === 'documentation' || unit.kind === 'configuration') && unit.properties.path === sourcePath)?.id;
    };
    for (const file of eligible) {
      const content = await fs.readFile(path.join(root, file.path), 'utf8');
      const resolver = (location: { startLine: number }, name?: string) => resolveOkfId(file.path, location.startLine, name);
      const graph = /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path)
        ? buildTypeScriptCpg({ sourcePath: file.path, content, resolveOkfId: resolver })
        : buildUniversalCpg({ sourcePath: file.path, content, language: file.language, resolveOkfId: resolver });
      nodes += graph.nodes.length;
      astEdges += graph.edges.filter((edge) => edge.kind === 'ast').length;
      eogEdges += graph.edges.filter((edge) => edge.kind === 'eog').length;
      cfgEdges += graph.edges.filter((edge) => edge.kind === 'cfg').length;
      dfgEdges += graph.edges.filter((edge) => edge.kind === 'dfg').length;
      cdgEdges += graph.edges.filter((edge) => edge.kind === 'cdg').length;
      if (items.length < 100) items.push(`${file.path}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      if (shardStore) await shardStore.put(graph);
    }
    const shardResult = shardStore ? await shardStore.finalize() : undefined;
    items.unshift(...semantic.calls.slice(0, Math.max(0, 100 - items.length)).map(call => `call:${call.sourcePath}:${call.sourceLine} → ${call.targetPath}:${call.targetLine}`));
    items.unshift(...semantic.relationships.slice(0, Math.max(0, 100 - items.length)).map(item => `${item.kind}:${item.sourceName} → ${item.targetName}`));
    items.unshift(...semantic.callbacks.slice(0, Math.max(0, 100 - items.length)).map(item => `callback:${item.registrar} → ${item.callback}`));
    return {
      summary: `${eligible.length} text artifacts indexed into CPG projections; TypeScript/JavaScript use the compiler frontend and other languages use deterministic structural frontends, with ${semantic.calls.length} type-bound TS/JS calls.`,
      items,
      metrics: { eligibleFiles: eligible.length, indexedFiles: eligible.length, nodes, astEdges, eogEdges, cfgEdges, dfgEdges, cdgEdges, shardsWritten: shardResult?.written ?? 0, shardsReused: shardResult?.reused ?? 0, shardsDeleted: shardResult?.deleted ?? 0, semanticFiles: semantic.files, configuredSemanticFiles: semantic.configuredFiles, fallbackSemanticFiles: semantic.fallbackFiles, boundCalls: semantic.calls.length, typeRelationships: semantic.relationships.length, callbackEdges: semantic.callbacks.length, unresolvedCalls: semantic.unresolvedCalls, compilerDiagnostics: semantic.diagnostics, configuredCompilerDiagnostics: semantic.configuredDiagnostics, fallbackCompilerDiagnostics: semantic.fallbackDiagnostics, diagnosticCodes: JSON.stringify(semantic.diagnosticCodes), typeResolution: true, cfg: true, dfg: true, cdg: true }
    };
  }),
  stage('architecture', 'Architecture Intelligence', 'architecture-sdlc', ({ intelligence, graph }) => ({ summary: `${intelligence.services.length} service boundaries, ${graph.communities.length} file communities, and ${graph.flows.length} entry-point flows describe the current architecture.`, items: [...intelligence.services.map((service) => `${service.name} — ${service.filePath}`), ...graph.entryPoints.map(file => `entry:${file}`), ...graph.communities.slice(0, 10).map(community => `${community.id} — ${community.files.length} files`), ...intelligence.frameworkHints], metrics: { services: intelligence.services.length, frameworks: intelligence.frameworkHints.length, entryPoints: graph.entryPoints.length, communities: graph.communities.length, executionFlows: graph.flows.length, cycles: graph.cycles.length } }), true),
  stage('git-change', 'Git & Change Intelligence', 'repository-structure', async ({ root, evolution }) => { try { const [{ stdout: branch }, { stdout: changed }] = await Promise.all([execFileAsync('git', ['branch', '--show-current'], { cwd: root }), execFileAsync('git', ['status', '--porcelain'], { cwd: root })]); const files = changed.trim().split('\n').filter(Boolean).map((line) => line.slice(3)); return { summary: `${files.length} changed files on ${branch.trim() || 'detached HEAD'} with ${evolution.coupling.length} historical co-change pairs.`, items: [...files, ...evolution.coupling.slice(0, 20).map(pair => `coupled:${pair.fileA} ↔ ${pair.fileB} (${pair.commits})`)], metrics: { branch: branch.trim() || 'detached', changedFiles: files.length, commitsAnalyzed: evolution.commitsAnalyzed, couplingPairs: evolution.coupling.length, structuralChanges: evolution.changes.structural, deletedFiles: evolution.changes.deleted } }; } catch { return { summary: 'Git metadata is unavailable.', items: [], metrics: { branch: 'unavailable', changedFiles: 0, commitsAnalyzed: 0, couplingPairs: 0, structuralChanges: evolution.changes.structural, deletedFiles: evolution.changes.deleted } }; } }),
  stage('impact', 'Impact Intelligence', 'architecture-sdlc', ({ graph, previous }) => { const changed = (previous.get('git-change')?.items ?? []).filter(item => !item.startsWith('coupled:')); const impact = graph.impactedBy(changed); return { summary: `${changed.length} changed files transitively impact ${impact.files.length} files and ${impact.tests.length} mapped tests.`, items: [...impact.files.slice(0, 80), ...impact.tests.slice(0, 20).map(test => `test:${test}`)], metrics: { changedFiles: changed.length, impactedFiles: impact.files.length, impactedTests: impact.tests.length, traversalDepth: impact.depth } }; }, true),
  stage('context', 'Context Intelligence', 'context-token', ({ intelligence, graph, previous }) => { const changed = (previous.get('git-change')?.items ?? []).filter(item => !item.startsWith('coupled:')); const impact = graph.impactedBy(changed); const selected = changed.length ? impact.files.slice(0, 100) : unique([...graph.entryPoints, ...graph.hubs.map(hub => hub.path)]).slice(0, 20); const raw = intelligence.files.reduce((sum, file) => sum + file.lineCount * 3, 0); const packed = selected.reduce((sum, item) => sum + (intelligence.files.find((file) => file.path === item)?.lineCount ?? 0) * 3, 0); return { summary: `${selected.length} graph-ranked files selected with an estimated ${Math.max(0, Math.round((1 - packed / Math.max(raw, 1)) * 100))}% context reduction.`, items: selected, metrics: { selectedFiles: selected.length, rawTokens: raw, estimatedTokens: packed, graphRanked: true } }; }, true),
  stage('sdlc-workflow', 'SDLC Workflow Intelligence', 'architecture-sdlc', ({ intelligence }) => { const items = pathsMatching(intelligence, /(^|\/)(\.github\/workflows|Jenkinsfile|azure-pipelines|gitlab-ci|Dockerfile|deploy|release|pipeline)/i); return { summary: `${items.length} build, CI, release, and deployment workflow artifacts detected.`, items, metrics: { workflows: items.length } }; }, true),
  stage('risk', 'Risk Intelligence', 'architecture-sdlc', ({ intelligence, graph, deadCode }) => { const structural = [...graph.cycles.map(cycle => `dependency cycle: ${cycle.join(' → ')}`), ...graph.orphanSourceFiles.map(file => `orphan source: ${file}`), ...deadCode.map(item => `possible dead code: ${item.filePath}:${item.line} ${item.name}`)]; const items = [...intelligence.securitySensitiveAreas, ...intelligence.performanceSensitivePaths, ...intelligence.modernizationCandidates, ...structural]; return { summary: `${items.length} combined code, structural, security, performance, and modernization risk signals detected.`, items: items.slice(0, 100), metrics: { security: intelligence.securitySensitiveAreas.length, performance: intelligence.performanceSensitivePaths.length, modernization: intelligence.modernizationCandidates.length, dependencyCycles: graph.cycles.length, orphanSourceFiles: graph.orphanSourceFiles.length, deadCodeCandidates: deadCode.length } }; }, true),
  stage('security', 'Security Intelligence', 'architecture-sdlc', ({ intelligence }) => ({ summary: `${intelligence.securitySensitiveAreas.length} security-sensitive areas require policy-aware handling.`, items: intelligence.securitySensitiveAreas.slice(0, 100), metrics: { sensitiveAreas: intelligence.securitySensitiveAreas.length } })),
  stage('performance', 'Performance Intelligence', 'architecture-sdlc', ({ intelligence }) => ({ summary: `${intelligence.performanceSensitivePaths.length} performance-sensitive paths detected.`, items: intelligence.performanceSensitivePaths.slice(0, 100), metrics: { sensitivePaths: intelligence.performanceSensitivePaths.length } })),
  stage('documentation', 'Documentation Intelligence', 'context-token', ({ intelligence }) => { const items = pathsMatching(intelligence, /(^|\/)(README|docs?\/|CHANGELOG|CONTRIBUTING|ADR|\.md$)/i); return { summary: `${items.length} documentation and decision artifacts indexed.`, items, metrics: { documents: items.length } }; }, true),
  stage('runtime-observability', 'Runtime / Observability Intelligence', 'runtime-analysis', ({ intelligence, runtime }) => { const items = pathsMatching(intelligence, /(telemetry|observability|metric|trace|logging|logger|opentelemetry|sentry|prometheus|health)/i); return { summary: `${items.length} integration points and ${runtime.evidence.length} mapped runtime signals produce ${runtime.correlations.length} static/runtime correlations.`, items: [...items, ...runtime.evidence.map(item => `${item.kind}:${item.signal}`)], metrics: { integrationPoints: items.length, runtimeEvidence: runtime.evidence.length, correlations: runtime.correlations.length, degraded: runtime.degraded } }; }),
];

if (STAGES.map((value) => value.id).join('|') !== INTELLIGENCE_STAGES.join('|')) throw new Error('Intelligence stage definitions do not match canonical execution order.');
