import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { CockpitService } from "@core/integration/webview/cockpitService";
import { getWebviewHtml } from "./vscodeHtml";
import type { CopilotDelegationResult, ExtensionToWebviewMessage, WebviewToExtensionMessage } from "../types/messageRouter";
import { TaskStatePackageBuilder, verifyTaskStatePackage, type TaskStatePackageInput } from "@core/workflow/handoff/taskStatePackage";
import type { TaskStatePackage } from "@core/workflow/handoff/contracts";
import { MANUAL_SYNC_CONFIRMATION } from "@core/workflow/handoff/contracts";
import { decryptHandoffPackage, encryptHandoffPackage } from "@core/workflow/handoff/handoffSecurity";
import { TaskStateRestorer, WorkspaceStateTaskStore } from "../task-handoff/taskStateRestorer";
import type { QaService, QaServiceEvent } from "../core/qaService";
import type { BackgroundWorkerEvent } from "../core/backgroundWorkerCoordinator";
import type { GapAnalysisResult } from "@core/workflow/quality/qaGapAnalysis";
import type { ModernizationProposal } from "@core/workflow/modernization/model";
import type { KeystoneTaskResult } from "@core/integration/webview/messageRouter";
import { ApplicationStore } from "@core/application/applicationStore";
import { startBrowserViewServer, type BrowserViewHandle } from "../browser-view/browserViewServer";
import { SDLCEngine, type SDLCPlan } from "@core/workflow/sdlc/engine";
import { SDLCPlanStore } from "@core/workflow/sdlc/store";
import { VscodeLanguageServiceEnricher } from '../intelligence/vscodeLanguageServiceEnricher';
import { ValueEdgeClient, type ValueEdgeConnection, type ValueEdgeFeature } from '@core/integration/valueedge';

/**
 * Implements VS Code's WebviewViewProvider interface for the Keystone VSCode UI.
 * Handles webview lifecycle, message routing, indexing, and analysis tasks.
 */
