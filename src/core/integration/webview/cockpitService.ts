import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { CaptainAgent } from '../../workflow/agents/captainAgent';
import { buildRepositoryIntelligence, IntelligencePipelineCancelledError, type RepositoryIntelligenceSnapshot } from '../../intelligence/pipeline';
import { LanguageCapabilityRegistry } from '../../intelligence/languages/languageRegistry';
import type { ContextPack, DeveloperIntent, KeystoneRunResult, RepoIntelligence } from '../../domain/types';
import { enhanceIntent, type EnhancementMode, type EnhancementSession } from '../../context/promptEnhancer';
import { runValidationCommand, type ValidationRunResult } from '../../workflow/validation/validationRunner';
import { detectValidationCommands } from '../../workflow/validation/validationCommands';
import { planFailureRemediation } from '../../workflow/quality/failureRemediation';
import type { CockpitSettings, IntelligenceActivityEvent, IntelligenceManifest, KeystoneTaskResult, KeystoneWebviewState, WorkspaceSummary } from './messageRouter';
import { RepositoryModelBuilder } from '../../intelligence/repository/model-builder';
import { ModernizationPlatformApi } from '../../workflow/modernization/modernization-api';
import type { ModernizationDecisionInput, ModernizationPlan, ModernizationProposal } from '../../workflow/modernization/model';
import { TaskWorkspaceManager, type TaskWorkspaceRef } from '../../workflow/tasks/taskWorkspaceManager';
import type { TaskStatePackage } from '../../workflow/handoff/contracts';
import { OkfSnapshotStore } from '../../intelligence/okf/store';
import { PORTABLE_OKF_VERSION } from '../../intelligence/okf/bundle';
import { GitReadOnly } from '../../platform/git/gitReadOnly';
import type { SemanticEnrichmentProvider } from '../../intelligence/languages/semanticEnrichment';

const INTELLIGENCE_DIR = '.keystone/intelligence';
const SUMMARY_PATH = `${INTELLIGENCE_DIR}/summary.json`;
const MANIFEST_PATH = `${INTELLIGENCE_DIR}/manifest.json`;
const ACTIVITY_PATH = `${INTELLIGENCE_DIR}/activity.json`;
const SETTINGS_PATH = '.keystone/settings.json';
const CONTEXT_CACHE_DIR = '.keystone/context/cache';
const CONTEXT_EVALUATIONS_PATH = '.keystone/context/evaluations.json';
const ENHANCEMENT_SESSIONS_DIR = '.keystone/context/sessions';
const CONTEXT_FEEDBACK_PATH = '.keystone/context/feedback.json';

export class CockpitService {
  private cancelled = false;
  private abortController?: AbortController;
  private runGeneration = 0;
  private readonly modernization = new ModernizationPlatformApi();
  private readonly taskWorkspaces: TaskWorkspaceManager;
  private activeTaskWorkspace?: TaskWorkspaceRef;
  private activityWrite: Promise<void> = Promise.resolve();

  constructor(private readonly workspaceRoot: string, private readonly runtime: { semanticEnricher?: SemanticEnrichmentProvider } = {}) {
    this.taskWorkspaces = new TaskWorkspaceManager(workspaceRoot);
  }

  cancelIngestion(): void {
    if (this.abortController) { this.abortController.abort(); }
  }

  async loadState(): Promise<KeystoneWebviewState> {
    this.activeTaskWorkspace = await this.taskWorkspaces.latestActive();
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(`${INTELLIGENCE_DIR}/snapshot.json`);
    const intelligence = snapshot?.intelligence ?? await this.readJson<RepoIntelligence>(SUMMARY_PATH);
    const okf = await new OkfSnapshotStore(this.workspaceRoot).read();
    const portableOkf = await this.readJson<PortableOkfBundleManifest>(`${INTELLIGENCE_DIR}/okf-bundle/.keystone-bundle.json`);
    const manifest = await this.readJson<IntelligenceManifest>(MANIFEST_PATH);
    const activity = await this.readJson<IntelligenceActivityEvent[]>(ACTIVITY_PATH) ?? [];
    const modernizationProposal = await this.readJson<ModernizationProposal>('.keystone/modernization/proposal.json');
    const modernizationPlan = await this.readJson<ModernizationPlan>('.keystone/modernization/plan.json');
    const backgroundEntries = await Promise.all((['qa', 'security', 'performance', 'modernization'] as const).map(async name => [name, await this.readJson(`.keystone/background/${name}.json`)] as const));
    const backgroundAnalysis = Object.fromEntries(backgroundEntries.filter(entry => entry[1] !== undefined));
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const activeTask = this.activeTaskWorkspace ? await this.taskWorkspaces.snapshot(this.activeTaskWorkspace) : undefined;
    if (modernizationProposal) this.modernization.restoreProposal(modernizationProposal);
    return {
      status: intelligence ? 'ready' : 'idle',
      intelligence: intelligence ? toWorkspaceSummary(intelligence, snapshot, okf, portableOkf) : undefined,
      intelligenceManifest: manifest ?? emptyManifest(),
      intelligenceActivity: activity,
      ingestion: { active: false, progress: intelligence ? 100 : 0, stage: intelligence ? 'complete' : 'not-started', message: intelligence ? 'Persisted repository intelligence loaded.' : 'No repository intelligence has been created yet.', persistedPath: SUMMARY_PATH },
      modernizationProposal,
      modernizationPlan,
      backgroundAnalysis,
      settings,
      activeTask,
    };
  }

  async index(onProgress: (message: string, progress: number, stage: string) => void): Promise<KeystoneWebviewState> {
    const generation = ++this.runGeneration;
    // Clear cancelled flag BEFORE building controller so concurrent
    // cancelIngestion() calls cannot race us into an aborted state.
    this.cancelled = false;
    const controller = new AbortController();
    this.abortController = controller;
    controller.signal.addEventListener('abort', () => { this.cancelled = true; }, { once: true });
    await fs.mkdir(path.join(this.workspaceRoot, INTELLIGENCE_DIR), { recursive: true });
    await this.record('indexing', 'Repository ingestion started.', 5);
    onProgress('Scanning repository files without LLM calls...', 12, 'scanning');
    // Ensure no cancellation race: before the expensive work, re-check.
    if (this.cancelled) return this.cancelledState();
    let snapshot: RepositoryIntelligenceSnapshot;
    try {
      snapshot = await buildRepositoryIntelligence(this.workspaceRoot, { signal: controller.signal, cognitive: true, semanticEnricher: this.runtime.semanticEnricher, onProgress: (event) => { if (generation === this.runGeneration) onProgress(event.message, event.progress, event.stage); } });
    } catch (error) {
      if (error instanceof IntelligencePipelineCancelledError) return generation === this.runGeneration ? this.cancelledState() : this.loadState();
      throw error;
    } finally {
      if (generation === this.runGeneration) this.abortController = undefined;
    }
    // After the expensive operation: check both guards.
    if (this.cancelled || generation !== this.runGeneration) return this.cancelledState();
    const okf = await new OkfSnapshotStore(this.workspaceRoot).read();
    const portableOkf = await this.readJson<PortableOkfBundleManifest>(`${INTELLIGENCE_DIR}/okf-bundle/.keystone-bundle.json`);
    const summary = toWorkspaceSummary(snapshot.intelligence, snapshot, okf, portableOkf);
    const completedStages = snapshot.stages.filter((stage) => stage.status === 'complete').length;
    const readinessReason = snapshot.status === 'ready'
      ? `All ${snapshot.stages.length} repository intelligence stages completed; intelligence health is ${snapshot.health.status} (${snapshot.health.score}/100).${snapshot.ingestion.warnings.length ? ` ${snapshot.ingestion.warnings.join(' ')}` : ''}`
      : `${snapshot.stages.length - completedStages} intelligence stage(s) failed.`;
    const manifest: IntelligenceManifest = { status: snapshot.status === 'ready' ? 'ready' : 'error', indexedAt: snapshot.intelligence.indexedAt, updatedAt: new Date().toISOString(), summaryPath: SUMMARY_PATH, activityPath: ACTIVITY_PATH, fileCount: summary.fileCount, branch: summary.git.branch, reason: readinessReason, completedStages, totalStages: snapshot.stages.length };
    await this.writeJson(MANIFEST_PATH, manifest);
    await this.record(snapshot.status === 'ready' ? 'complete' : 'degraded', `Indexed ${summary.fileCount} files; ${completedStages}/${snapshot.stages.length} stages completed.`, 100);
    onProgress(snapshot.status === 'ready' ? 'Repository intelligence is ready.' : 'Repository intelligence completed with failures.', 100, snapshot.status === 'ready' ? 'complete' : 'degraded');
    return { status: snapshot.status === 'ready' ? 'ready' : 'error', intelligence: summary, intelligenceManifest: manifest, intelligenceActivity: await this.activity(), ingestion: { active: false, progress: 100, stage: snapshot.status === 'ready' ? 'complete' : 'degraded', message: snapshot.status === 'ready' ? 'Repository intelligence is ready and persisted.' : 'Repository intelligence is degraded because one or more stages failed; inspect stage evidence.', persistedPath: SUMMARY_PATH } };
  }