export class VscodeProvider {
  private panel?: vscode.WebviewPanel;
  private readonly services = new Map<string, CockpitService>();
  private indexGeneration = 0;
  private analysisGeneration = 0;
  private indexing = false;
  private refreshQueued = false;
  private readonly pendingIndexRoots = new Set<string>();
  private latestQaEvent?: QaServiceEvent;
  private webviewReady = false;
  private readonly applicationStore = new ApplicationStore();
  private readonly sdlcEngine = new SDLCEngine();
  private sdlcPlan?: SDLCPlan;
  private browserView?: BrowserViewHandle;
  private valueEdgeFeature?: ValueEdgeFeature;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly statusBar: vscode.StatusBarItem,
    private readonly output: vscode.LogOutputChannel,
    private readonly extensionContext: vscode.ExtensionContext
  ) {}

  /** Shows a "vscode ready" message to the user. */
  async showHome(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "keystone.application",
      "Keystone",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "media")] }
    );
    this.panel = panel;
    this.configureWebview(panel.webview);
    panel.onDidDispose(() => { this.panel = undefined; });
    this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
    await this.loadIntelligence();
    await this.loadRestoredTaskHandoff();
    if (this.latestQaEvent) this.post({ type: "QA_BACKGROUND_STATUS", ...this.latestQaEvent });
  }

  getDiagnostics(): { hasPanel: boolean; htmlLength: number; webviewReady: boolean } {
    return {
      hasPanel: Boolean(this.panel),
      htmlLength: this.panel?.webview.html.length ?? 0,
      webviewReady: this.webviewReady,
    };
  }

  async runModernizationDiagnostics(): Promise<{ proposalId: string; coveragePercent: number; phases: number; specifications: number; decisionSource: string; taskWorkspaceCreated: boolean }> {
    const root = this.workspaceRoot();
    if (!root) throw new Error("Open a workspace before running modernization diagnostics.");
    const service = this.getService(root);
    const proposal = await service.analyzeModernization();
    const plan = await service.acceptModernization(proposal.id, {
      accepted: true,
      selectedTargetId: proposal.architectureRecommendations[0]?.target.id,
      acceptedTechnologies: Object.fromEntries(proposal.technologyRecommendations.map(item => [item.category, item.recommendedTechnology])),
    });
    const requiredArtifacts = ['task.json', 'specification.md', 'SKILL.md', 'instructions.md', 'agents.json', 'plan.json', 'progress.json', 'context.json', 'delegation.md', 'status.json'];
    const taskWorkspaceCreated = Boolean(plan.taskWorkspace) && (await Promise.all(requiredArtifacts.map(name => fs.access(path.join(plan.taskWorkspace!.absolutePath, name)).then(() => true).catch(() => false)))).every(Boolean);
    return { proposalId: proposal.id, coveragePercent: proposal.scanCoverage.coveragePercent, phases: plan.phases.length, specifications: plan.specifications.length, decisionSource: plan.decision?.source ?? "missing", taskWorkspaceCreated };
  }

  async runLifecycleDiagnostics(intentText = "Add audit logging to order updates.", currentFile?: string): Promise<{ promptGrounded: boolean; activeFileIncluded: boolean; provider: string; delegated: boolean; copilotChatOpened: boolean; sessionRestored: boolean; checksumVerified: boolean; taskWorkspaceCreated: boolean; handoffExported: boolean; completedWorkspaceRemoved: boolean; restoredTaskWorkspaceCreated: boolean; restoredTaskReshared: boolean; route: string; securityRisk: string; performanceRisk: string; modernizationNotes: number; qaChecks: number }> {
    const root = this.workspaceRoot();
    if (!root) throw new Error("Open a workspace before running lifecycle diagnostics.");
    const result = await this.getService(root).analyze(intentText, { currentFile });
    const taskWorkspaceCreated = Boolean(result.taskWorkspace) && (await fs.readdir(result.taskWorkspace!.absolutePath)).every(name => !name.endsWith('.tmp'));
    await this.delegateApprovedPrompt(root, "Manual Copy Prompt", result.copilotPrompt);
    const delegated = (await vscode.env.clipboard.readText()) === result.copilotPrompt;
    await this.delegateApprovedPrompt(root, "Copilot Chat", result.copilotPrompt);
    const packageValue = new TaskStatePackageBuilder().build(diagnosticSessionInput(result, root));
    const passphrase = "keystone integration secure passphrase";
    const encrypted = await encryptHandoffPackage(JSON.stringify(packageValue), passphrase);
    const restored = JSON.parse(await decryptHandoffPackage(encrypted, passphrase)) as TaskStatePackage;
    verifyTaskStatePackage(restored);
    const restorer = new TaskStateRestorer(new WorkspaceStateTaskStore(this.extensionContext));
    const folder = vscode.workspace.workspaceFolders?.[0];
    const preview = restorer.preview(restored, folder ? { name: folder.name, path: folder.uri.fsPath } : undefined);
    await restorer.restore(preview, MANUAL_SYNC_CONFIRMATION);
    const handoffPath = await this.getService(root).exportActiveTaskForHandoff(root);
    const handoffExported = Boolean((await fs.readdir(handoffPath)).includes('plan.json'));
    const taskPath = result.taskWorkspace!.absolutePath;
    await this.getService(root).completeActiveTask();
    const completedWorkspaceRemoved = await fs.access(taskPath).then(() => false).catch(() => true);
    await this.getService(root).importTaskHandoff(restored as unknown as Record<string, unknown>);
    const restoredState = await this.getService(root).loadState();
    const restoredTaskWorkspaceCreated = restoredState.activeTask?.task.sourcePackageId === restored.packageId;
    const restoredExport = await this.getService(root).exportActiveTaskForHandoff(root);
    const restoredTaskReshared = (await fs.readdir(restoredExport)).includes('delegation.md');
    await this.getService(root).completeActiveTask();
    const completionArchive = await fs.readFile(path.join(root, '.keystone', 'tasks', 'completed.jsonl'), 'utf8');
    return {
      promptGrounded: result.relevantFiles.length > 0 && result.copilotPrompt.includes(result.relevantFiles[0]),
      activeFileIncluded: !currentFile || result.relevantFiles.includes(currentFile),
      provider: "github-copilot",
      delegated,
      copilotChatOpened: true,
      sessionRestored: this.extensionContext.workspaceState.get<string>("task-handoff.active-task-id") === restored.taskId,
      checksumVerified: true,
      taskWorkspaceCreated,
      handoffExported,
      completedWorkspaceRemoved: completedWorkspaceRemoved && completionArchive.includes(result.taskWorkspace!.id),
      restoredTaskWorkspaceCreated,
      restoredTaskReshared,
      route: result.route,
      securityRisk: result.securityRisk,
      performanceRisk: result.performanceRisk,
      modernizationNotes: result.modernizationNotes.length,
      qaChecks: result.qaChecklist.length,
    };
  }

  attachQaService(service: QaService): vscode.Disposable {
    return service.onEvent((event: QaServiceEvent) => {
      this.latestQaEvent = event;
      this.post({ type: "QA_BACKGROUND_STATUS", ...event });
      if (event.status === "complete" && event.result) {
        this.logInfo(`Background QA ${event.result.scanMode} scan complete; ${event.result.metrics.sourcesAnalyzed} sources, ${event.result.metrics.gapsFound} gap(s).`);
      }
    });
  }

  reportBackgroundWorker(event: BackgroundWorkerEvent): void {
    if (event.root !== this.workspaceRoot()) return;
    if (event.kind === "qa") {
      const result = event.result as GapAnalysisResult | undefined;
      this.post({ type: "QA_BACKGROUND_STATUS", status: event.status, result, message: event.error });
      return;
    }
    if (event.kind === "modernization" && event.status === "complete" && event.result) {
      const proposal = event.result as ModernizationProposal;
      const root = this.workspaceRoot();
      if (root) void this.getService(root).restoreModernizationProposal(proposal)
        .catch(error => this.post({ type: 'ERROR', operation: 'analysis', message: error instanceof Error ? error.message : String(error) }));
      this.post({ type: "MODERNIZATION_PROPOSAL", proposal });
    }
    this.post({ type: "BACKGROUND_ANALYSIS_STATUS", worker: event.kind, status: event.status, result: event.result, error: event.error });
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "media")]
    };
    webview.html = getWebviewHtml(webview, this.extensionUri);
    webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => this.handleMessage(message));
  }

  // Rest of the implementation unchanged (copied from original provider)
  async indexWorkspace(rootOverride?: string): Promise<void> {
    const requestedRoot = rootOverride ?? this.workspaceRoot();
    if (!requestedRoot) {
      this.post({ type: "ERROR", operation: "intelligence", message: "Open a workspace to index repository intelligence." });
      return;
    }
    if (this.indexing) {
      this.pendingIndexRoots.add(requestedRoot);
      this.logInfo(`Intelligence is already running; queued a refresh for ${requestedRoot}.`);
      return;
    }
    this.indexing = true;
    const generation = ++this.indexGeneration;
    const root = requestedRoot;
    const isVisibleRoot = (): boolean => root === this.workspaceRoot();
    const startedAt = Date.now();
    this.logInfo(`Starting full ${generation === 1 ? "automatic" : "incremental"} intelligence pipeline for ${root}.`);
    if (isVisibleRoot()) this.post({ type: "STATE_UPDATE", state: { status: "indexing", ingestion: { active: true, progress: 1, stage: "starting", message: "Preparing repository ingestion.", persistedPath: ".keystone/intelligence/summary.json" } } });
    try {
      const state = await this.getService(root).index((message, progress, stage) => {
        if (generation === this.indexGeneration && isVisibleRoot()) {
          this.logInfo(`[${String(progress).padStart(3, " ")}%] ${stage}: ${message}`);
          this.post({ type: "INDEX_PROGRESS", message, progress, stage });
        }
      });
      if (generation !== this.indexGeneration) return;
      const indexed = state.intelligence?.fileCount ?? 0;
      if (isVisibleRoot()) this.statusBar.text = `Keystone: Indexed | Files: ${indexed} | Graph: Ready`;
      const stages = state.intelligence?.stages ?? [];
      for (const stage of stages) {
        const detail = `${String(stage.order).padStart(2, "0")}/${stages.length} ${stage.label}: ${stage.status}; ${stage.itemCount} signals; ${stage.durationMs}ms${stage.error ? `; error=${stage.error}` : ""}`;
        if (stage.status === "failed") this.logError(detail);
        else this.logInfo(detail);
      }
      this.logInfo(`Intelligence ${state.status} in ${Date.now() - startedAt}ms; ${indexed} files; persisted to ${state.ingestion?.persistedPath ?? ".keystone/intelligence"}.`);
      if (isVisibleRoot()) this.post({ type: "STATE_UPDATE", state });
    } catch (error) {
      if (generation !== this.indexGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      if (isVisibleRoot()) this.statusBar.text = "Keystone: Intelligence failed";
      this.logError(`Intelligence pipeline failed after ${Date.now() - startedAt}ms: ${message}`);
      if (isVisibleRoot()) {
        this.post({ type: "STATE_UPDATE", state: { status: "error", ingestion: { active: false, progress: 0, stage: "failed", message, persistedPath: ".keystone/intelligence/summary.json" } } });
        this.post({ type: "ERROR", operation: "intelligence", message });
      }
    } finally {
      this.indexing = false;
      this.pendingIndexRoots.delete(root);
      const next = this.pendingIndexRoots.values().next().value as string | undefined;
      if (next) { this.pendingIndexRoots.delete(next); void this.indexWorkspace(next); }
      else if (this.refreshQueued) { this.refreshQueued = false; void this.indexWorkspace(root); }
    }
  }

  async analyzeIntent(text: string): Promise<void> {
    const generation = ++this.analysisGeneration;
    const root = this.workspaceRoot();
    if (!root) {
      this.post({ type: "ERROR", operation: "analysis", message: "Open a workspace before analyzing an intent." });
      return;
    }
    if (!text.trim()) {
      this.post({ type: "ERROR", operation: "analysis", message: "Enter a task intent before running analysis." });
      return;
    }
    this.post({ type: "STATE_UPDATE", state: { status: "analyzing" } });
    this.logInfo(`Analyzing task intent against persisted repository intelligence: ${text.trim()}`);
    try {
      const active = vscode.window.activeTextEditor?.document.uri;
      const currentFile = active?.scheme === 'file' ? vscode.workspace.asRelativePath(active, false).replace(/\\/g, '/') : undefined;
      const result = await this.getService(root).analyze(text.trim(), { currentFile });
      if (generation !== this.analysisGeneration) {
        if (result.taskWorkspace) await this.getService(root).discardTaskWorkspace(result.taskWorkspace);
        return;
      }
      this.statusBar.text = `Keystone: Indexed | Route: ${result?.route ?? ""} | Tokens Saved: ${result?.tokenReduction ?? 0}% | QA: ${result?.relatedTests?.length ?? 0}`;
      this.logInfo(`Task analysis complete; route=${result.route}; relevantFiles=${result.relevantFiles.length}; relatedTests=${result.relatedTests.length}; tokenReduction=${result.tokenReduction}%.`);
      this.applicationStore.update({ taskAnalysis: result, activeTask: result.taskWorkspace });
      this.post({ type: "TASK_RESULT", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logError(`Task analysis failed: ${message}`);
      this.post({ type: "ERROR", operation: "analysis", message });
    }
  }

  private handleMessage(message: WebviewToExtensionMessage): void {
    if (message.type === "WEBVIEW_READY") {
      this.webviewReady = true;
      this.logInfo("Keystone webview mounted and reported ready.");
      return;
    }
    if (message.type === "INDEX_REPO") {
      void this.indexWorkspace();
      return;
    }
    if (message.type === "LOAD_INTELLIGENCE") {
      void this.loadIntelligence();
      return;
    }
    if (message.type === "LOAD_RESTORED_TASK_HANDOFF") {
      void this.loadRestoredTaskHandoff();
      return;
    }
    if (message.type === "CLEAR_CONTEXT_CACHE") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).clearContextCache().then(removed => this.post({ type: "NOTIFICATION", level: "info", message: `Cleared ${removed} cached context pack(s).` }));
      return;
    }
    if (message.type === "ENHANCE_INTENT") {
      const root = this.workspaceRoot();
      const active = vscode.window.activeTextEditor?.document.uri;
      const currentFile = active?.scheme === 'file' ? vscode.workspace.asRelativePath(active, false).replace(/\\/g, '/') : undefined;
      if (root) void this.getService(root).enhanceUserIntent(message.text, message.mode, message.sessionId, currentFile)
        .then(session => this.post({ type: "INTENT_ENHANCED", session }))
        .catch(error => this.post({ type: "ERROR", operation: "analysis", message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (message.type === "LOAD_ENHANCEMENT_SESSIONS") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).enhancementSessions().then(sessions => this.post({ type: "ENHANCEMENT_SESSIONS_RESULT", sessions }));
      return;
    }
    if (message.type === "DELETE_ENHANCEMENT_SESSION") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).deleteEnhancementSession(message.sessionId).then(async () => this.post({ type: "ENHANCEMENT_SESSIONS_RESULT", sessions: await this.getService(root).enhancementSessions() }));
      return;
    }
    if (message.type === "RETRIEVE_CONTEXT_ORIGINAL") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).retrieveContextOriginal(message.path, message.expectedHash)
        .then(result => this.post({ type: "CONTEXT_ORIGINAL_RESULT", ...result }))
        .catch(error => this.post({ type: "ERROR", operation: "analysis", message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (message.type === "RECORD_CONTEXT_FEEDBACK") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).recordContextFeedback(message.intent, message.path, message.rating).then(() => this.post({ type: "NOTIFICATION", level: "info", message: "Context feedback recorded for future retrieval." }));
      return;
    }
    if (message.type === "CANCEL_INGESTION") {
      const root = this.workspaceRoot();
      if (root) this.services.get(root)?.cancelIngestion();
      this.logWarn("Repository intelligence cancellation requested by the user.");
      return;
    }
    if (message.type === "CANCEL_ANALYSIS") {
      this.analysisGeneration += 1;
      this.post({ type: "NOTIFICATION", level: "info", message: "Task analysis cancelled." });
      return;
    }
    if (message.type === "ANALYZE_INTENT") {
      void this.analyzeIntent(message.text);
      return;
    }
    if (message.type === "RUN_VALIDATION") {
      void this.runValidation(message.scope);
      return;
    }
    if (message.type === "COMPLETE_TASK") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).completeActiveTask()
        .then(() => this.post({ type: "TASK_COMPLETION_RESULT", success: true }))
        .catch(error => this.post({ type: "TASK_COMPLETION_RESULT", success: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (message.type === "ANALYZE_MODERNIZATION") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).analyzeModernization()
        .then(proposal => this.post({ type: "MODERNIZATION_PROPOSAL", proposal }))
        .catch(error => this.post({ type: "ERROR", operation: "analysis", message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (message.type === "ACCEPT_MODERNIZATION") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).acceptModernization(message.proposalId, message.decision)
        .then(plan => this.post({ type: "MODERNIZATION_PLAN", plan }))
        .catch(error => this.post({ type: "ERROR", operation: "analysis", message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (message.type === "APPROVE_DELEGATION") {
      const root = this.workspaceRoot();
      if (root) void this.approveAndDelegate(root, message)
        .then(result => this.post({ type: "DELEGATION_RESULT", ...result }))
        .catch(error => { const now = new Date().toISOString(); this.post({ type: "DELEGATION_RESULT", success: false, captured: false, mode: message.mode, storyId: message.storyId, startedAt: now, completedAt: now, error: error instanceof Error ? error.message : String(error) }); });
      return;
    }
    if (message.type === "COPY_COPILOT_PROMPT") {
      void vscode.env.clipboard.writeText(message.prompt).then(() => this.post({ type: "NOTIFICATION", level: "info", message: "Copilot prompt copied." }));
      return;
    }
    if (message.type === "COPY_PR_MARKDOWN") {
      void vscode.env.clipboard.writeText(message.markdown).then(() => this.post({ type: "NOTIFICATION", level: "info", message: "PR summary copied." }));
      return;
    }
    if (message.type === "SAVE_SETTINGS") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).saveSettings(message.settings).then(() => this.post({ type: "NOTIFICATION", level: "info", message: "Workspace settings saved." }));
      return;
    }
    if (message.type === "OPEN_BROWSER_VIEW") { void this.openBrowserView(); return; }
    if (message.type === "CONFIGURE_VALUEEDGE") { void this.configureValueEdge(); return; }
    if (message.type === "IMPORT_VALUEEDGE_FEATURE") { void this.importValueEdgeFeature(message.featureId); return; }
    if (message.type === "PUBLISH_VALUEEDGE_STORIES") { void this.publishValueEdgeStories(); return; }
    if (message.type === "QUERY_INTELLIGENCE") { const root=this.workspaceRoot(); if(root) void this.getService(root).queryIntelligence(message.query).then(result=>this.post({type:"INTELLIGENCE_QUERY_RESULT",result})).catch(error=>this.post({type:"NOTIFICATION",level:"error",message:error instanceof Error?error.message:String(error)})); return; }
    if (message.type === "CREATE_SDLC_PLAN") { void this.createSdlcPlan(message.intent); return; }
    if (message.type === "SDLC_TRANSITION") {
      if (!this.sdlcPlan) { this.post({ type: "NOTIFICATION", level: "error", message: "Create an SDLC plan first." }); return; }
      try { this.sdlcPlan = this.sdlcEngine.transition(this.sdlcPlan, message.storyId, message.status, { evidence: message.evidence, satisfiedCriteria: message.satisfiedCriteria, blockers: message.blockers }); void this.persistSdlcPlan(this.sdlcPlan); this.applicationStore.update({ sdlc: this.sdlcPlan }); this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan }); }
      catch (error) { this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (message.type === "APPROVE_SPECIFICATION") {
      if (!this.sdlcPlan) { this.post({ type: "NOTIFICATION", level: "error", message: "Create an SDLC plan first." }); return; }
      try { this.sdlcPlan = this.sdlcEngine.approveSpecification(this.sdlcPlan); this.sdlcPlan = { ...this.sdlcPlan, backlogStories: this.sdlcPlan.backlogStories.map(story => story.status === 'draft' ? { ...story, status: 'approved' as const } : story) }; void this.persistSdlcPlan(this.sdlcPlan); this.applicationStore.update({ sdlc: this.sdlcPlan }); this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan }); }
      catch (error) { this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (message.type === "CREATE_TASK_HANDOFF") {
      void this.createTaskHandoffPackage(message.passphrase);
      return;
    }
    if (message.type === "RESTORE_TASK_HANDOFF") {
      void this.restoreTaskHandoffPackage(message.packageText, message.passphrase, message.manualSyncConfirmed);
      return;
    }
    if (message.type === "RECORD_DECISION") {
      const root = this.workspaceRoot();
      if (root) void this.getService(root).recordDecision(message.category, message.action, message.subject)
        .then(() => message.category === 'task' ? this.post({ type: 'TASK_DECISION_RESULT', success: true, action: message.action }) : this.post({ type: "NOTIFICATION", level: "info", message: "Risk decision recorded." }))
        .catch((error: unknown) => message.category === 'task' ? this.post({ type: 'TASK_DECISION_RESULT', success: false, action: message.action, error: error instanceof Error ? error.message : String(error) }) : this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async createSdlcPlan(intent:string):Promise<void>{
    try {
      const task = this.applicationStore.snapshot().taskAnalysis as KeystoneTaskResult | undefined;
      const state = this.applicationStore.snapshot().intelligence as { architecture?: string } | undefined;
      let plan = this.sdlcEngine.createPlan(intent, {
        relevantFiles: task?.relevantFiles,
        relevantSymbols: task?.relevantSymbols,
        relatedTests: task?.relatedTests,
        missingTests: task?.missingTests,
        qaChecklist: task?.qaChecklist,
        securityRisk: task?.securityRisk,
        performanceRisk: task?.performanceRisk,
        modernizationNotes: task?.modernizationNotes,
        relevantApis: task?.relatedApis,
        relevantServices: task?.impactedServices,
        affectedFlows: task?.contextSections?.flatMap(section => section.evidence?.filter(item => item.kind.includes('flow')).map(item => `${item.kind}: ${item.label}`) ?? []),
        evidence: task?.evidence?.map((item, index) => ({ id: item.okfId ?? `task-evidence-${index + 1}`, kind: (['file','symbol','api','service','data','test','risk','flow','architecture'].includes(item.kind) ? item.kind : 'architecture') as import('@core/workflow/sdlc/engine').SDLCResearchEvidence['kind'], label: item.label, summary: item.label, path: item.path, okfId: item.okfId, confidence: item.confidence })),
        functionalRequirements: task?.acceptanceCriteria,
        nonFunctionalRequirements: [...(task?.securityConstraints ?? []), ...(task?.performanceConstraints ?? [])],
        constraints: [...(task?.architectureConstraints ?? []), 'Keystone Git access remains strictly read-only.'],
        architecture: state?.architecture,
        source: this.valueEdgeFeature ? { kind: 'valueedge', featureId: this.valueEdgeFeature.id, featureName: this.valueEdgeFeature.name, featureUrl: this.valueEdgeFeature.webUrl } : { kind: 'local' },
      });
      if (task) plan = this.attachTaskEvidenceToPlan(plan, task);
      this.sdlcPlan=plan; await this.persistSdlcPlan(plan); this.applicationStore.update({sdlc:plan}); this.post({type:'SDLC_PLAN_RESULT',plan});
    } catch(error){this.post({type:'NOTIFICATION',level:'error',message:error instanceof Error?error.message:String(error)});}
  }

  private attachTaskEvidenceToPlan(plan: SDLCPlan, task: KeystoneTaskResult): SDLCPlan {
    const analysis = task.analysisEvidence;
    if (!analysis) return plan;
    const story = (type: SDLCPlan['stories'][number]['type']) => plan.stories.find(item => item.type === type);
    const addEvidence = (type: SDLCPlan['stories'][number]['type'], evidence: string[]): void => {
      const current = story(type); if (!current || !evidence.length) return;
      plan = this.sdlcEngine.recordEvidence(plan, current.id, evidence);
    };
    const severity = (value:string): 'info'|'low'|'medium'|'high'|'critical' => value === 'critical' ? 'critical' : value === 'high' ? 'high' : value === 'medium' ? 'medium' : value === 'low' ? 'low' : 'info';

    const qaEvidence = analysis.qa.gaps.map(item => `${item.type}: ${item.path} — ${item.reason} (severity ${Math.round(item.severity * 100)}%)`);
    for (const type of ['existing-test-analysis','test-impact-analysis','new-test-creation'] as const) addEvidence(type, qaEvidence);
    addEvidence('new-test-creation', (task.testGeneration?.scenarios ?? []).map(item => `${item.priority}: ${item.name} — ${item.description}`));
    const qaStory = story('existing-test-analysis');
    if (qaStory) for (const item of analysis.qa.gaps) plan = this.sdlcEngine.recordFinding(plan, qaStory.id, { kind:'qa', severity:item.severity >= .8 ? 'high' : item.severity >= .5 ? 'medium' : 'low', summary:`${item.type}: ${item.path} — ${item.reason}`, status:'open', evidence:[item.path, item.reason] });

    const securityStory = story('security-review');
    if (securityStory) for (const item of analysis.security.findings) plan = this.sdlcEngine.recordFinding(plan, securityStory.id, { kind:'security', severity:severity(item.severity), summary:`${item.title} at ${item.path}:${item.line}`, status:'open', evidence:[item.explanation, item.remediation, `confidence=${Math.round(item.confidence*100)}%`] });
    addEvidence('security-review', analysis.security.findings.map(item => `${item.path}:${item.line} ${item.title} — ${item.explanation}`));

    const performanceStory = story('performance-review');
    if (performanceStory) for (const item of analysis.performance.findings) plan = this.sdlcEngine.recordFinding(plan, performanceStory.id, { kind:'performance', severity:severity(item.severity), summary:`${item.title} at ${item.path}:${item.line}`, status:'open', evidence:[item.explanation, item.remediation, `confidence=${Math.round(item.confidence*100)}%`] });
    addEvidence('performance-review', analysis.performance.findings.map(item => `${item.path}:${item.line} ${item.title} — ${item.explanation}`));

    const modernizationStory = story('modernization-review');
    if (modernizationStory) for (const item of analysis.modernization.gaps) plan = this.sdlcEngine.recordFinding(plan, modernizationStory.id, { kind:'architecture', severity:severity(item.priority), summary:`${item.area}: ${item.title}`, status:'open', evidence:item.evidence });
    addEvidence('modernization-review', analysis.modernization.gaps.map(item => `${item.priority}: ${item.area} — ${item.title}`));

    const diffEvidence = [`Read-only Git review: branch=${analysis.gitReview.branch ?? 'unknown'}; changedFiles=${analysis.gitReview.changedFiles.join(', ') || 'none'}; diffSha256=${analysis.gitReview.diffHash}; diffBytes=${analysis.gitReview.diffBytes}; artifact=${analysis.gitReview.diffArtifactPath ?? 'none'}`];
    addEvidence('code-review', diffEvidence);
    addEvidence('pr-review', diffEvidence);
    return plan;
  }

  async configureValueEdge(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('keystone.valueEdge');
      const baseUrl = await vscode.window.showInputBox({ title: 'ValueEdge base URL', value: config.get('baseUrl', ''), ignoreFocusOut: true }); if (baseUrl === undefined) return;
      const sharedSpaceId = await vscode.window.showInputBox({ title: 'ValueEdge shared space ID', value: config.get('sharedSpaceId', ''), ignoreFocusOut: true }); if (sharedSpaceId === undefined) return;
      const workspaceId = await vscode.window.showInputBox({ title: 'ValueEdge workspace ID', value: config.get('workspaceId', ''), ignoreFocusOut: true }); if (workspaceId === undefined) return;
      const clientId = await vscode.window.showInputBox({ title: 'ValueEdge client ID', value: config.get('clientId', ''), ignoreFocusOut: true }); if (clientId === undefined) return;
      const clientSecret = await vscode.window.showInputBox({ title: 'ValueEdge client secret', password: true, ignoreFocusOut: true }); if (clientSecret === undefined) return;
      await Promise.all([
        config.update('baseUrl', baseUrl.trim(), vscode.ConfigurationTarget.Workspace),
        config.update('sharedSpaceId', sharedSpaceId.trim(), vscode.ConfigurationTarget.Workspace),
        config.update('workspaceId', workspaceId.trim(), vscode.ConfigurationTarget.Workspace),
        config.update('clientId', clientId.trim(), vscode.ConfigurationTarget.Workspace),
        this.extensionContext.secrets.store('keystone.valueEdge.clientSecret', clientSecret),
      ]);
      this.post({ type: 'NOTIFICATION', level: 'info', message: 'ValueEdge connection configured. The client secret is stored only in VS Code SecretStorage.' });
    } catch (error) { this.post({ type: 'NOTIFICATION', level: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }

  async importValueEdgeFeature(featureId: string): Promise<void> {
    try {
      const client = await this.valueEdgeClient();
      const feature = await client.fetchFeature(featureId.trim());
      this.valueEdgeFeature = feature;
      this.applicationStore.update({ valueEdgeFeature: feature });
      this.post({ type: 'VALUEEDGE_FEATURE_RESULT', feature });
      await this.analyzeIntent([feature.name, feature.description].filter(Boolean).join('\n\n'));
    } catch (error) { this.post({ type: 'NOTIFICATION', level: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }

  async publishValueEdgeStories(): Promise<void> {
    try {
      if (!this.sdlcPlan || this.sdlcPlan.source.kind !== 'valueedge' || !this.sdlcPlan.source.featureId) throw new Error('Create and approve an SDLC plan imported from a ValueEdge feature first.');
      if (this.sdlcPlan.specificationStatus !== 'approved') throw new Error('Approve the specification before publishing ValueEdge stories.');
      const approved = this.sdlcPlan.backlogStories.filter(story => story.status === 'approved');
      if (!approved.length) throw new Error('There are no approved stories to publish.');
      const confirmation = await vscode.window.showWarningMessage(`Publish ${approved.length} draft user/quality stories under ValueEdge feature ${this.sdlcPlan.source.featureId}?`, { modal: true }, 'Publish Draft Stories');
      if (confirmation !== 'Publish Draft Stories') return;
      const published = await (await this.valueEdgeClient()).publishBacklogStories(this.sdlcPlan.source.featureId, approved);
      const byId = new Map(published.map(item => [item.localId, item.externalId]));
      this.sdlcPlan = { ...this.sdlcPlan, backlogStories: this.sdlcPlan.backlogStories.map(story => byId.has(story.id) ? { ...story, status: 'published' as const, externalId: byId.get(story.id) } : story), updatedAt: new Date().toISOString() };
      await this.persistSdlcPlan(this.sdlcPlan); this.applicationStore.update({ sdlc: this.sdlcPlan });
      this.post({ type: 'VALUEEDGE_PUBLISH_RESULT', published }); this.post({ type: 'SDLC_PLAN_RESULT', plan: this.sdlcPlan });
    } catch (error) { this.post({ type: 'NOTIFICATION', level: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }

  private async valueEdgeClient(): Promise<ValueEdgeClient> {
    const config = vscode.workspace.getConfiguration('keystone.valueEdge');
    const connection: ValueEdgeConnection = { baseUrl: config.get('baseUrl', ''), sharedSpaceId: config.get('sharedSpaceId', ''), workspaceId: config.get('workspaceId', ''), clientId: config.get('clientId', '') };
    const secret = await this.extensionContext.secrets.get('keystone.valueEdge.clientSecret');
    return new ValueEdgeClient(connection, secret ?? '');
  }

  private async persistSdlcPlan(plan:SDLCPlan):Promise<void>{const root=this.workspaceRoot();if(!root)throw new Error('Open a workspace before persisting an SDLC plan.');await new SDLCPlanStore(root).write(plan);}

  private async createTaskHandoffPackage(passphrase: string): Promise<void> {
    try {
      if(passphrase.length<12) throw new Error("Task Handoff passphrase must be at least 12 characters.");
      const root=this.workspaceRoot(); if(!root) throw new Error("Open a workspace before creating Task Handoff.");
      const task=this.applicationStore.snapshot().taskAnalysis as KeystoneTaskResult|undefined; if(!task) throw new Error("Analyze an intent before creating Task Handoff.");
      const input=authoritativeHandoffInput(task,root,this.sdlcPlan);
      const packageValue = new TaskStatePackageBuilder().build(input);
      const encrypted = await encryptHandoffPackage(JSON.stringify(packageValue), passphrase);
      await this.getService(root).exportActiveTaskForHandoff(root);
      await vscode.env.clipboard.writeText(encrypted);
      await this.saveHandoffRecord({ packageValue, status: 'Shared', warnings: [], activity: [{ at: packageValue.createdAt, actor: 'you', action: 'Created encrypted handoff package' }, { at: packageValue.updatedAt, actor: 'Keystone', action: `Secret scan completed; ${packageValue.redactionReport.findings.length} finding(s) redacted` }] });
      this.post({ type: "TASK_HANDOFF_CREATED", redactionCategories: packageValue.redactionReport.removedCategories, checksum: packageValue.checksum, packageValue });
    } catch (error) {
      this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : "Could not create the task handoff package." });
    }
  }

  private async restoreTaskHandoffPackage(packageText: string, passphrase: string, manuallySynchronized: boolean): Promise<void> {
    try {
      if (!manuallySynchronized) throw new Error("Manual Repository Sync Required.");
      const plaintext = await decryptHandoffPackage(packageText, passphrase);
      const packageValue = JSON.parse(plaintext) as TaskStatePackage;
      const restorer = new TaskStateRestorer(new WorkspaceStateTaskStore(this.extensionContext));
      const folder = vscode.workspace.workspaceFolders?.[0];
      const preview = restorer.preview(packageValue, folder ? { name: folder.name, path: folder.uri.fsPath } : undefined);
      await restorer.restore(preview, MANUAL_SYNC_CONFIRMATION);
      const restored = preview.packageValue;
      const root = this.workspaceRoot();
      if (root) {
        await this.getService(root).importTaskHandoff(restored as unknown as Record<string, unknown>);
        if (restored.sdlcPlan) { this.sdlcPlan = restored.sdlcPlan; await this.persistSdlcPlan(restored.sdlcPlan); this.applicationStore.update({ sdlc: restored.sdlcPlan }); }
        // A handoff transfers task continuity, never repository truth. Refresh local deterministic
        // intelligence against the recipient's manually synchronized workspace before continuing.
        void this.indexWorkspace(root);
      }
      await this.saveHandoffRecord({ packageValue: restored, status: 'Restored', warnings: preview.warnings, activity: [{ at: new Date().toISOString(), actor: 'you', action: 'Restored task state and SDLC continuation after manual repository confirmation' }] });
      this.post({ type: "TASK_HANDOFF_RESTORED", packageValue: restored, warnings: preview.warnings, continuationBriefing: preview.continuationBriefing, restoredNow: true });
      if (restored.sdlcPlan) this.post({ type: "SDLC_PLAN_RESULT", plan: restored.sdlcPlan });
    } catch (error) {
      this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : "The handoff package could not be restored." });
    }
  }

  private async approveAndDelegate(root: string, message: Extract<WebviewToExtensionMessage, { type: 'APPROVE_DELEGATION' }>): Promise<CopilotDelegationResult> {
    let storyId = message.storyId;
    if (this.sdlcPlan) {
      const story = storyId ? this.sdlcPlan.stories.find(item => item.id === storyId) : this.sdlcPlan.stories.find(item => item.status === 'in-progress');
      if (story) {
        storyId = story.id;
        this.sdlcPlan = this.sdlcEngine.prepareDelegation(this.sdlcPlan, story.id, { agent: message.agent ?? 'GitHub Copilot', skills: message.skills, instructions: message.instructions, prompt: message.prompt, contextPackId: message.contextPackId });
        this.sdlcPlan = this.sdlcEngine.approveDelegation(this.sdlcPlan, story.id);
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: 'SDLC_PLAN_RESULT', plan: this.sdlcPlan });
      }
    }
    const result = await this.delegateApprovedPrompt(root, message.mode, message.prompt, { storyId, agent: message.agent, skills: message.skills, instructions: message.instructions });
    if (result.captured && result.success && this.sdlcPlan && storyId) {
      const story = this.sdlcPlan.stories.find(item => item.id === storyId);
      if (story?.status === 'delegated') {
        this.sdlcPlan = this.sdlcEngine.completeDelegation(this.sdlcPlan, storyId, [
          `Copilot response captured by Keystone (${result.model?.name ?? result.model?.id ?? 'GitHub Copilot'}).`,
          result.artifactPath ? `Captured result artifact: ${result.artifactPath}` : 'Captured result stored locally.',
        ]);
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: 'SDLC_PLAN_RESULT', plan: this.sdlcPlan });
      }
    }
    this.applicationStore.update({ delegationResult: result });
    return result;
  }

  private async delegateApprovedPrompt(root: string, mode: string, prompt: string, options: { storyId?: string; agent?: string; skills?: readonly string[]; instructions?: readonly string[] } = {}): Promise<CopilotDelegationResult> {
    const startedAt = new Date().toISOString();
    await this.getService(root).approveDelegation(mode, prompt);
    if (mode === "Manual Copy Prompt") {
      await vscode.env.clipboard.writeText(prompt);
      const result: CopilotDelegationResult = { success: true, captured: false, mode, storyId: options.storyId, startedAt, completedAt: new Date().toISOString() };
      result.artifactPath = await this.getService(root).recordDelegationResult(result);
      this.post({ type: "NOTIFICATION", level: "info", message: "Delegation approved, recorded, and copied. The response remains external until evidence is attached." });
      return result;
    }
    if (mode === "Copilot Inline Edit") {
      await vscode.env.clipboard.writeText(prompt);
      await vscode.commands.executeCommand("inlineChat.start");
      const result: CopilotDelegationResult = { success: true, captured: false, mode, storyId: options.storyId, startedAt, completedAt: new Date().toISOString() };
      result.artifactPath = await this.getService(root).recordDelegationResult(result);
      this.post({ type: "NOTIFICATION", level: "info", message: "Inline Chat opened; the approved prompt is on the clipboard. Keystone will not claim a returned result until evidence is captured." });
      return result;
    }

    // Prefer VS Code's Language Model API so a user-approved Copilot request is sent and
    // the streamed response is captured back into the active Keystone task. If the API is
    // unavailable or the user has not granted model access, fall back to Copilot Chat UI
    // without pretending that Keystone captured a result.
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = models[0];
      if (model) {
        const selectedAgent = options.agent?.trim() || 'GitHub Copilot';
        const skills = (options.skills ?? []).filter(Boolean);
        const instructions = (options.instructions ?? []).filter(Boolean);
        const delegation = [
          'You are executing a user-approved Keystone SDLC delegation inside VS Code.',
          `Selected agent/role: ${selectedAgent}`,
          skills.length ? `Selected skills: ${skills.join(', ')}` : '',
          instructions.length ? `Instructions:\n${instructions.map(item => `- ${item}`).join('\n')}` : '',
          'Use the supplied context as evidence. Do not perform Git write or remote merge-request operations.',
          '',
          'Approved Keystone context packet:',
          prompt,
        ].filter(Boolean).join('\n');
        const cancellation = new vscode.CancellationTokenSource();
        try {
          const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(delegation)], {}, cancellation.token);
          let text = '';
          for await (const fragment of response.text) text += fragment;
          const result: CopilotDelegationResult = {
            success: true, captured: true, mode, storyId: options.storyId, startedAt, completedAt: new Date().toISOString(), text,
            model: { id: model.id, vendor: model.vendor, family: model.family, version: model.version, name: model.name },
          };
          result.artifactPath = await this.getService(root).recordDelegationResult(result);
          this.post({ type: "NOTIFICATION", level: "info", message: `Copilot response captured in Keystone${result.artifactPath ? ` (${result.artifactPath})` : ''}. Review the changes before validation.` });
          return result;
        } finally { cancellation.dispose(); }
      }
    } catch (error) {
      this.logWarn(`Copilot Language Model API was unavailable; falling back to Copilot Chat UI: ${error instanceof Error ? error.message : String(error)}`);
    }

    await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
    const result: CopilotDelegationResult = { success: true, captured: false, mode, storyId: options.storyId, startedAt, completedAt: new Date().toISOString() };
    result.artifactPath = await this.getService(root).recordDelegationResult(result);
    this.post({ type: "NOTIFICATION", level: "info", message: `${mode} opened with the approved Keystone context. The result remains external; Keystone will not mark delegation complete until evidence is captured.` });
    return result;
  }

  private async runValidation(scope: "impacted" | "all"): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    try {
      this.post({ type: "NOTIFICATION", level: "info", message: `Running ${scope} validation...` });
      let activeStory = this.sdlcPlan?.stories.find(story => ['delegated', 'in-progress', 'awaiting-validation', 'review-required'].includes(story.status));
      if (this.sdlcPlan && activeStory?.status === 'delegated') {
        this.post({ type: "NOTIFICATION", level: "info", message: "Validating the workspace after an external Copilot delegation. Delegation itself remains uncompleted until a captured result/evidence is recorded." });
      } else if (this.sdlcPlan && activeStory?.status === 'in-progress') {
        this.sdlcPlan = this.sdlcEngine.transition(this.sdlcPlan, activeStory.id, 'awaiting-validation');
        activeStory = this.sdlcPlan.stories.find(story => story.id === activeStory!.id);
      }
      const results = await this.getService(root).runValidation(scope);
      if (this.sdlcPlan && activeStory) {
        const passed = results.length > 0 && results.every(result => result.status === 'passed');
        const evidence = results.flatMap(result => [`${result.command}: ${result.status}`, ...result.summary.errors.map(error => `${result.command}: ${error}`)]);
        this.sdlcPlan = this.sdlcEngine.recordValidation(this.sdlcPlan, activeStory.id, { status: passed ? 'passed' : 'failed', commands: results.map(result => result.command), evidence });
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: 'SDLC_PLAN_RESULT', plan: this.sdlcPlan });
      }
      this.post({ type: "VALIDATION_RESULT", results });
    } catch (error) {
      this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async loadIntelligence(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    this.sdlcPlan = await new SDLCPlanStore(root).read();
    if (this.sdlcPlan) this.applicationStore.update({ sdlc: this.sdlcPlan });
    this.post({ type: "STATE_UPDATE", state: await this.getService(root).loadState() });
    if (this.sdlcPlan) this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
  }

  async activeWorkspaceChanged(): Promise<void> {
    if (this.panel) await this.loadIntelligence();
  }

  private async loadRestoredTaskHandoff(): Promise<void> {
    const sessions = (await this.readHandoffRecords()).filter(record => {
      try { verifyTaskStatePackage(record.packageValue); return record.status === 'Shared' || record.status === 'Restored'; }
      catch { return false; }
    });
    this.post({ type: 'TASK_HANDOFFS_RESULT', sessions });
    const taskId = this.extensionContext.workspaceState.get<string>("task-handoff.active-task-id");
    if (!taskId) return;
    const packageValue = this.extensionContext.workspaceState.get<TaskStatePackage>(`task-handoff.task.${taskId}`);
    if (!packageValue) return;
    try {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const preview = new TaskStateRestorer(new WorkspaceStateTaskStore(this.extensionContext)).preview(packageValue, folder ? { name: folder.name, path: folder.uri.fsPath } : undefined);
      this.post({ type: "TASK_HANDOFF_RESTORED", packageValue, warnings: preview.warnings, continuationBriefing: preview.continuationBriefing, restoredNow: false });
    } catch (error) {
      this.post({ type: "NOTIFICATION", level: "error", message: error instanceof Error ? `Stored handoff could not be loaded: ${error.message}` : "Stored handoff could not be loaded." });
    }
  }

  private async saveHandoffRecord(record: PersistedHandoffRecord): Promise<void> {
    verifyTaskStatePackage(record.packageValue);
    const records = await this.readHandoffRecords();
    const previous = records.find(item => item.packageValue.handoffId === record.packageValue.handoffId);
    const merged = previous ? { ...record, activity: [...previous.activity, ...record.activity] } : record;
    const complete = [merged, ...records.filter(item => item.packageValue.handoffId !== record.packageValue.handoffId)];
    const root = this.workspaceRoot(); if (!root) throw new Error('Open a workspace before persisting Task Handoff history.');
    const target = path.join(root, '.keystone', 'state', 'handoffs', 'records.json');
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(complete, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  }

  private async readHandoffRecords(): Promise<PersistedHandoffRecord[]> {
    const root = this.workspaceRoot(); if (!root) return [];
    try { const parsed = JSON.parse(await fs.readFile(path.join(root, '.keystone', 'state', 'handoffs', 'records.json'), 'utf8')) as unknown; return Array.isArray(parsed) ? parsed as PersistedHandoffRecord[] : []; }
    catch { return []; }
  }

  private getService(root: string): CockpitService {
    const existing = this.services.get(root);
    if (existing) return existing;
    const service = new CockpitService(root, { semanticEnricher: new VscodeLanguageServiceEnricher() });
    this.services.set(root, service);
    return service;
  }

  private post(message: ExtensionToWebviewMessage): void {
    if (message.type === "STATE_UPDATE") this.applicationStore.update(message.state);
    if (message.type === "INDEX_PROGRESS") this.applicationStore.mergeOperation({ id: 'repository-index', kind: 'intelligence', status: message.progress === 100 ? 'completed' : 'running', progress: message.progress ?? 0, message: message.message, updatedAt: new Date().toISOString() });
    if (message.type === "TASK_RESULT") this.applicationStore.update({ taskAnalysis: message.result, activeTask: message.result.taskWorkspace });
    if (message.type === "DELEGATION_RESULT") this.applicationStore.update({ delegationResult: message });
    if (message.type === "VALIDATION_RESULT") this.applicationStore.mergeOperation({ id: 'validation', kind: 'validation', status: 'completed', progress: 100, message: `${message.results.length} validation command(s) completed.`, updatedAt: new Date().toISOString() });
    if (message.type === "NOTIFICATION") this.applicationStore.update({ notification: { level: message.level, message: message.message } });
    if (message.type === "TASK_HANDOFFS_RESULT") this.applicationStore.update({ handoffs: message.sessions });
    void this.panel?.webview.postMessage(message);
    this.browserView?.broadcast(message);
  }

  async openBrowserView(): Promise<void> {
    if (!this.browserView) {
      const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "media").fsPath;
      this.browserView = await startBrowserViewServer({ mediaRoot, store: this.applicationStore, dispatch: async message => this.handleMessage(message) });
      this.extensionContext.subscriptions.push({ dispose: () => { void this.browserView?.dispose(); this.browserView = undefined; } });
    }
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(this.browserView.createBootstrapUrl()));
    await vscode.env.openExternal(external);
    this.post({ type: "BROWSER_VIEW_OPENED", url: external.toString(true) });
  }

  private logInfo(message: string): void {
    this.output.info(message);
    console.info(`[Keystone Intelligence] ${message}`);
  }

  private logWarn(message: string): void {
    this.output.warn(message);
    console.warn(`[Keystone Intelligence] ${message}`);
  }

  private logError(message: string): void {
    this.output.error(message);
    console.error(`[Keystone Intelligence] ${message}`);
  }

  private workspaceRoot(): string | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    return (active ? vscode.workspace.getWorkspaceFolder(active) : undefined)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

type PersistedHandoffRecord = { packageValue: TaskStatePackage; status: 'Shared' | 'Restored'; warnings: string[]; activity: Array<{ at: string; actor: string; action: string }> };

function authoritativeHandoffInput(result:KeystoneTaskResult,root:string,plan?:SDLCPlan):TaskStatePackageInput{
  const stories=plan?.stories??[];const completed=stories.filter(s=>s.status==='completed');const pending=stories.filter(s=>!['completed','cancelled','superseded'].includes(s.status));const blocked=stories.filter(s=>s.status==='blocked');const current=pending.find(s=>['in-progress','awaiting-validation','review-required','delegated','awaiting-delegation-approval'].includes(s.status))??pending[0];const acceptance=[...new Set(stories.flatMap(s=>s.acceptanceCriteria))];
  return{handoffId:`handoff-${Date.now()}`,taskId:plan?.id??result.taskWorkspace?.id??`task-${Date.now()}`,createdBy:'keystone-user',repositoryReference:{repositoryName:path.basename(root),expectedBranch:'manual-sync',workspaceFingerprint:result.taskWorkspace?.id},task:{originalUserRequest:plan?.intent??result.reason,normalizedProblemStatement:plan?.intent??result.reason,businessGoal:plan?.intent??result.reason,technicalGoal:result.reason,scope:result.relevantFiles,nonGoals:['Automatic Git mutation','Credential or token sharing'],constraints:['Git and merge-request access remain read-only'],assumptions:[],acceptanceCriteria:acceptance.length?acceptance:result.qaChecklist},specification:{approvedBehavior:plan?.specificationStatus==='approved'?['Specification approved in Keystone']:[],functionalRequirements:acceptance,nonFunctionalRequirements:[],uiRequirements:[],apiRequirements:[],dataRequirements:[],securityRequirements:[result.securityRisk],performanceRequirements:[result.performanceRisk],compatibilityRequirements:[]},plan:{phases:stories.map(s=>({id:s.id,title:s.title,tasks:[{id:s.id,title:s.title,status:s.status==='completed'?'COMPLETED':s.status==='blocked'?'BLOCKED':s.status==='in-progress'?'ACTIVE':'PENDING',dependencies:s.dependencies,subtasks:s.acceptanceCriteria}]})),currentPhase:current?.title,currentTask:current?.id,completedTasks:completed.map(s=>s.title),pendingTasks:pending.map(s=>s.title),blockedTasks:blocked.map(s=>s.title),deferredTasks:stories.filter(s=>s.status==='superseded'||s.status==='cancelled').map(s=>s.title)},sdlcPlan:plan,progress:{progressPercentage:stories.length?Math.round(completed.length/stories.length*100):0,completedWorkSummary:completed.map(s=>s.title),currentActivity:current?.title,pendingAction:current?.objective,blockers:blocked.flatMap(s=>s.blockers.length?s.blockers:[s.title]),openQuestions:[],lastUpdateTime:new Date().toISOString()},context:{architectureSummary:'Authoritative OKF-backed Keystone repository intelligence',relevantModules:[],relevantFiles:result.relevantFiles,relevantSymbols:result.relevantSymbols,dependencyRelationships:[],impactedComponents:[],repositoryIntelligenceSnapshotReference:'.keystone/intelligence/current.json',compressedTaskContext:result.copilotPrompt,importantCodeExcerpts:[],conventionsToFollow:[],thingsToAvoid:['Git write operations','Unapproved autonomous changes'],knownArchitecturalConstraints:[]},changes:{filesExpectedToChange:result.relevantFiles,filesReportedChanged:[],filesAdded:[],filesRemoved:[],majorImplementationChanges:completed.map(s=>s.title),knownUnfinishedAreas:pending.map(s=>s.title)},quality:{testsPlanned:result.relatedTests,testsAdded:[],testsReportedPassing:[],testsReportedFailing:[],testsPending:result.missingTests,staticAnalysisFindings:[],securityFindings:[result.securityRisk],performanceFindings:[result.performanceRisk],accessibilityFindings:[],knownRegressions:[],qualityChecksStillRequired:pending.flatMap(s=>s.acceptanceCriteria.filter(c=>!s.satisfiedCriteria.includes(c)))},decisions:{acceptedDecisions:stories.flatMap(s=>s.decisions),rejectedAlternatives:[],decisionReasons:[],assumptions:[],unresolvedQuestions:[],risks:[result.securityRisk,result.performanceRisk],reviewerComments:[]},continuation:{exactNextRecommendedAction:current?.objective??'Review completion evidence',suggestedFirstPrompt:result.copilotPrompt,expectedFilesToInspect:result.relevantFiles,expectedTestsToRun:result.relatedTests,environmentRequirements:[],setupReminders:[],restoreWarnings:[],manualRepositorySyncReminder:'Synchronize the repository manually before restoring.',definitionOfCompletion:current?.acceptanceCriteria??result.qaChecklist}};
}

function diagnosticSessionInput(result: KeystoneTaskResult, root: string): TaskStatePackageInput {
  return {
    handoffId: "integration-session", taskId: "integration-task", createdBy: "keystone", repositoryReference: { repositoryName: root.split(/[\\/]/).pop() ?? "workspace", expectedBranch: "manual-sync" },
    task: { originalUserRequest: "Add audit logging to order updates.", normalizedProblemStatement: "Add grounded audit logging", businessGoal: "Trace order changes", technicalGoal: "Implement safely", scope: result.relevantFiles, nonGoals: [], constraints: [], assumptions: [], acceptanceCriteria: result.qaChecklist },
    specification: { approvedBehavior: [], functionalRequirements: [], nonFunctionalRequirements: [], uiRequirements: [], apiRequirements: [], dataRequirements: [], securityRequirements: [result.securityRisk], performanceRequirements: [result.performanceRisk], compatibilityRequirements: [] },
    plan: { phases: [], completedTasks: [], pendingTasks: ["Approved Copilot implementation"], blockedTasks: [], deferredTasks: [] },
    progress: { progressPercentage: 25, completedWorkSummary: ["Intelligence and risk analysis complete"], blockers: [], openQuestions: [], lastUpdateTime: new Date().toISOString() },
    context: { architectureSummary: "Persisted Keystone intelligence", relevantModules: [], relevantFiles: result.relevantFiles, relevantSymbols: result.relevantSymbols, dependencyRelationships: [], impactedComponents: [], compressedTaskContext: result.copilotPrompt, importantCodeExcerpts: [], conventionsToFollow: [], thingsToAvoid: [], knownArchitecturalConstraints: [] },
    changes: { filesExpectedToChange: result.relevantFiles, filesReportedChanged: [], filesAdded: [], filesRemoved: [], majorImplementationChanges: [], knownUnfinishedAreas: [] },
    quality: { testsPlanned: result.relatedTests, testsAdded: [], testsReportedPassing: [], testsReportedFailing: [], testsPending: result.missingTests, staticAnalysisFindings: [], securityFindings: [result.securityRisk], performanceFindings: [result.performanceRisk], accessibilityFindings: [], knownRegressions: [], qualityChecksStillRequired: result.qaChecklist },
    decisions: { acceptedDecisions: ["Copilot delegation approved"], rejectedAlternatives: [], decisionReasons: [], assumptions: [], unresolvedQuestions: [], risks: [], reviewerComments: [] },
    continuation: { exactNextRecommendedAction: "Continue approved implementation", suggestedFirstPrompt: result.copilotPrompt, expectedFilesToInspect: result.relevantFiles, expectedTestsToRun: result.relatedTests, environmentRequirements: [], setupReminders: [], restoreWarnings: [], manualRepositorySyncReminder: "Synchronize repository manually before continuing.", definitionOfCompletion: result.qaChecklist },
  };
}