  async analyze(text: string, editorContext: { currentFile?: string } = {}): Promise<KeystoneTaskResult> {
    const intent: DeveloperIntent = { id: `task-${Date.now()}`, text, workspaceRoot: this.workspaceRoot, createdAt: new Date().toISOString() };
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(`${INTELLIGENCE_DIR}/snapshot.json`);
    const intelligence = snapshot?.intelligence ?? await this.readJson<RepoIntelligence>(SUMMARY_PATH);
    if (!intelligence) throw new Error('Repository intelligence is not ready. Wait for background indexing to finish.');
    const gitDiff = await this.gitDiff();
    const feedback = await this.readJson<ContextFeedback[]>(CONTEXT_FEEDBACK_PATH) ?? [];
    const learnedFeedback = feedbackForIntent(text, feedback);
    const cacheKey = createHash('sha256').update(JSON.stringify({ text: text.trim(), currentFile: editorContext.currentFile, gitDiff: createHash('sha256').update(gitDiff).digest('hex'), feedback: learnedFeedback, fingerprint: snapshot?.ingestion.inputFingerprint ?? intelligence.indexedAt, settings: { compressionTier: settings?.compressionTier, codingStandards: settings?.codingStandards, thingsToAvoid: settings?.thingsToAvoid } })).digest('hex');
    const cached = await this.readJson<{ createdAt: string; result: KeystoneTaskResult }>(`${CONTEXT_CACHE_DIR}/${cacheKey}.json`);
    if (cached && Date.now() - Date.parse(cached.createdAt) < 24 * 60 * 60 * 1000) {
      const detected = await detectValidationCommands(this.workspaceRoot);
      const result = { ...cached.result, validationCommands: detected.all, retrievalMetrics: cached.result.retrievalMetrics ? { ...cached.result.retrievalMetrics, cacheHit: true } : undefined };
      await this.record('context-cache-hit', `Reused intent context ${cacheKey.slice(0, 12)} with ${result.contextTokens?.prompt ?? 0} prompt tokens.`);
      await this.recordEvaluation(text, result);
      return this.materializeTaskWorkspace(text, result);
    }
    const retrievalText: string | undefined = undefined;
    const run = await new CaptainAgent().run(intent, intelligence, {
      compressionTier: settings?.compressionTier ?? 'standard',
      codingStandards: settings?.codingStandards,
      thingsToAvoid: settings?.thingsToAvoid,
      retrievalText,
      semanticEvidence: snapshot?.stages.find(stage => stage.id === 'code-property-graph')?.items,
      currentFile: editorContext.currentFile,
      gitDiff,
      preferredPaths: learnedFeedback.filter(entry => entry.score > 0).map(entry => entry.path),
      excludedPaths: learnedFeedback.filter(entry => entry.score < 0).map(entry => entry.path)
    });
    await this.record('context-generated', `Intent context generated from ${run.contextPack.relevantFiles.length} ranked files: ${run.contextPack.estimatedRawTokens} raw → ${run.contextPack.estimatedPackedTokens} prompt tokens.`);
    const detected = await detectValidationCommands(this.workspaceRoot);
    const result = { ...normalizeRunResult(run, settings), validationCommands: detected.all };
    await this.writeJson(`${CONTEXT_CACHE_DIR}/${cacheKey}.json`, { createdAt: new Date().toISOString(), result });
    await this.recordEvaluation(text, result);
    return this.materializeTaskWorkspace(text, result);
  }

  async saveSettings(settings: CockpitSettings): Promise<void> {
    await fs.mkdir(path.join(this.workspaceRoot, '.keystone'), { recursive: true });
    await this.writeJson(SETTINGS_PATH, validateSettings(settings));
    await this.record('settings', 'Cockpit policy settings saved.');
  }

  async enhanceUserIntent(text: string, mode: EnhancementMode, sessionId?: string, currentFile?: string): Promise<EnhancementSession> {
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(`${INTELLIGENCE_DIR}/snapshot.json`);
    const intelligence = snapshot?.intelligence ?? await this.readJson<RepoIntelligence>(SUMMARY_PATH);
    if (!intelligence) throw new Error('Repository intelligence is not ready. Wait for background indexing to finish.');
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const previous = sessionId ? await this.readJson<EnhancementSession>(`${ENHANCEMENT_SESSIONS_DIR}/${safeId(sessionId)}.json`) : undefined;
    const session = await enhanceIntent({ text, mode, intelligence, currentFile, previous });
    await this.writeJson(`${ENHANCEMENT_SESSIONS_DIR}/${session.id}.json`, session);
    await this.record('intent-enhanced', `${mode} enhancement ${session.status}; confidence=${Math.round(session.confidence * 100)}%; evidence=${session.evidence.length}.`);
    return session;
  }

  async enhancementSessions(): Promise<EnhancementSession[]> {
    try {
      const sessions = await Promise.all((await fs.readdir(path.join(this.workspaceRoot, ENHANCEMENT_SESSIONS_DIR))).filter(file => file.endsWith('.json')).map(file => this.readJson<EnhancementSession>(`${ENHANCEMENT_SESSIONS_DIR}/${file}`)));
      return sessions.filter((session): session is EnhancementSession => Boolean(session)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 30);
    } catch { return []; }
  }

  async deleteEnhancementSession(sessionId: string): Promise<void> {
    try { await fs.unlink(path.join(this.workspaceRoot, ENHANCEMENT_SESSIONS_DIR, `${safeId(sessionId)}.json`)); } catch { /* Already absent. */ }
  }

  async retrieveContextOriginal(relativePath: string, expectedHash?: string): Promise<{ path: string; content: string; truncated: boolean; changed: boolean; currentHash: string }> {
    const target = path.resolve(this.workspaceRoot, relativePath);
    if (!target.startsWith(`${path.resolve(this.workspaceRoot)}${path.sep}`)) throw new Error('Context path is outside the workspace.');
    const [realRoot, realTarget] = await Promise.all([fs.realpath(this.workspaceRoot), fs.realpath(target)]);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) throw new Error('Context path resolves outside the workspace.');
    const content = await fs.readFile(realTarget, 'utf8');
    const limit = 200_000;
    const currentHash = createHash('sha256').update(content).digest('hex');
    return { path: relativePath, content: content.slice(0, limit), truncated: content.length > limit, changed: Boolean(expectedHash && expectedHash !== currentHash), currentHash };
  }

  async recordContextFeedback(intent: string, pathValue: string | undefined, rating: ContextFeedback['rating']): Promise<void> {
    const feedback = await this.readJson<ContextFeedback[]>(CONTEXT_FEEDBACK_PATH) ?? [];
    const intentTerms = [...new Set(intent.toLowerCase().match(/[a-z0-9_]+/g)?.filter(term => term.length > 2) ?? [])].slice(0, 20);
    feedback.unshift({ id: createHash('sha256').update(`${Date.now()}|${intent}|${pathValue ?? ''}|${rating}`).digest('hex').slice(0, 16), timestamp: new Date().toISOString(), intentTerms, path: pathValue, rating });
    await this.writeJson(CONTEXT_FEEDBACK_PATH, feedback.slice(0, 500));
    await this.record('context-feedback', `${rating}${pathValue ? `: ${pathValue}` : ''}.`);
  }


  async clearContextCache(): Promise<number> {
    const directory=path.join(this.workspaceRoot,CONTEXT_CACHE_DIR);
    let removed=0;
    try{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.isFile()&&entry.name.endsWith('.json')){await fs.unlink(path.join(directory,entry.name));removed+=1;}}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await this.record('context-cache-cleared',`Removed ${removed} cached context pack(s).`);
    return removed;
  }

  async queryIntelligence(query:string): Promise<{query:string;items:Array<{id:string;label:string;kind:string;path?:string;summary:string;evidenceIds:string[]}>}> {
    const normalized=query.trim().toLowerCase();
    if(!normalized)return{query,items:[]};
    const projection=path.join(this.workspaceRoot,'.keystone','intelligence','okf','projections','search.jsonl');
    const lines=await fs.readFile(projection,'utf8').catch(()=> '');
    const terms=[...new Set(normalized.match(/[a-z0-9_./:-]+/g)??[])];
    const items=lines.split(/\r?\n/).filter(Boolean)
      .map(line=>JSON.parse(line) as {id:string;okfId:string;kind:string;text:string;path?:string;evidenceIds:string[]})
      .map(item=>{const hay=[item.kind,item.path??'',item.text].join('\n').toLowerCase();const score=terms.reduce((sum,term)=>sum+(hay.includes(term)?1:0),0)+(hay.includes(normalized)?2:0);return{item,score};})
      .filter(entry=>entry.score>0).sort((left,right)=>right.score-left.score||left.item.id.localeCompare(right.item.id)).slice(0,50)
      .map(({item})=>{const parts=item.text.split('\n');return{id:item.okfId,label:parts[0]||item.okfId,kind:item.kind,path:item.path,summary:parts.slice(1,3).join(' · ').slice(0,300),evidenceIds:item.evidenceIds};});
    return{query,items};
  }

  private async gitDiff():Promise<string>{return new GitReadOnly(this.workspaceRoot).diff();}

  private async recordEvaluation(intent: string, result: KeystoneTaskResult): Promise<void> {
    const history = await this.readJson<Array<Record<string, unknown>>>(CONTEXT_EVALUATIONS_PATH) ?? [];
    history.unshift({ timestamp: new Date().toISOString(), intentHash: createHash('sha256').update(intent).digest('hex').slice(0, 16), tokens: result.contextTokens, retrieval: result.retrievalMetrics });
    await this.writeJson(CONTEXT_EVALUATIONS_PATH, history.slice(0, 200));
  }

  async approveDelegation(mode: string, prompt: string): Promise<void> {
    const active = await this.ensureActiveTask();
    const expected = await this.taskWorkspaces.delegationPrompt(active);
    if (normalizePrompt(prompt) !== normalizePrompt(expected)) throw new Error('The approved prompt does not match the generated task delegation packet. Regenerate the context before delegating.');
    await this.record('delegation-approved', `${mode} approved with ${Math.ceil(prompt.length / 4)} estimated tokens.`);
    this.activeTaskWorkspace = await this.taskWorkspaces.update(active, 'approved', { percent: 30, current: `Delegated through ${mode}`, completed: ['Repository intelligence gathered', 'Specification reviewed', 'Delegation approved'] });
  }

  async recordDecision(category: 'task' | 'risk', action: string, subject: string): Promise<void> {
    if (category === 'task' && action === 'approved') {
      const active = await this.ensureActiveTask();
      this.activeTaskWorkspace = await this.taskWorkspaces.update(active, 'approved', { percent: 20, current: 'Task approved; awaiting delegation' });
    }
    if (category === 'task' && action === 'rejected') {
      const active = await this.ensureActiveTask();
      await this.taskWorkspaces.cancel(active, `Rejected by user: ${subject}`);
      this.activeTaskWorkspace = undefined;
    }
    await this.record(`${category}-${action}`, `${category === 'task' ? 'Task' : 'Risk'} ${action}: ${subject}`);
  }

  async runValidation(scope: 'impacted' | 'all'): Promise<ValidationRunResult[]> {
    const active = await this.ensureActiveTask();
    this.activeTaskWorkspace = await this.taskWorkspaces.update(active, 'validating', { percent: 75, current: `Running ${scope} validation` });
    const detected = await detectValidationCommands(this.workspaceRoot);
    const commands = scope === 'impacted' ? detected.impacted : detected.all;
    if (!commands.length) {
      this.activeTaskWorkspace = await this.taskWorkspaces.update(active, 'blocked', { percent: 75, current: 'Validation unavailable', blockers: ['No supported validation scripts were found in package.json.'] });
      return [{ command: 'validation', status: 'failed', exitCode: undefined, stdout: '', stderr: 'No supported validation scripts were found in package.json.', durationMs: 0, summary: { errors: ['No supported validation scripts were found.'] } }];
    }
    const results: ValidationRunResult[] = [];
    for (const command of commands) {
      const result = await runValidationCommand(command, this.workspaceRoot, 120_000);
      if (result.status === 'failed') {
        const messages = result.summary.errors?.length ? result.summary.errors : [result.stderr || `${command} failed.`];
        result.remediation = messages.slice(0, 20).map((failureMessage, index) => planFailureRemediation({ testPath: `${command}#failure-${index + 1}`, failureMessage, failureStackTrace: result.stderr }));
      }
      results.push(result);
    }
    await this.writeJson('.keystone/validation/latest.json', { scope, completedAt: new Date().toISOString(), results });
    await this.record('validation', `${scope} validation finished: ${results.filter((result) => result.status === 'passed').length}/${results.length} passed.`);
    this.activeTaskWorkspace = await this.taskWorkspaces.update(this.activeTaskWorkspace!, results.every(result => result.status === 'passed') ? 'in-progress' : 'blocked', { percent: results.every(result => result.status === 'passed') ? 90 : 75, current: results.every(result => result.status === 'passed') ? 'Validation passed; awaiting completion' : 'Validation failed', blockers: results.filter(result => result.status !== 'passed').map(result => result.command) });
    return results;
  }

  async completeActiveTask(): Promise<void> {
    const active = await this.ensureActiveTask();
    if (active.status === 'planned' || active.status === 'blocked' || active.status === 'validating') throw new Error(`Task cannot be completed while its status is ${active.status}. Approve it and resolve validation blockers first.`);
    await this.taskWorkspaces.complete(active);
    await this.record('task-completed', `${active.name} marked done and removed after completion archive was recorded.`);
    this.activeTaskWorkspace = undefined;
  }

  async exportActiveTaskForHandoff(targetRoot = this.workspaceRoot): Promise<string> {
    return this.taskWorkspaces.exportForHandoff(await this.ensureActiveTask(), targetRoot);
  }

  async discardTaskWorkspace(ref: TaskWorkspaceRef): Promise<void> {
    await this.taskWorkspaces.cancel(ref, 'Analysis cancelled or superseded');
    if (this.activeTaskWorkspace?.id === ref.id) this.activeTaskWorkspace = undefined;
    await this.record('task-analysis-discarded', `${ref.name} removed because its analysis result was cancelled or superseded.`);
  }

  async importTaskHandoff(packageValue: Record<string, unknown>): Promise<string> {
    const handoff = await this.taskWorkspaces.importHandoffPackage(packageValue);
    this.activeTaskWorkspace = await this.taskWorkspaces.createFromHandoff(packageValue as unknown as TaskStatePackage);
    await this.record('task-handoff-materialized', `${this.activeTaskWorkspace.relativePath} created from verified handoff state.`);
    return handoff;
  }

  private async materializeTaskWorkspace(intent: string, result: KeystoneTaskResult): Promise<KeystoneTaskResult> {
    const taskWorkspace = await this.taskWorkspaces.create({ intent, intentType: result.intentType, route: result.route, relevantFiles: result.relevantFiles, relevantSymbols: result.relevantSymbols, tests: result.relatedTests, qaChecks: result.qaChecklist, securityRisk: result.securityRisk, performanceRisk: result.performanceRisk, modernizationNotes: result.modernizationNotes, copilotPrompt: result.copilotPrompt });
    this.activeTaskWorkspace = taskWorkspace;
    await this.record('task-workspace-created', `${taskWorkspace.relativePath} created for the accepted intent.`);
    return { ...result, taskWorkspace };
  }

  async analyzeModernization(): Promise<ModernizationProposal> {
    const builder = new RepositoryModelBuilder();
    const repository = builder.build(this.workspaceRoot);
    const proposal = await this.modernization.propose({
      repository,
      objectives: ['Preserve existing business behavior while modernizing the accepted technology stack'],
      scanScope: { expectedFiles: repository.files.length, indexedFiles: repository.files.length, excludedPaths: builder.getExcludedPaths() },
    });
    await this.writeJson('.keystone/modernization/proposal.json', proposal);
    await this.record('modernization-proposed', `${proposal.scanCoverage.analyzedFiles} files assessed; ${proposal.gaps.length} gaps and ${proposal.technologyRecommendations.length} technology recommendations produced.`);
    return proposal;
  }

  async restoreModernizationProposal(proposal: ModernizationProposal): Promise<void> {
    this.modernization.restoreProposal(proposal);
    await this.writeJson('.keystone/modernization/proposal.json', proposal);
  }

  async acceptModernization(proposalId: string, decision: ModernizationDecisionInput): Promise<ModernizationPlan> {
    const persisted = await this.readJson<ModernizationProposal>('.keystone/modernization/proposal.json');
    if (persisted?.id === proposalId) this.modernization.restoreProposal(persisted);
    const existing = await this.readJson<ModernizationPlan>('.keystone/modernization/plan.json');
    if (existing?.decision?.proposalId === proposalId && sameModernizationDecision(existing, decision) && existing.taskWorkspace) {
      const restoredRef = { ...existing.taskWorkspace, absolutePath: path.join(this.workspaceRoot, existing.taskWorkspace.relativePath) };
      if (await fs.access(restoredRef.absolutePath).then(() => true).catch(() => false)) {
        this.activeTaskWorkspace = restoredRef;
        return { ...existing, taskWorkspace: restoredRef };
      }
    }
    const plan = await this.modernization.planAccepted(proposalId, decision);
    const taskWorkspace = await this.taskWorkspaces.createModernization(plan);
    if (existing?.taskWorkspace) {
      const superseded = { ...existing.taskWorkspace, absolutePath: path.join(this.workspaceRoot, existing.taskWorkspace.relativePath) };
      if (await fs.access(superseded.absolutePath).then(() => true).catch(() => false)) await this.taskWorkspaces.cancel(superseded, 'Superseded by a revised modernization decision');
    }
    this.activeTaskWorkspace = taskWorkspace;
    const materializedPlan: ModernizationPlan = { ...plan, taskWorkspace };
    await this.writeJson('.keystone/modernization/plan.json', materializedPlan);
    await this.record('modernization-planned', `${plan.phases.length} accepted modernization phases and ${plan.specifications.length} specifications generated in ${taskWorkspace.relativePath}.`);
    return materializedPlan;
  }

  private async cancelledState(): Promise<KeystoneWebviewState> {
    await this.record('cancelled', 'Repository ingestion cancelled by the user.', 0);
    return { status: 'idle', intelligenceManifest: { ...emptyManifest(), reason: 'Cancelled by user.' }, intelligenceActivity: await this.activity(), ingestion: { active: false, progress: 0, stage: 'cancelled', message: 'Repository ingestion was cancelled.', persistedPath: SUMMARY_PATH } };
  }

  private async activity(): Promise<IntelligenceActivityEvent[]> { return await this.readJson<IntelligenceActivityEvent[]>(ACTIVITY_PATH) ?? []; }
  private async ensureActiveTask(): Promise<TaskWorkspaceRef> {
    if (!this.activeTaskWorkspace) this.activeTaskWorkspace = await this.taskWorkspaces.latestActive();
    if (!this.activeTaskWorkspace) throw new Error('No active Keystone task workspace');
    return this.activeTaskWorkspace;
  }
  private async record(type: string, message: string, progress?: number): Promise<void> {
    const write = this.activityWrite.then(async () => {
      const events = await this.activity();
      events.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, timestamp: new Date().toISOString(), type, message, progress });
      await this.writeJson(ACTIVITY_PATH, events.slice(0, 100));
    });
    this.activityWrite = write.catch(() => undefined);
    return write;
  }
  private async readJson<T>(relative: string): Promise<T | undefined> { try { return JSON.parse(await fs.readFile(path.join(this.workspaceRoot, relative), 'utf8')) as T; } catch { return undefined; } }
  private async writeJson(relative: string, value: unknown): Promise<void> { const target = path.join(this.workspaceRoot, relative); await fs.mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.${Date.now()}.tmp`; await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temporary, target); }
}

function normalizePrompt(value: string): string { return value.replace(/\r\n/g, '\n').trim(); }
function sameModernizationDecision(plan: ModernizationPlan, input: ModernizationDecisionInput): boolean {
  if (!input.accepted || !plan.decision) return false;
  const targetId = input.customTarget?.id ?? input.selectedTargetId ?? plan.decision.targetArchitecture.id;
  if (plan.decision.targetArchitecture.id !== targetId) return false;
  return Object.entries(input.acceptedTechnologies ?? {}).every(([category, technology]) => plan.decision?.technologies[category] === technology);
}

function emptyManifest(): IntelligenceManifest { return { status: 'empty', updatedAt: new Date().toISOString(), summaryPath: SUMMARY_PATH, activityPath: ACTIVITY_PATH, fileCount: 0 }; }

function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9-]/g, ''); }

type ContextFeedback = { id: string; timestamp: string; intentTerms: string[]; path?: string; rating: 'useful' | 'irrelevant' | 'helpful' | 'unhelpful' };

function feedbackForIntent(intent: string, feedback: readonly ContextFeedback[]): Array<{ path: string; score: number }> {
  const terms = new Set(intent.toLowerCase().match(/[a-z0-9_]+/g)?.filter(term => term.length > 2) ?? []);
  const scores = new Map<string, number>();
  for (const entry of feedback) {
    if (!entry.path || !entry.intentTerms.length) continue;
    const overlap = entry.intentTerms.filter(term => terms.has(term)).length / entry.intentTerms.length;
    if (overlap < 0.3) continue;
    const delta = entry.rating === 'useful' ? 1 : entry.rating === 'irrelevant' ? -1 : 0;
    scores.set(entry.path, (scores.get(entry.path) ?? 0) + delta);
  }
  return [...scores.entries()].map(([pathValue, score]) => ({ path: pathValue, score })).filter(entry => entry.score !== 0).sort((left, right) => Math.abs(right.score) - Math.abs(left.score) || left.path.localeCompare(right.path));
}

function validateSettings(settings: CockpitSettings): CockpitSettings {
  const clamp = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return { ...settings, compressionTier: settings.compressionTier ?? 'standard', thresholds: { security: clamp(settings.thresholds.security), performance: clamp(settings.thresholds.performance), modernization: clamp(settings.thresholds.modernization) } };
}

function uniqueEvidence(context: ContextPack): Array<{ kind: string; label: string; path?: string; okfId?: string; confidence?: number }> {
  const output: Array<{ kind: string; label: string; path?: string; okfId?: string; confidence?: number }> = [];
  const seen = new Set<string>();
  const add = (item: { kind: string; label: string; path?: string; okfId?: string; confidence?: number }): void => { const key = item.okfId ?? `${item.kind}:${item.path ?? ''}:${item.label}`; if (!seen.has(key)) { seen.add(key); output.push(item); } };
  for (const file of context.relevantFiles) add({ kind: 'file', label: file.summary || file.path, path: file.path, confidence: file.evidence?.confidence });
  for (const symbol of context.relevantSymbols) add({ kind: 'symbol', label: symbol.name, path: symbol.filePath, confidence: symbol.evidence?.confidence });
  for (const section of context.contextSections ?? []) for (const evidence of section.evidence ?? []) add({ ...evidence, path: section.path });
  return output.slice(0, 120);
}

interface PortableOkfBundleManifest { format: string; version: string; generatedBy: string; extractionRunId: string; sourceProfile: string; sourceProfileVersion: string; concepts: number; digest: string; }

function toWorkspaceSummary(value: RepoIntelligence, snapshot?: RepositoryIntelligenceSnapshot, okf?: import('../../intelligence/okf/types').KeystoneOkfSnapshot, portable?: PortableOkfBundleManifest): WorkspaceSummary {
  const gitStage = snapshot?.stages.find((stage) => stage.id === 'git-change');
  return { fileCount: value.files.length, files: value.files, projectTypes: value.frameworkHints, architecture: value.services.length > 1 ? 'service-oriented' : value.frameworkHints.includes('react') ? 'component-based' : 'modular', git: { branch: String(gitStage?.metrics.branch ?? 'workspace'), changedFiles: gitStage?.items ?? [] }, stages: snapshot?.stages, families: snapshot?.families, languageCapabilities: value.languageSupport?.length ? value.languageSupport.map(item => ({ id:item.id, label:item.label, level:item.semanticProvider === 'none' ? item.baseline : `${item.baseline} + ${item.semanticProvider}`, extensions:new LanguageCapabilityRegistry().all().find(definition => definition.id === item.id)?.extensions ?? [], files:item.files, baseline:item.baseline, semanticProvider:item.semanticProvider, semanticFiles:item.semanticFiles, deterministicFiles:item.deterministicFiles, failedSemanticFiles:item.failedSemanticFiles, capabilities:item.capabilities, warnings:item.warnings })) : new LanguageCapabilityRegistry().summary(), universalTextFiles: value.files.filter(file => file.language === 'unknown').length, okf: okf ? { profile: okf.manifest.profile, version: okf.manifest.profileVersion, extractionRunId: okf.manifest.extractionRunId, units: okf.manifest.counts.units, relationships: okf.manifest.counts.relationships, observations: okf.manifest.counts.observations, evidence: okf.manifest.counts.evidence, active: okf.manifest.counts.active, deleted: okf.manifest.counts.deleted, graphNodes: okf.units.length, graphEdges: okf.relationships.length, cpgBindings: okf.units.filter(unit => unit.kind === 'file' || unit.kind === 'test' || unit.kind === 'symbol').length, validated: okf.manifest.validation.valid, portableBundle: portable ? { path: `${INTELLIGENCE_DIR}/okf-bundle`, conceptFiles: portable.concepts, validated: portable.format === 'OKF' && portable.version === PORTABLE_OKF_VERSION && portable.extractionRunId === okf.manifest.extractionRunId, profile: `${portable.format} ${portable.version}`, generatedAt: okf.manifest.generatedAt } : undefined, evidenceSamples: okf.evidence.slice(0, 20).map(item => ({ id: item.id, path: item.source.workspaceRelativePath, method: item.method, observedAt: item.observedAt })) } : undefined };
}

function normalizeRunResult(run: KeystoneRunResult, settings?: CockpitSettings): KeystoneTaskResult {
  const tests = run.contextPack.relatedTests.map((test) => test.testFile);
  const excluded = run.intelligence.files.filter((file) => !run.contextPack.relevantFiles.some((selected) => selected.path === file.path)).slice(0, 30).map((file) => ({ path: file.path, reason: file.isGenerated ? 'Generated file' : 'Outside the selected task context' }));
  const risk = (level: 'low' | 'medium' | 'high', area: string, detail: string) => ({ area, level, detail });
  const policy = [settings?.codingStandards && `Coding standards:\n${settings.codingStandards}`, settings?.thingsToAvoid && `Additional things to avoid:\n${settings.thingsToAvoid}`].filter(Boolean).join('\n\n');
  const promptWithPolicy = policy ? `${run.contextPack.copilotPrompt}\n\nWorkspace policy:\n${policy}` : run.contextPack.copilotPrompt;
  const copilotPrompt = promptWithPolicy;
  return {
    intentType: run.intentAnalysis.intentType, matchedRule: run.intentAnalysis.keywords[0], textKeywords: run.intentAnalysis.keywords, confidence: run.intentAnalysis.confidence,
    confidenceDetails: { overall: run.intentAnalysis.confidence * 100, signals: [{ name: 'Intent classification', score: run.intentAnalysis.confidence * 100, weight: 0.4 }, { name: 'Route decision', score: run.routeDecision.confidence * 100, weight: 0.35 }, { name: 'QA coverage', score: run.qa.coverageConfidence * 100, weight: 0.25 }] },
    route: run.routeDecision.selectedRoute, reason: run.routeDecision.reason,
    routeEvidence: { matchedRule: run.intentAnalysis.keywords[0] ?? 'fallback', confidence: run.routeDecision.confidence, reason: run.routeDecision.reason, whyNot: [`Fallback route: ${run.routeDecision.fallbackPath}`] },
    tokenReduction: run.contextPack.estimatedReductionPercent, relevantFiles: run.contextPack.relevantFiles.map((file) => file.path), relevantSymbols: run.contextPack.relevantSymbols.map((symbol) => `${symbol.name} — ${symbol.filePath}:${symbol.line}`), relatedTests: tests, missingTests: run.qa.missingTestAreas, coverageConfidence: run.qa.coverageConfidence, validationCommands: ['npm run typecheck', 'npm run lint', 'npm test'], qaChecklist: run.qa.checklist,
    securityRisk: run.security.riskLevel, performanceRisk: run.performance.riskLevel, modernizationNotes: run.modernization.phasedPlan, copilotPrompt, prMarkdown: run.prEvidence.markdown,
    contextTokens: { raw: run.contextPack.estimatedRawTokens, selected: run.contextPack.selectedContextTokens ?? run.contextPack.estimatedPackedTokens, prompt: run.contextPack.estimatedPackedTokens, packets: 1, tier: run.contextPack.compressionTier ?? 'standard' },
    contextSections: run.contextPack.contextSections?.map(section => ({ path: section.path, reason: section.reason, preview: section.content.slice(0, 500), estimatedTokens: section.estimatedTokens, sourceHash: section.sourceHash, score: section.score, evidence: section.evidence })),
    omittedContext: run.contextPack.omittedContext,
    contextManifest: run.contextPack.contextManifest,
    relatedApis: run.contextPack.relatedApis.map(api => `${api.method} ${api.path} — ${api.filePath}:${api.line}`),
    impactedServices: run.contextPack.impactedServices.map(service => `${service.name} — ${service.filePath}`),
    architectureConstraints: run.contextPack.architectureConstraints,
    securityConstraints: run.contextPack.securityConstraints,
    performanceConstraints: run.contextPack.performanceConstraints,
    acceptanceCriteria: run.contextPack.acceptanceCriteria,
    repoSkills: run.contextPack.repoSkills.map(skill => ({ id: skill.id, name: skill.name, description: skill.description, guidance: skill.guidance })),
    evidence: uniqueEvidence(run.contextPack),
    retrievalMetrics: run.contextPack.retrievalMetrics,
    detailedRisks: {
      architectureImpact: risk(run.routeDecision.risks.length > 2 ? 'medium' : 'low', 'Architecture impact', run.routeDecision.reason),
      securityRisk: risk(run.security.riskLevel, 'Security risk', run.security.checklist.join(' · ') || 'No security issue detected.'),
      performanceRisk: risk(run.performance.riskLevel, 'Performance risk', run.performance.checklist.join(' · ') || 'No performance issue detected.'),
      testGaps: risk(run.qa.missingTestAreas.length ? 'medium' : 'low', 'Test gaps', run.qa.missingTestAreas.join(' · ') || 'Mapped tests cover the selected context.'),
      dependencyChanges: risk('low', 'Dependency changes', 'No dependency manifest change is proposed by the current task.')
    }, excludedPaths: excluded
  };
}
