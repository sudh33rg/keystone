import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { CockpitService } from "@core/integration/webview/cockpitService";
import { getWebviewHtml } from "./vscodeHtml";
import type {
  CopilotDelegationResult,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "../types/messageRouter";
import {
  TaskStatePackageBuilder,
  verifyTaskStatePackage,
  type TaskStatePackageInput
} from "@core/workflow/handoff/taskStatePackage";
import type { TaskStatePackage } from "@core/workflow/handoff/contracts";
import { MANUAL_SYNC_CONFIRMATION } from "@core/workflow/handoff/contracts";
import {
  decryptHandoffPackage,
  encryptHandoffPackage
} from "@core/workflow/handoff/handoffSecurity";
import { TaskStateRestorer, WorkspaceStateTaskStore } from "../task-handoff/taskStateRestorer";
import type { QaService, QaServiceEvent } from "../core/qaService";
import type {
  BackgroundWorkerRecovery,
  BackgroundWorkerEvent,
  BackgroundWorkerInput
} from "../core/backgroundWorkerCoordinator";
import type { GapAnalysisResult } from "@core/workflow/quality/qaGapAnalysis";
import type { ModernizationProposal } from "@core/workflow/modernization/model";
import type { KeystoneTaskResult } from "@core/integration/webview/messageRouter";
import type { CorrectionPacket } from "@core/domain/types";
import type { OkfCanonicalEvidenceEnvelope } from "@core/intelligence/okf/types";
import {
  canonicalEvidenceEnvelope,
  selectCanonicalContext
} from "@core/intelligence/okf/canonicalContext";
import { OkfSnapshotStore } from "@core/intelligence/okf/store";
import type { RepositoryIntelligenceSnapshot } from "@core/intelligence/pipeline/types";
import { ApplicationStore } from "@core/application/applicationStore";
import { startBrowserViewServer, type BrowserViewHandle } from "../browser-view/browserViewServer";
import { SDLCEngine, type SDLCPlan } from "@core/workflow/sdlc/engine";
import { SDLCPlanStore } from "@core/workflow/sdlc/store";
import { VscodeLanguageServiceEnricher } from "../intelligence/vscodeLanguageServiceEnricher";
import {
  ValueEdgeClient,
  type ValueEdgeConnection,
  type ValueEdgeFeature
} from "@core/integration/valueedge";

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
  private readonly pendingAffectedPaths = new Map<string, Set<string>>();
  private latestQaEvent?: QaServiceEvent;
  private webviewReady = false;
  private activeIndexPromise?: Promise<boolean>;
  private activeIndexRoot?: string;
  private readonly intelligenceRecoveryRoots = new Set<string>();
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
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "media")]
      }
    );
    this.panel = panel;
    this.configureWebview(panel.webview);
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
    // Render the panel immediately. A large repository may still be ingesting;
    // loading persisted state must not hold the command open or overwrite the
    // live indexing state shown by the progress callbacks.
    void this.loadIntelligence();
    void this.loadRestoredTaskHandoff();
    const root = this.workspaceRoot();
    if (root) void this.ensureWorkspaceIntelligence(root);
    if (this.latestQaEvent) this.post({ type: "QA_BACKGROUND_STATUS", ...this.latestQaEvent });
  }

  attachQaService(service: QaService): vscode.Disposable {
    return service.onEvent((event: QaServiceEvent) => {
      this.latestQaEvent = event;
      this.post({ type: "QA_BACKGROUND_STATUS", ...event });
      if (event.status === "complete" && event.result) {
        this.logInfo(
          `Background QA ${event.result.scanMode} scan complete; ${event.result.metrics.sourcesAnalyzed} sources, ${event.result.metrics.gapsFound} gap(s).`
        );
      }
    });
  }

  reportBackgroundWorker(event: BackgroundWorkerEvent): void {
    if (event.root !== this.workspaceRoot()) return;
    if (event.kind === "qa") {
      const result = event.result as GapAnalysisResult | undefined;
      this.post({
        type: "QA_BACKGROUND_STATUS",
        status: event.status,
        result,
        message:
          event.error ??
          event.reason ??
          (event.status === "running" ? "Running against the promoted OKF snapshot." : undefined),
        reason: event.reason,
        workerId: event.workerId,
        snapshotDigest: event.snapshotDigest,
        extractionRunId: event.extractionRunId,
        scopePaths: event.scopePaths,
        startedAt: event.startedAt,
        completedAt: event.completedAt,
        durationMs: event.durationMs,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        retryCount: event.retryCount,
        retryAt: event.retryAt,
        retrying: event.retrying
      });
      return;
    }
    if (event.kind === "modernization" && event.status === "complete" && event.result) {
      const proposal = event.result as ModernizationProposal;
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .restoreModernizationProposal(proposal)
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      this.post({ type: "MODERNIZATION_PROPOSAL", proposal });
    }
    this.post({
      type: "BACKGROUND_ANALYSIS_STATUS",
      worker: event.kind,
      status: event.status,
      result: event.result,
      error: event.error,
      reason: event.reason,
      workerId: event.workerId,
      snapshotDigest: event.snapshotDigest,
      extractionRunId: event.extractionRunId,
      scopePaths: event.scopePaths,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      durationMs: event.durationMs,
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      retryCount: event.retryCount,
      retryAt: event.retryAt,
      retrying: event.retrying
    });
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "media")]
    };
    webview.html = getWebviewHtml(webview, this.extensionUri);
    webview.onDidReceiveMessage((message: WebviewToExtensionMessage) =>
      this.handleMessage(message)
    );
  }

  // Rest of the implementation unchanged (copied from original provider)
  async indexWorkspace(
    rootOverride?: string,
    affectedPaths: readonly string[] = []
  ): Promise<boolean> {
    const requestedRoot = rootOverride ?? this.workspaceRoot();
    if (!requestedRoot) {
      this.post({
        type: "ERROR",
        operation: "intelligence",
        message: "Open a workspace to index repository intelligence."
      });
      return false;
    }
    if (this.indexing) {
      this.queueAffectedPaths(requestedRoot, affectedPaths);
      if (this.activeIndexRoot === requestedRoot || !this.activeIndexRoot) {
        this.refreshQueued = true;
      } else {
        this.pendingIndexRoots.add(requestedRoot);
      }
      const message = `Refresh queued for ${requestedRoot}; the current intelligence run will finish first.`;
      this.logInfo(message);
      this.post({ type: "NOTIFICATION", level: "info", message });
      let indexed = false;
      while (this.indexing || this.refreshQueued || this.pendingIndexRoots.has(requestedRoot)) {
        const active = this.activeIndexPromise;
        if (active) indexed = await active;
        else await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return indexed && Boolean(await this.readPromotedWorkerInput(requestedRoot));
    }
    const run = this.runIndexWorkspace(requestedRoot, affectedPaths);
    this.activeIndexPromise = run;
    this.activeIndexRoot = requestedRoot;
    return run;
  }

  private async runIndexWorkspace(
    root: string,
    affectedPaths: readonly string[] = []
  ): Promise<boolean> {
    this.indexing = true;
    const generation = ++this.indexGeneration;
    const isVisibleRoot = (): boolean => root === this.workspaceRoot();
    const startedAt = Date.now();
    this.logInfo(
      `Starting ${affectedPaths.length ? "affected-path refresh" : "full"} ${generation === 1 ? "automatic" : "incremental"} intelligence pipeline for ${root}${affectedPaths.length ? ` (${affectedPaths.length} changed/affected path(s); unchanged files remain hash-reused)` : ""}.`
    );
    if (isVisibleRoot())
      this.post({
        type: "STATE_UPDATE",
        state: {
          status: "indexing",
          ingestion: {
            active: true,
            progress: 1,
            stage: "starting",
            message: "Preparing repository ingestion.",
            persistedPath: ".keystone/intelligence/summary.json"
          }
        }
      });
    try {
      const state = await this.getService(root).index((message, progress, stage, workerPool) => {
        if (generation === this.indexGeneration && isVisibleRoot()) {
          this.logInfo(`[${String(progress).padStart(3, " ")}%] ${stage}: ${message}`);
          this.post({ type: "INDEX_PROGRESS", message, progress, stage, workerPool });
        }
      }, affectedPaths);
      if (generation !== this.indexGeneration) return false;
      const indexed = state.intelligence?.fileCount ?? 0;
      if (isVisibleRoot())
        this.statusBar.text = `Keystone: Indexed | Files: ${indexed} | Graph: Ready`;
      const stages = state.intelligence?.stages ?? [];
      for (const stage of stages) {
        const detail = `${String(stage.order).padStart(2, "0")}/${stages.length} ${stage.label}: ${stage.status}; ${stage.itemCount} signals; ${stage.durationMs}ms${stage.error ? `; error=${stage.error}` : ""}`;
        if (stage.status === "failed") this.logError(detail);
        else this.logInfo(detail);
      }
      this.logInfo(
        `Intelligence ${state.status} in ${Date.now() - startedAt}ms; ${indexed} files; persisted to ${state.ingestion?.persistedPath ?? ".keystone/intelligence"}.`
      );
      if (isVisibleRoot()) this.post({ type: "STATE_UPDATE", state });
    } catch (error) {
      if (generation !== this.indexGeneration) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (isVisibleRoot()) this.statusBar.text = "Keystone: Intelligence failed";
      this.logError(`Intelligence pipeline failed after ${Date.now() - startedAt}ms: ${message}`);
      if (isVisibleRoot()) {
        this.post({
          type: "STATE_UPDATE",
          state: {
            status: "error",
            ingestion: {
              active: false,
              progress: 0,
              stage: "failed",
              message,
              persistedPath: ".keystone/intelligence/summary.json"
            }
          }
        });
        this.post({ type: "ERROR", operation: "intelligence", message });
      }
      return false;
    } finally {
      this.indexing = false;
      if (this.activeIndexRoot === root) {
        this.activeIndexPromise = undefined;
        this.activeIndexRoot = undefined;
      }
      this.pendingIndexRoots.delete(root);
      const next = this.pendingIndexRoots.values().next().value as string | undefined;
      if (next) {
        this.pendingIndexRoots.delete(next);
        const nextPaths = this.takeAffectedPaths(next);
        void this.indexWorkspace(next, nextPaths);
      } else if (this.refreshQueued) {
        this.refreshQueued = false;
        const refreshPaths = this.takeAffectedPaths(root);
        void this.indexWorkspace(root, refreshPaths);
      }
    }
    return true;
  }

  private queueAffectedPaths(root: string, paths: readonly string[]): void {
    if (!paths.length) return;
    const queued = this.pendingAffectedPaths.get(root) ?? new Set<string>();
    for (const value of paths) queued.add(value.replace(/\\/g, "/").replace(/^\.\//, ""));
    this.pendingAffectedPaths.set(root, queued);
  }

  private takeAffectedPaths(root: string): string[] {
    const paths = [...(this.pendingAffectedPaths.get(root) ?? [])];
    this.pendingAffectedPaths.delete(root);
    return paths;
  }

  private async reindexAffectedAndValidate(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    const packet = this.applicationStore.snapshot().correctionPacket as
      { affectedPaths?: readonly string[]; changedPaths?: readonly string[] } | undefined;
    const paths = [...(packet?.affectedPaths ?? []), ...(packet?.changedPaths ?? [])].filter(
      (value, index, values) => values.indexOf(value) === index
    );
    if (!paths.length) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message:
          "No changed or affected paths are available. Generate a fresh correction packet first."
      });
      return;
    }
    try {
      this.post({
        type: "NOTIFICATION",
        level: "info",
        message: `Refreshing ${paths.length} changed/affected path(s) and running impacted validation...`
      });
      if (this.indexing) {
        this.queueAffectedPaths(root, paths);
        this.refreshQueued = true;
        while (this.indexing || this.refreshQueued || this.pendingIndexRoots.has(root)) {
          const active = this.activeIndexPromise;
          if (active) await active;
          else await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } else {
        await this.indexWorkspace(root, paths);
      }
      await this.runValidation(
        "impacted",
        this.sdlcPlan?.stories.find((story) =>
          ["delegated", "in-progress", "awaiting-validation", "review-required"].includes(
            story.status
          )
        )?.id
      );
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message:
          error instanceof Error
            ? `Affected-path refresh failed: ${error.message}`
            : "Affected-path refresh failed."
      });
    }
  }

  async analyzeIntent(text: string): Promise<void> {
    const generation = ++this.analysisGeneration;
    const root = this.workspaceRoot();
    if (!root) {
      this.post({
        type: "ERROR",
        operation: "analysis",
        message: "Open a workspace before analyzing an intent."
      });
      return;
    }
    if (!text.trim()) {
      this.post({
        type: "ERROR",
        operation: "analysis",
        message: "Enter a task intent before running analysis."
      });
      return;
    }
    this.post({ type: "STATE_UPDATE", state: { status: "analyzing" } });
    const operationId = `intent-analysis-${generation}`;
    this.applicationStore.mergeOperation({
      id: operationId,
      kind: "analysis",
      status: "running",
      progress: 5,
      message: "Resolving intent against persisted OKF, graph, CPG, tests and repository evidence.",
      updatedAt: new Date().toISOString()
    });
    this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
    this.logInfo(`Analyzing task intent against persisted repository intelligence: ${text.trim()}`);
    try {
      const active = vscode.window.activeTextEditor?.document.uri;
      const currentFile =
        active?.scheme === "file"
          ? vscode.workspace.asRelativePath(active, false).replace(/\\/g, "/")
          : undefined;
      const result = await this.getService(root).analyze(text.trim(), { currentFile });
      if (generation !== this.analysisGeneration) {
        if (result.taskWorkspace)
          await this.getService(root).discardTaskWorkspace(result.taskWorkspace);
        return;
      }
      this.statusBar.text = `Keystone: Indexed | Route: ${result?.route ?? ""} | Tokens Saved: ${result?.tokenReduction ?? 0}% | QA: ${result?.relatedTests?.length ?? 0}`;
      this.logInfo(
        `Task analysis complete; route=${result.route}; relevantFiles=${result.relevantFiles.length}; relatedTests=${result.relatedTests.length}; tokenReduction=${result.tokenReduction}%.`
      );
      this.applicationStore.update({
        taskAnalysis: result,
        activeTask: result.taskWorkspace,
        status: "ready"
      });
      this.applicationStore.mergeOperation({
        id: operationId,
        kind: "analysis",
        status: "completed",
        progress: 100,
        message: `Repository R&D ready with ${result.researchDocument.evidenceMatrix.length} curated evidence item(s).`,
        updatedAt: new Date().toISOString()
      });
      this.post({ type: "TASK_RESULT", result });
      this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logError(`Task analysis failed: ${message}`);
      this.applicationStore.update({ status: "error" });
      this.applicationStore.mergeOperation({
        id: operationId,
        kind: "analysis",
        status: "failed",
        progress: 100,
        message,
        updatedAt: new Date().toISOString()
      });
      this.post({ type: "ERROR", operation: "analysis", message });
      this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
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
      if (root)
        void this.getService(root)
          .clearContextCache()
          .then((removed) =>
            this.post({
              type: "NOTIFICATION",
              level: "info",
              message: `Cleared ${removed} cached context pack(s).`
            })
          );
      return;
    }
    if (message.type === "ENHANCE_INTENT") {
      const root = this.workspaceRoot();
      const active = vscode.window.activeTextEditor?.document.uri;
      const currentFile =
        active?.scheme === "file"
          ? vscode.workspace.asRelativePath(active, false).replace(/\\/g, "/")
          : undefined;
      if (root)
        void this.getService(root)
          .enhanceUserIntent(message.text, message.mode, message.sessionId, currentFile)
          .then((session) => this.post({ type: "INTENT_ENHANCED", session }))
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "LOAD_ENHANCEMENT_SESSIONS") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .enhancementSessions()
          .then((sessions) => this.post({ type: "ENHANCEMENT_SESSIONS_RESULT", sessions }));
      return;
    }
    if (message.type === "DELETE_ENHANCEMENT_SESSION") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .deleteEnhancementSession(message.sessionId)
          .then(async () =>
            this.post({
              type: "ENHANCEMENT_SESSIONS_RESULT",
              sessions: await this.getService(root).enhancementSessions()
            })
          );
      return;
    }
    if (message.type === "RETRIEVE_CONTEXT_ORIGINAL") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .retrieveContextOriginal(message.path, message.expectedHash)
          .then((result) => this.post({ type: "CONTEXT_ORIGINAL_RESULT", ...result }))
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "LOAD_CONTEXT_PACKET") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .loadContextPacket(message.packetId, message.segmentKinds)
          .then((result) => this.post({ type: "CONTEXT_PACKET_RESULT", ...result }))
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "RECORD_CONTEXT_FEEDBACK") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .recordContextFeedback(message.intent, message.path, message.rating)
          .then(() =>
            this.post({
              type: "NOTIFICATION",
              level: "info",
              message: "Context feedback recorded for future retrieval."
            })
          );
      return;
    }
    if (message.type === "REQUEST_CORRECTION_PACKET") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .createCorrectionPacket({ reason: "manual" })
          .then((packet) => {
            this.applicationStore.update({ correctionPacket: packet });
            this.post({ type: "CORRECTION_PACKET_RESULT", packet });
          })
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "REINDEX_AFFECTED_AND_VALIDATE") {
      void this.reindexAffectedAndValidate();
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
    if (message.type === "APPROVE_INTENT_RESEARCH") {
      const root = this.workspaceRoot();
      const task = this.applicationStore.snapshot().taskAnalysis as KeystoneTaskResult | undefined;
      if (!root || !task || task.intentId !== message.intentId) {
        this.post({
          type: "NOTIFICATION",
          level: "error",
          message: "The active research artifact is no longer current. Research the intent again."
        });
        return;
      }
      void this.getService(root)
        .approveIntentResearch(message.intentId)
        .then(() => {
          const approved = { ...task, researchStatus: "approved" as const };
          this.applicationStore.update({ taskAnalysis: approved });
          this.post({ type: "TASK_RESULT", result: approved });
          this.post({
            type: "NOTIFICATION",
            level: "info",
            message: "Repository R&D approved. Specification and story planning are now unlocked."
          });
        })
        .catch((error) =>
          this.post({
            type: "NOTIFICATION",
            level: "error",
            message: error instanceof Error ? error.message : String(error)
          })
        );
      return;
    }
    if (message.type === "RUN_VALIDATION") {
      void this.runValidation(message.scope, message.storyId);
      return;
    }
    if (message.type === "COMPLETE_TASK") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .completeActiveTask()
          .then(() => this.post({ type: "TASK_COMPLETION_RESULT", success: true }))
          .catch((error) =>
            this.post({
              type: "TASK_COMPLETION_RESULT",
              success: false,
              error: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "ANALYZE_MODERNIZATION") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .analyzeModernization()
          .then((proposal) => this.post({ type: "MODERNIZATION_PROPOSAL", proposal }))
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "ACCEPT_MODERNIZATION") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .acceptModernization(message.proposalId, message.decision)
          .then((plan) => this.post({ type: "MODERNIZATION_PLAN", plan }))
          .catch((error) =>
            this.post({
              type: "ERROR",
              operation: "analysis",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "APPROVE_DELEGATION") {
      const root = this.workspaceRoot();
      if (root)
        void this.approveAndDelegate(root, message)
          .then((result) => this.post({ type: "DELEGATION_RESULT", ...result }))
          .catch((error) => {
            const now = new Date().toISOString();
            this.post({
              type: "DELEGATION_RESULT",
              success: false,
              captured: false,
              mode: message.mode,
              storyId: message.storyId,
              startedAt: now,
              completedAt: now,
              error: error instanceof Error ? error.message : String(error)
            });
          });
      return;
    }
    if (message.type === "COPY_COPILOT_PROMPT") {
      void vscode.env.clipboard
        .writeText(message.prompt)
        .then(() =>
          this.post({ type: "NOTIFICATION", level: "info", message: "Copilot prompt copied." })
        );
      return;
    }
    if (message.type === "COPY_PR_MARKDOWN") {
      void vscode.env.clipboard
        .writeText(message.markdown)
        .then(() =>
          this.post({ type: "NOTIFICATION", level: "info", message: "PR summary copied." })
        );
      return;
    }
    if (message.type === "SAVE_SETTINGS") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .saveSettings(message.settings)
          .then(() =>
            this.post({ type: "NOTIFICATION", level: "info", message: "Workspace settings saved." })
          );
      return;
    }
    if (message.type === "OPEN_BROWSER_VIEW") {
      void this.openBrowserView();
      return;
    }
    if (message.type === "CONFIGURE_VALUEEDGE") {
      void this.configureValueEdge();
      return;
    }
    if (message.type === "IMPORT_VALUEEDGE_FEATURE") {
      void this.importValueEdgeFeature(message.featureId);
      return;
    }
    if (message.type === "PUBLISH_VALUEEDGE_STORIES") {
      void this.publishValueEdgeStories();
      return;
    }
    if (message.type === "QUERY_INTELLIGENCE") {
      const root = this.workspaceRoot();
      if (root)
        void this.whenIndexReady(root, () => this.getService(root).queryIntelligence(message.query))
          .then((result) => this.post({ type: "INTELLIGENCE_QUERY_RESULT", result }))
          .catch((error) =>
            this.post({
              type: "NOTIFICATION",
              level: "error",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "EXPLORE_INTELLIGENCE") {
      const root = this.workspaceRoot();
      if (root)
        void this.whenIndexReady(root, () =>
          this.getService(root).exploreIntelligence(
            message.query ?? "",
            message.kind ?? "all",
            message.cursor
          )
        )
          .then((result) => this.post({ type: "INTELLIGENCE_EXPLORER_RESULT", result }))
          .catch((error) =>
            this.post({
              type: "NOTIFICATION",
              level: "error",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "LOAD_INTELLIGENCE_GRAPH") {
      const root = this.workspaceRoot();
      if (root)
        void this.whenIndexReady(root, () =>
          this.getService(root).graphIntelligence(
            message.mode,
            message.query ?? "",
            message.seedIds ?? []
          )
        )
          .then((result) => this.post({ type: "INTELLIGENCE_GRAPH_RESULT", result }))
          .catch((error) =>
            this.post({
              type: "NOTIFICATION",
              level: "error",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "LOAD_CPG_VIEW") {
      const root = this.workspaceRoot();
      if (root)
        void this.whenIndexReady(root, () =>
          this.getService(root).cpgIntelligence(
            message.sourcePath,
            message.edgeKind ?? "all",
            message.focusNodeId
          )
        )
          .then((result) => this.post({ type: "CPG_VIEW_RESULT", result }))
          .catch((error) =>
            this.post({
              type: "NOTIFICATION",
              level: "error",
              message: error instanceof Error ? error.message : String(error)
            })
          );
      return;
    }
    if (message.type === "OPEN_SOURCE_LOCATION") {
      void this.openSourceLocation(message.path, message.line);
      return;
    }
    if (message.type === "RESOLVE_SDLC_FINDING") {
      if (!this.sdlcPlan) {
        this.post({ type: "NOTIFICATION", level: "error", message: "Create an SDLC plan first." });
        return;
      }
      try {
        this.sdlcPlan = this.sdlcEngine.resolveFinding(
          this.sdlcPlan,
          message.storyId,
          message.findingId,
          message.status
        );
        void this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      } catch (error) {
        this.post({
          type: "NOTIFICATION",
          level: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    if (message.type === "CREATE_SDLC_PLAN") {
      void this.createSdlcPlan(message.intent);
      return;
    }
    if (message.type === "SDLC_TRANSITION") {
      if (!this.sdlcPlan) {
        this.post({ type: "NOTIFICATION", level: "error", message: "Create an SDLC plan first." });
        return;
      }
      try {
        this.sdlcPlan = this.sdlcEngine.transition(this.sdlcPlan, message.storyId, message.status, {
          evidence: message.evidence,
          satisfiedCriteria: message.satisfiedCriteria,
          blockers: message.blockers
        });
        void this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      } catch (error) {
        this.post({
          type: "NOTIFICATION",
          level: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    if (message.type === "APPROVE_SPECIFICATION") {
      if (!this.sdlcPlan) {
        this.post({ type: "NOTIFICATION", level: "error", message: "Create an SDLC plan first." });
        return;
      }
      try {
        this.sdlcPlan = this.sdlcEngine.approveSpecification(this.sdlcPlan);
        this.sdlcPlan = {
          ...this.sdlcPlan,
          backlogStories: this.sdlcPlan.backlogStories.map((story) =>
            story.status === "draft" ? { ...story, status: "approved" as const } : story
          )
        };
        void this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      } catch (error) {
        this.post({
          type: "NOTIFICATION",
          level: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    if (message.type === "CREATE_TASK_HANDOFF") {
      void this.createTaskHandoffPackage(message.passphrase);
      return;
    }
    if (message.type === "RESTORE_TASK_HANDOFF") {
      void this.restoreTaskHandoffPackage(
        message.packageText,
        message.passphrase,
        message.manualSyncConfirmed
      );
      return;
    }
    if (message.type === "RECORD_DECISION") {
      const root = this.workspaceRoot();
      if (root)
        void this.getService(root)
          .recordDecision(message.category, message.action, message.subject)
          .then(() =>
            message.category === "task"
              ? this.post({ type: "TASK_DECISION_RESULT", success: true, action: message.action })
              : this.post({
                  type: "NOTIFICATION",
                  level: "info",
                  message: "Risk decision recorded."
                })
          )
          .catch((error: unknown) =>
            message.category === "task"
              ? this.post({
                  type: "TASK_DECISION_RESULT",
                  success: false,
                  action: message.action,
                  error: error instanceof Error ? error.message : String(error)
                })
              : this.post({
                  type: "NOTIFICATION",
                  level: "error",
                  message: error instanceof Error ? error.message : String(error)
                })
          );
    }
  }

  private async createSdlcPlan(intent: string): Promise<void> {
    try {
      const task = this.applicationStore.snapshot().taskAnalysis as KeystoneTaskResult | undefined;
      if (!task?.researchDocument?.markdown)
        throw new Error(
          "Research the intent first. Keystone requires a reviewable R&D artifact before SDLC planning."
        );
      if (task.researchStatus !== "approved")
        throw new Error(
          "Review and approve the repository R&D before creating the implementation specification and stories."
        );
      const state = this.applicationStore.snapshot().intelligence as
        { architecture?: string } | undefined;
      let plan = this.sdlcEngine.createPlan(intent, {
        intentId: task.intentId,
        researchDocument: task.researchDocument,
        researchApproved: true,
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
        affectedFlows: task?.contextSections?.flatMap(
          (section) =>
            section.evidence
              ?.filter((item) => item.kind.includes("flow"))
              .map((item) => `${item.kind}: ${item.label}`) ?? []
        ),
        evidence: task?.evidence?.map((item, index) => ({
          id: item.okfId ?? `task-evidence-${index + 1}`,
          kind: ([
            "file",
            "symbol",
            "api",
            "service",
            "data",
            "test",
            "risk",
            "flow",
            "architecture"
          ].includes(item.kind)
            ? item.kind
            : "architecture") as import("@core/workflow/sdlc/engine").SDLCResearchEvidence["kind"],
          label: item.label,
          summary: item.label,
          path: item.path,
          okfId: item.okfId,
          confidence: item.confidence
        })),
        functionalRequirements: task?.acceptanceCriteria,
        nonFunctionalRequirements: [
          ...(task?.securityConstraints ?? []),
          ...(task?.performanceConstraints ?? [])
        ],
        constraints: [
          ...(task?.architectureConstraints ?? []),
          "Keystone Git access remains strictly read-only."
        ],
        architecture: state?.architecture,
        source: this.valueEdgeFeature
          ? {
              kind: "valueedge",
              featureId: this.valueEdgeFeature.id,
              featureName: this.valueEdgeFeature.name,
              featureUrl: this.valueEdgeFeature.webUrl
            }
          : { kind: "local" }
      });
      if (task) plan = this.attachTaskEvidenceToPlan(plan, task);
      this.sdlcPlan = plan;
      await this.persistSdlcPlan(plan);
      const root = this.workspaceRoot();
      if (root) await this.getService(root).attachActiveSdlcPlan(plan);
      this.applicationStore.update({ sdlc: plan });
      this.post({ type: "SDLC_PLAN_RESULT", plan });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private attachTaskEvidenceToPlan(plan: SDLCPlan, task: KeystoneTaskResult): SDLCPlan {
    const analysis = task.analysisEvidence;
    if (!analysis) return plan;
    const story = (type: SDLCPlan["stories"][number]["type"]) =>
      plan.stories.find((item) => item.type === type);
    const addEvidence = (type: SDLCPlan["stories"][number]["type"], evidence: string[]): void => {
      const current = story(type);
      if (!current || !evidence.length) return;
      plan = this.sdlcEngine.recordEvidence(plan, current.id, evidence);
    };
    const severity = (value: string): "info" | "low" | "medium" | "high" | "critical" =>
      value === "critical"
        ? "critical"
        : value === "high"
          ? "high"
          : value === "medium"
            ? "medium"
            : value === "low"
              ? "low"
              : "info";

    const qaEvidence = analysis.qa.gaps.map(
      (item) =>
        `${item.type}: ${item.path} — ${item.reason} (severity ${Math.round(item.severity * 100)}%)`
    );
    for (const type of [
      "existing-test-analysis",
      "test-impact-analysis",
      "new-test-creation"
    ] as const)
      addEvidence(type, qaEvidence);
    addEvidence(
      "new-test-creation",
      (task.testGeneration?.scenarios ?? []).map(
        (item) => `${item.priority}: ${item.name} — ${item.description}`
      )
    );
    const qaStory = story("existing-test-analysis");
    if (qaStory)
      for (const item of analysis.qa.gaps)
        plan = this.sdlcEngine.recordFinding(plan, qaStory.id, {
          kind: "qa",
          severity: item.severity >= 0.8 ? "high" : item.severity >= 0.5 ? "medium" : "low",
          summary: `${item.type}: ${item.path} — ${item.reason}`,
          status: "open",
          evidence: [item.path, item.reason]
        });

    const securityStory = story("security-review");
    if (securityStory)
      for (const item of analysis.security.findings)
        plan = this.sdlcEngine.recordFinding(plan, securityStory.id, {
          kind: "security",
          severity: severity(item.severity),
          summary: `${item.title} at ${item.path}:${item.line}`,
          status: "open",
          evidence: [
            item.explanation,
            item.remediation,
            `confidence=${Math.round(item.confidence * 100)}%`
          ]
        });
    addEvidence("security-review", [
      ...analysis.security.findings.map(
        (item) => `${item.path}:${item.line} ${item.title} — ${item.explanation}`
      ),
      ...analysis.security.intelligenceSignals.map((item) => `OKF ${item.kind}: ${item.summary}`)
    ]);

    const performanceStory = story("performance-review");
    if (performanceStory)
      for (const item of analysis.performance.findings)
        plan = this.sdlcEngine.recordFinding(plan, performanceStory.id, {
          kind: "performance",
          severity: severity(item.severity),
          summary: `${item.title} at ${item.path}:${item.line}`,
          status: "open",
          evidence: [
            item.explanation,
            item.remediation,
            `confidence=${Math.round(item.confidence * 100)}%`
          ]
        });
    addEvidence("performance-review", [
      ...analysis.performance.findings.map(
        (item) => `${item.path}:${item.line} ${item.title} — ${item.explanation}`
      ),
      ...analysis.performance.intelligenceSignals.map((item) => `OKF ${item.kind}: ${item.summary}`)
    ]);

    const modernizationStory = story("modernization-review");
    if (modernizationStory)
      for (const item of analysis.modernization.gaps)
        plan = this.sdlcEngine.recordFinding(plan, modernizationStory.id, {
          kind: "architecture",
          severity: severity(item.priority),
          summary: `${item.area}: ${item.title}`,
          status: "open",
          evidence: item.evidence
        });
    addEvidence(
      "modernization-review",
      analysis.modernization.gaps.map((item) => `${item.priority}: ${item.area} — ${item.title}`)
    );

    const diffEvidence = [
      `Read-only Git review: branch=${analysis.gitReview.branch ?? "unknown"}; changedFiles=${analysis.gitReview.changedFiles.join(", ") || "none"}; diffSha256=${analysis.gitReview.diffHash}; diffBytes=${analysis.gitReview.diffBytes}; artifact=${analysis.gitReview.diffArtifactPath ?? "none"}`
    ];
    addEvidence("code-review", diffEvidence);
    addEvidence("pr-review", diffEvidence);
    return plan;
  }

  async configureValueEdge(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("keystone.valueEdge");
      const baseUrl = await vscode.window.showInputBox({
        title: "ValueEdge base URL",
        value: config.get("baseUrl", ""),
        ignoreFocusOut: true
      });
      if (baseUrl === undefined) return;
      const sharedSpaceId = await vscode.window.showInputBox({
        title: "ValueEdge shared space ID",
        value: config.get("sharedSpaceId", ""),
        ignoreFocusOut: true
      });
      if (sharedSpaceId === undefined) return;
      const workspaceId = await vscode.window.showInputBox({
        title: "ValueEdge workspace ID",
        value: config.get("workspaceId", ""),
        ignoreFocusOut: true
      });
      if (workspaceId === undefined) return;
      const clientId = await vscode.window.showInputBox({
        title: "ValueEdge client ID",
        value: config.get("clientId", ""),
        ignoreFocusOut: true
      });
      if (clientId === undefined) return;
      const clientSecret = await vscode.window.showInputBox({
        title: "ValueEdge client secret",
        password: true,
        ignoreFocusOut: true
      });
      if (clientSecret === undefined) return;
      await Promise.all([
        config.update("baseUrl", baseUrl.trim(), vscode.ConfigurationTarget.Workspace),
        config.update("sharedSpaceId", sharedSpaceId.trim(), vscode.ConfigurationTarget.Workspace),
        config.update("workspaceId", workspaceId.trim(), vscode.ConfigurationTarget.Workspace),
        config.update("clientId", clientId.trim(), vscode.ConfigurationTarget.Workspace),
        this.extensionContext.secrets.store("keystone.valueEdge.clientSecret", clientSecret)
      ]);
      this.post({
        type: "NOTIFICATION",
        level: "info",
        message:
          "ValueEdge connection configured. The client secret is stored only in VS Code SecretStorage."
      });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async importValueEdgeFeature(featureId: string): Promise<void> {
    try {
      const client = await this.valueEdgeClient();
      const feature = await client.fetchFeature(featureId.trim());
      this.valueEdgeFeature = feature;
      this.applicationStore.update({ valueEdgeFeature: feature });
      this.post({ type: "VALUEEDGE_FEATURE_RESULT", feature });
      await this.analyzeIntent([feature.name, feature.description].filter(Boolean).join("\n\n"));
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async publishValueEdgeStories(): Promise<void> {
    try {
      if (
        !this.sdlcPlan ||
        this.sdlcPlan.source.kind !== "valueedge" ||
        !this.sdlcPlan.source.featureId
      )
        throw new Error("Create and approve an SDLC plan imported from a ValueEdge feature first.");
      if (this.sdlcPlan.specificationStatus !== "approved")
        throw new Error("Approve the specification before publishing ValueEdge stories.");
      const approved = this.sdlcPlan.backlogStories.filter((story) => story.status === "approved");
      if (!approved.length) throw new Error("There are no approved stories to publish.");
      const confirmation = await vscode.window.showWarningMessage(
        `Publish ${approved.length} draft user/quality stories under ValueEdge feature ${this.sdlcPlan.source.featureId}?`,
        { modal: true },
        "Publish Draft Stories"
      );
      if (confirmation !== "Publish Draft Stories") return;
      const published = await (
        await this.valueEdgeClient()
      ).publishBacklogStories(this.sdlcPlan.source.featureId, approved);
      const byId = new Map(published.map((item) => [item.localId, item.externalId]));
      this.sdlcPlan = {
        ...this.sdlcPlan,
        backlogStories: this.sdlcPlan.backlogStories.map((story) =>
          byId.has(story.id)
            ? { ...story, status: "published" as const, externalId: byId.get(story.id) }
            : story
        ),
        updatedAt: new Date().toISOString()
      };
      await this.persistSdlcPlan(this.sdlcPlan);
      this.applicationStore.update({ sdlc: this.sdlcPlan });
      this.post({ type: "VALUEEDGE_PUBLISH_RESULT", published });
      this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async valueEdgeClient(): Promise<ValueEdgeClient> {
    const config = vscode.workspace.getConfiguration("keystone.valueEdge");
    const connection: ValueEdgeConnection = {
      baseUrl: config.get("baseUrl", ""),
      sharedSpaceId: config.get("sharedSpaceId", ""),
      workspaceId: config.get("workspaceId", ""),
      clientId: config.get("clientId", "")
    };
    const secret = await this.extensionContext.secrets.get("keystone.valueEdge.clientSecret");
    return new ValueEdgeClient(connection, secret ?? "");
  }

  private async persistSdlcPlan(plan: SDLCPlan): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) throw new Error("Open a workspace before persisting an SDLC plan.");
    await new SDLCPlanStore(root).write(plan);
  }

  private async createTaskHandoffPackage(passphrase: string): Promise<void> {
    try {
      if (passphrase.length < 12)
        throw new Error("Task Handoff passphrase must be at least 12 characters.");
      const root = this.workspaceRoot();
      if (!root) throw new Error("Open a workspace before creating Task Handoff.");
      const task = this.applicationStore.snapshot().taskAnalysis as KeystoneTaskResult | undefined;
      if (!task) throw new Error("Analyze an intent before creating Task Handoff.");
      const correctionPackets = await this.getService(root).correctionPacketsForActiveTask();
      const input = authoritativeHandoffInput(task, root, this.sdlcPlan, correctionPackets);
      const packageValue = new TaskStatePackageBuilder().build(input);
      const encrypted = await encryptHandoffPackage(JSON.stringify(packageValue), passphrase);
      await this.getService(root).exportActiveTaskForHandoff(root);
      await vscode.env.clipboard.writeText(encrypted);
      await this.saveHandoffRecord({
        packageValue,
        status: "Shared",
        warnings: [],
        activity: [
          { at: packageValue.createdAt, actor: "you", action: "Created encrypted handoff package" },
          {
            at: packageValue.updatedAt,
            actor: "Keystone",
            action: `Secret scan completed; ${packageValue.redactionReport.findings.length} finding(s) redacted`
          }
        ]
      });
      this.post({
        type: "TASK_HANDOFF_CREATED",
        redactionCategories: packageValue.redactionReport.removedCategories,
        checksum: packageValue.checksum,
        encryptedPackage: encrypted
      });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message:
          error instanceof Error ? error.message : "Could not create the task handoff package."
      });
    }
  }

  private async restoreTaskHandoffPackage(
    packageText: string,
    passphrase: string,
    manuallySynchronized: boolean
  ): Promise<void> {
    try {
      if (!manuallySynchronized) throw new Error("Manual Repository Sync Required.");
      const plaintext = await decryptHandoffPackage(packageText, passphrase);
      const packageValue = JSON.parse(plaintext) as TaskStatePackage;
      const restorer = new TaskStateRestorer(new WorkspaceStateTaskStore(this.extensionContext));
      const folder = vscode.workspace.workspaceFolders?.[0];
      const preview = restorer.preview(
        packageValue,
        folder ? { name: folder.name, path: folder.uri.fsPath } : undefined
      );
      await restorer.restore(preview, MANUAL_SYNC_CONFIRMATION);
      const restored = preview.packageValue;
      const root = this.workspaceRoot();
      if (root) {
        await this.getService(root).importTaskHandoff(
          restored as unknown as Record<string, unknown>
        );
        if (restored.sdlcPlan) {
          this.sdlcPlan = restored.sdlcPlan;
          await this.persistSdlcPlan(restored.sdlcPlan);
          this.applicationStore.update({ sdlc: restored.sdlcPlan });
        }
        // A handoff transfers task continuity, never repository truth. Refresh local deterministic
        // intelligence against the recipient's manually synchronized workspace before continuing.
        void this.indexWorkspace(root);
      }
      await this.saveHandoffRecord({
        packageValue: restored,
        status: "Restored",
        warnings: preview.warnings,
        activity: [
          {
            at: new Date().toISOString(),
            actor: "you",
            action: "Restored task state and SDLC continuation after manual repository confirmation"
          }
        ]
      });
      this.post({
        type: "TASK_HANDOFF_RESTORED",
        packageValue: restored,
        warnings: preview.warnings,
        continuationBriefing: preview.continuationBriefing,
        restoredNow: true
      });
      if (restored.sdlcPlan) this.post({ type: "SDLC_PLAN_RESULT", plan: restored.sdlcPlan });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message:
          error instanceof Error ? error.message : "The handoff package could not be restored."
      });
    }
  }

  private async approveAndDelegate(
    root: string,
    message: Extract<WebviewToExtensionMessage, { type: "APPROVE_DELEGATION" }>
  ): Promise<CopilotDelegationResult> {
    let storyId = message.storyId;
    const correctionPacket = message.correctionPacketId
      ? (this.applicationStore.snapshot().correctionPacket as
          { id: string; snapshotDigest?: string } | undefined)
      : undefined;
    if (message.correctionPacketId && correctionPacket?.id !== message.correctionPacketId)
      throw new Error("The correction packet is no longer active. Regenerate it before retrying.");
    if (this.sdlcPlan) {
      const story = storyId
        ? this.sdlcPlan.stories.find((item) => item.id === storyId)
        : this.sdlcPlan.stories.find((item) => item.status === "in-progress");
      if (story) {
        storyId = story.id;
        if (message.correctionPacketId) {
          if (story.status === "review-required") {
            this.sdlcPlan = this.sdlcEngine.transition(this.sdlcPlan, story.id, "in-progress", {
              evidence: [
                `Correction packet ${message.correctionPacketId} selected for user-approved Copilot recovery.`
              ]
            });
          } else if (story.status !== "in-progress") {
            throw new Error(
              `Correction delegation requires a review-required or in-progress story, found ${story.status}.`
            );
          }
        }
        this.sdlcPlan = this.sdlcEngine.prepareDelegation(this.sdlcPlan, story.id, {
          agent: message.agent ?? "GitHub Copilot",
          skills: message.skills,
          instructions: message.instructions,
          prompt: message.prompt,
          contextPackId: message.contextPackId,
          correctionPacketId: message.correctionPacketId
        });
        this.sdlcPlan = this.sdlcEngine.approveDelegation(this.sdlcPlan, story.id);
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      }
    }
    const result = await this.delegateApprovedPrompt(root, message.mode, message.prompt, {
      storyId,
      agent: message.agent,
      skills: message.skills,
      instructions: message.instructions,
      correctionPacketId: message.correctionPacketId
    });
    if (result.captured && result.success && this.sdlcPlan && storyId) {
      const story = this.sdlcPlan.stories.find((item) => item.id === storyId);
      if (story?.status === "delegated") {
        const correctionEvidence = story.delegation?.correctionPacketId
          ? [
              `Captured Copilot result is attached to correction packet ${story.delegation.correctionPacketId}.`,
              "The corrected workspace result is ready for the next validation transition."
            ]
          : [];
        this.sdlcPlan = this.sdlcEngine.completeDelegation(this.sdlcPlan, storyId, [
          `Copilot response captured by Keystone (${result.model?.name ?? result.model?.id ?? "GitHub Copilot"}).`,
          result.artifactPath
            ? `Captured result artifact: ${result.artifactPath}`
            : "Captured result stored locally.",
          ...correctionEvidence
        ]);
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      }
    }
    if (!result.success) {
      try {
        const packet = await this.getService(root).createCorrectionPacket({
          reason: "delegation-failure",
          failures: [result.error ?? `${result.mode} failed.`],
          remediations: [
            "Review the bounded OKF evidence and validation guidance, then retry only after confirming the selected context is sufficient."
          ]
        });
        this.applicationStore.update({ correctionPacket: packet });
        this.post({ type: "CORRECTION_PACKET_RESULT", packet });
      } catch (error) {
        this.post({
          type: "NOTIFICATION",
          level: "error",
          message:
            error instanceof Error
              ? `Delegation failed; correction packet could not be generated: ${error.message}`
              : "Delegation failed; correction packet could not be generated."
        });
      }
    }
    this.applicationStore.update({ delegationResult: result });
    return result;
  }

  private async delegateApprovedPrompt(
    root: string,
    mode: string,
    prompt: string,
    options: {
      storyId?: string;
      agent?: string;
      skills?: readonly string[];
      instructions?: readonly string[];
      correctionPacketId?: string;
    } = {}
  ): Promise<CopilotDelegationResult> {
    const startedAt = new Date().toISOString();
    await this.getService(root).approveDelegation(mode, prompt, options.correctionPacketId);
    if (mode === "Manual Copy Prompt") {
      await vscode.env.clipboard.writeText(prompt);
      const result: CopilotDelegationResult = {
        success: true,
        captured: false,
        mode,
        storyId: options.storyId,
        startedAt,
        completedAt: new Date().toISOString()
      };
      result.artifactPath = await this.getService(root).recordDelegationResult(result);
      this.post({
        type: "NOTIFICATION",
        level: "info",
        message:
          "Delegation approved, recorded, and copied. The response remains external until evidence is attached."
      });
      return result;
    }
    if (mode === "Copilot Inline Edit") {
      await vscode.env.clipboard.writeText(prompt);
      await vscode.commands.executeCommand("inlineChat.start");
      const result: CopilotDelegationResult = {
        success: true,
        captured: false,
        mode,
        storyId: options.storyId,
        startedAt,
        completedAt: new Date().toISOString()
      };
      result.artifactPath = await this.getService(root).recordDelegationResult(result);
      this.post({
        type: "NOTIFICATION",
        level: "info",
        message:
          "Inline Chat opened; the approved prompt is on the clipboard. Keystone will not claim a returned result until evidence is captured."
      });
      return result;
    }

    // Prefer VS Code's Language Model API so a user-approved Copilot request is sent and
    // the streamed response is captured back into the active Keystone task. If the API is
    // unavailable or the user has not granted model access, fall back to Copilot Chat UI
    // without pretending that Keystone captured a result.
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const model = models[0];
      if (model) {
        const selectedAgent = options.agent?.trim() || "GitHub Copilot";
        const skills = (options.skills ?? []).filter(Boolean);
        const instructions = (options.instructions ?? []).filter(Boolean);
        const delegation = [
          "You are GitHub Copilot executing a user-approved Keystone SDLC delegation inside VS Code.",
          "Keystone has already completed repository intelligence and intent R&D. The approved packet below is the bounded source of truth for this task.",
          "Do not search, crawl, enumerate, or retrieve the entire repository. Use only the selected paths and intelligence supplied in the packet; report a missing-evidence gap instead of widening the search.",
          `Selected agent/role: ${selectedAgent}`,
          skills.length ? `Selected skills: ${skills.join(", ")}` : "",
          instructions.length
            ? `Instructions:\n${instructions.map((item) => `- ${item}`).join("\n")}`
            : "",
          "Use the supplied context as evidence. Do not perform Git write or remote merge-request operations.",
          "",
          "Approved Keystone context packet:",
          prompt
        ]
          .filter(Boolean)
          .join("\n");
        const cancellation = new vscode.CancellationTokenSource();
        try {
          const response = await model.sendRequest(
            [vscode.LanguageModelChatMessage.User(delegation)],
            {},
            cancellation.token
          );
          let text = "";
          for await (const fragment of response.text) text += fragment;
          const result: CopilotDelegationResult = {
            success: true,
            captured: true,
            mode,
            storyId: options.storyId,
            startedAt,
            completedAt: new Date().toISOString(),
            text,
            model: {
              id: model.id,
              vendor: model.vendor,
              family: model.family,
              version: model.version,
              name: model.name
            }
          };
          result.artifactPath = await this.getService(root).recordDelegationResult(result);
          this.post({
            type: "NOTIFICATION",
            level: "info",
            message: `Copilot response captured in Keystone${result.artifactPath ? ` (${result.artifactPath})` : ""}. Review the changes before validation.`
          });
          return result;
        } finally {
          cancellation.dispose();
        }
      }
    } catch (error) {
      this.logWarn(
        `Copilot Language Model API was unavailable; falling back to Copilot Chat UI: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
    const result: CopilotDelegationResult = {
      success: true,
      captured: false,
      mode,
      storyId: options.storyId,
      startedAt,
      completedAt: new Date().toISOString()
    };
    result.artifactPath = await this.getService(root).recordDelegationResult(result);
    this.post({
      type: "NOTIFICATION",
      level: "info",
      message: `${mode} opened with the approved Keystone context. The result remains external; Keystone will not mark delegation complete until evidence is captured.`
    });
    return result;
  }

  private async runValidation(scope: "impacted" | "all", storyId?: string): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    try {
      this.post({ type: "NOTIFICATION", level: "info", message: `Running ${scope} validation...` });
      let activeStory = storyId
        ? this.sdlcPlan?.stories.find(
            (story) =>
              story.id === storyId &&
              ["delegated", "in-progress", "awaiting-validation", "review-required"].includes(
                story.status
              )
          )
        : this.sdlcPlan?.stories.find((story) =>
            ["delegated", "in-progress", "awaiting-validation", "review-required"].includes(
              story.status
            )
          );
      if (this.sdlcPlan && activeStory?.status === "delegated") {
        this.post({
          type: "NOTIFICATION",
          level: "info",
          message:
            "Validating the workspace after an external Copilot delegation. Delegation itself remains uncompleted until a captured result/evidence is recorded."
        });
      } else if (this.sdlcPlan && activeStory?.status === "in-progress") {
        this.sdlcPlan = this.sdlcEngine.transition(
          this.sdlcPlan,
          activeStory.id,
          "awaiting-validation"
        );
        activeStory = this.sdlcPlan.stories.find((story) => story.id === activeStory!.id);
      }
      const results = await this.getService(root).runValidation(scope);
      const passed = results.length > 0 && results.every((result) => result.status === "passed");
      if (this.sdlcPlan && activeStory) {
        const evidence = results.flatMap((result) => [
          `${result.command}: ${result.status}`,
          ...result.summary.errors.map((error) => `${result.command}: ${error}`)
        ]);
        this.sdlcPlan = this.sdlcEngine.recordValidation(this.sdlcPlan, activeStory.id, {
          status: passed ? "passed" : "failed",
          commands: results.map((result) => result.command),
          evidence
        });
        await this.persistSdlcPlan(this.sdlcPlan);
        this.applicationStore.update({ sdlc: this.sdlcPlan });
        this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
      }
      if (!passed) {
        try {
          const packet = await this.getService(root).createCorrectionPacket({
            reason: "validation-failure",
            commands: results.map((result) => result.command),
            failures: results
              .filter((result) => result.status === "failed")
              .flatMap((result) =>
                result.summary.errors?.length
                  ? result.summary.errors.map((error) => `${result.command}: ${error}`)
                  : [`${result.command}: ${result.stderr || "Validation failed."}`]
              ),
            remediations: results.flatMap((result) =>
              (result.remediation ?? []).flatMap((proposal) => [
                proposal.summary,
                ...proposal.recommendedActions,
                proposal.copilotPrompt
              ])
            )
          });
          this.applicationStore.update({ correctionPacket: packet });
          this.post({ type: "CORRECTION_PACKET_RESULT", packet });
        } catch (error) {
          this.post({
            type: "NOTIFICATION",
            level: "error",
            message: `Validation failed, but Keystone could not generate the correction packet: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      } else {
        this.applicationStore.update({ correctionPacket: undefined });
        this.post({ type: "STATE_UPDATE", state: { correctionPacket: undefined } });
      }
      this.post({ type: "VALIDATION_RESULT", results });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async loadIntelligence(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    if (this.indexing && this.activeIndexRoot === root) {
      this.post({ type: "APPLICATION_STATE", state: this.applicationStore.snapshot() });
      return;
    }
    this.sdlcPlan = await new SDLCPlanStore(root).read();
    if (this.sdlcPlan) this.applicationStore.update({ sdlc: this.sdlcPlan });
    const state = await this.getService(root).loadState();
    // The initial persisted-state read can overlap automatic recovery indexing.
    // Never let that stale idle/ready snapshot replace the live progress state.
    if (this.indexing && this.activeIndexRoot === root) return;
    this.applicationStore.update({ correctionPacket: state.correctionPacket });
    this.post({
      type: "STATE_UPDATE",
      state: { ...state, correctionPacket: state.correctionPacket }
    });
    if (this.sdlcPlan) this.post({ type: "SDLC_PLAN_RESULT", plan: this.sdlcPlan });
  }

  private async whenIndexReady<T>(root: string, action: () => Promise<T>): Promise<T> {
    if (this.activeIndexRoot === root) await this.activeIndexPromise;
    return action();
  }

  async activeWorkspaceChanged(): Promise<void> {
    const root = this.workspaceRoot();
    if (root) await this.ensureWorkspaceIntelligence(root);
    if (this.panel) await this.loadIntelligence();
  }

  async ensureWorkspaceIntelligence(root: string): Promise<void> {
    if (this.indexing) {
      if (this.activeIndexRoot !== root) this.pendingIndexRoots.add(root);
      return;
    }
    if (this.intelligenceRecoveryRoots.has(root)) return;
    this.intelligenceRecoveryRoots.add(root);
    try {
      const marker = path.join(root, ".keystone", "intelligence", "okf", "manifest.json");
      const present = await fs
        .access(marker)
        .then(() => true)
        .catch(() => false);
      if (!present) {
        this.logInfo(`Persisted intelligence is missing for ${root}; starting recovery indexing.`);
        await this.indexWorkspace(root);
      }
    } finally {
      this.intelligenceRecoveryRoots.delete(root);
    }
  }

  /**
   * Returns one shared worker input after ingestion has settled on a promoted
   * OKF snapshot. Background analyzers must not start from a stale snapshot or
   * rediscover the repository while the canonical run is still in progress.
   */
  async getBackgroundWorkerInput(root: string): Promise<BackgroundWorkerInput | undefined> {
    if (this.indexing || this.refreshQueued || this.pendingIndexRoots.has(root)) return undefined;
    return this.readPromotedWorkerInput(root);
  }

  private async readPromotedWorkerInput(root: string): Promise<BackgroundWorkerInput | undefined> {
    const snapshotPath = path.join(root, ".keystone", "intelligence", "snapshot.json");
    const intelligencePath = path.join(root, ".keystone", "intelligence", "summary.json");
    let snapshot: RepositoryIntelligenceSnapshot;
    try {
      snapshot = JSON.parse(
        await fs.readFile(snapshotPath, "utf8")
      ) as RepositoryIntelligenceSnapshot;
    } catch {
      return undefined;
    }
    if (snapshot.workspaceRoot !== root || !["ready", "degraded"].includes(snapshot.status))
      return undefined;
    const okf = await new OkfSnapshotStore(root).read();
    if (!okf || !snapshot.intelligence) return undefined;
    const snapshotDigest =
      okf.manifest.digests.snapshot ?? okf.manifest.digests.okf ?? okf.manifest.extractionRunId;
    const recovery = Object.fromEntries(
      await Promise.all(
        (["qa", "security", "performance", "modernization"] as const).map(async (kind) => {
          try {
            const record = JSON.parse(
              await fs.readFile(path.join(root, ".keystone", "background", `${kind}.json`), "utf8")
            ) as {
              workerStatus?: string;
              snapshotDigest?: string;
              extractionRunId?: string;
              attempt?: number;
              maxAttempts?: number;
              retryAt?: string;
              workerId?: string;
              startedAt?: string;
            };
            const attempt = Number(record.attempt ?? 1);
            const maxAttempts = Number(record.maxAttempts ?? 3);
            const retryAt =
              typeof record.retryAt === "string" && Number.isFinite(Date.parse(record.retryAt))
                ? record.retryAt
                : undefined;
            if (
              record.workerStatus !== "failed" ||
              record.snapshotDigest !== snapshotDigest ||
              record.extractionRunId !== okf.manifest.extractionRunId ||
              !Number.isSafeInteger(attempt) ||
              !Number.isSafeInteger(maxAttempts) ||
              attempt >= maxAttempts
            )
              return [kind, undefined] as const;
            return [
              kind,
              {
                nextAttempt: attempt + 1,
                retryAt,
                previousWorkerId: record.workerId,
                previousStartedAt: record.startedAt
              } satisfies BackgroundWorkerRecovery
            ] as const;
          } catch {
            return [kind, undefined] as const;
          }
        })
      )
    ) as BackgroundWorkerInput["recovery"];
    const canonicalEvidence = Object.fromEntries(
      (["qa", "security", "performance", "modernization"] as const).map((kind) => {
        const selection = selectCanonicalContext(okf, `${kind} repository evidence`, {
          graphMode: kind === "qa" ? "tests" : "impact",
          graphLimit: 180
        });
        return [kind, canonicalEvidenceEnvelope(okf, selection)] as const;
      })
    ) as BackgroundWorkerInput["canonicalEvidence"];
    return {
      root,
      snapshotPath,
      intelligencePath,
      snapshotDigest,
      extractionRunId: okf.manifest.extractionRunId,
      canonicalEvidence,
      recovery
    };
  }

  private async loadRestoredTaskHandoff(): Promise<void> {
    const sessions = (await this.readHandoffRecords()).filter((record) => {
      try {
        verifyTaskStatePackage(record.packageValue);
        return record.status === "Shared" || record.status === "Restored";
      } catch {
        return false;
      }
    });
    this.post({ type: "TASK_HANDOFFS_RESULT", sessions });
    const taskId = this.extensionContext.workspaceState.get<string>("task-handoff.active-task-id");
    if (!taskId) return;
    const packageValue = this.extensionContext.workspaceState.get<TaskStatePackage>(
      `task-handoff.task.${taskId}`
    );
    if (!packageValue) return;
    try {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const preview = new TaskStateRestorer(
        new WorkspaceStateTaskStore(this.extensionContext)
      ).preview(packageValue, folder ? { name: folder.name, path: folder.uri.fsPath } : undefined);
      this.post({
        type: "TASK_HANDOFF_RESTORED",
        packageValue,
        warnings: preview.warnings,
        continuationBriefing: preview.continuationBriefing,
        restoredNow: false
      });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message:
          error instanceof Error
            ? `Stored handoff could not be loaded: ${error.message}`
            : "Stored handoff could not be loaded."
      });
    }
  }

  private async saveHandoffRecord(record: PersistedHandoffRecord): Promise<void> {
    verifyTaskStatePackage(record.packageValue);
    const records = await this.readHandoffRecords();
    const previous = records.find(
      (item) => item.packageValue.handoffId === record.packageValue.handoffId
    );
    const merged = previous
      ? { ...record, activity: [...previous.activity, ...record.activity] }
      : record;
    const complete = [
      merged,
      ...records.filter((item) => item.packageValue.handoffId !== record.packageValue.handoffId)
    ];
    const root = this.workspaceRoot();
    if (!root) throw new Error("Open a workspace before persisting Task Handoff history.");
    const target = path.join(root, ".keystone", "state", "handoffs", "records.json");
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(complete, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  }

  private async readHandoffRecords(): Promise<PersistedHandoffRecord[]> {
    const root = this.workspaceRoot();
    if (!root) return [];
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(root, ".keystone", "state", "handoffs", "records.json"), "utf8")
      ) as unknown;
      return Array.isArray(parsed) ? (parsed as PersistedHandoffRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async openSourceLocation(relativePath: string, line?: number): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.post({ type: "NOTIFICATION", level: "error", message: "Open a workspace first." });
      return;
    }
    const workspace = path.resolve(root);
    const target = path.resolve(workspace, relativePath);
    if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`)) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: "Evidence path is outside the active workspace."
      });
      return;
    }
    try {
      const uri = vscode.Uri.file(target);
      const zeroBased = Math.max(0, (line ?? 1) - 1);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: true,
        selection: new vscode.Range(zeroBased, 0, zeroBased, 0)
      });
    } catch (error) {
      this.post({
        type: "NOTIFICATION",
        level: "error",
        message: `Could not open ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private getService(root: string): CockpitService {
    const existing = this.services.get(root);
    if (existing) return existing;
    const service = new CockpitService(root, {
      semanticEnricher: new VscodeLanguageServiceEnricher(),
      maxWorkers: vscode.workspace
        .getConfiguration("keystone.intelligence")
        .get<number>("maxWorkers", 5)
    });
    this.services.set(root, service);
    return service;
  }

  private post(message: ExtensionToWebviewMessage): void {
    if (message.type === "STATE_UPDATE") this.applicationStore.update(message.state);
    if (message.type === "INDEX_PROGRESS") {
      const current = this.applicationStore.snapshot();
      const progress = message.progress ?? current.ingestion?.progress ?? 0;
      this.applicationStore.update({
        status: progress >= 100 ? "ready" : "indexing",
        ingestion: {
          active: progress < 100,
          progress,
          stage: message.stage ?? current.ingestion?.stage ?? "indexing",
          message: message.message,
          persistedPath: current.ingestion?.persistedPath ?? ".keystone/intelligence/summary.json",
          queuedRefresh: progress < 100 ? current.ingestion?.queuedRefresh : false,
          workerPool: message.workerPool ?? current.ingestion?.workerPool
        }
      });
      this.applicationStore.mergeOperation({
        id: "repository-index",
        kind: "intelligence",
        status: progress >= 100 ? "completed" : "running",
        progress,
        message: message.message,
        updatedAt: new Date().toISOString()
      });
    }
    if (message.type === "TASK_RESULT")
      this.applicationStore.update({
        taskAnalysis: message.result,
        activeTask: message.result.taskWorkspace
      });
    if (message.type === "DELEGATION_RESULT")
      this.applicationStore.update({ delegationResult: message });
    if (message.type === "VALIDATION_RESULT")
      this.applicationStore.mergeOperation({
        id: "validation",
        kind: "validation",
        status: "completed",
        progress: 100,
        message: `${message.results.length} validation command(s) completed.`,
        updatedAt: new Date().toISOString()
      });
    if (message.type === "QA_BACKGROUND_STATUS") {
      const current = this.applicationStore.snapshot();
      const result = message.result as { canonicalEvidence?: unknown } | undefined;
      this.applicationStore.update({
        backgroundWorkers: {
          ...current.backgroundWorkers,
          qa: {
            status: message.status,
            progress: message.progress ?? (message.status === "complete" ? 100 : undefined),
            message: message.message,
            result: message.result,
            canonicalEvidence:
              result && typeof result === "object" && result !== null
                ? ((result as { canonicalEvidence?: unknown }).canonicalEvidence as
                    OkfCanonicalEvidenceEnvelope | undefined)
                : undefined,
            workerId: message.workerId,
            snapshotDigest: message.snapshotDigest,
            extractionRunId: message.extractionRunId,
            scopePaths: message.scopePaths ? [...message.scopePaths] : undefined,
            startedAt: message.startedAt,
            completedAt: message.completedAt,
            durationMs: message.durationMs,
            attempt: message.attempt,
            maxAttempts: message.maxAttempts,
            retryCount: message.retryCount,
            retryAt: message.retryAt,
            updatedAt: new Date().toISOString()
          }
        }
      });
    }
    if (message.type === "BACKGROUND_ANALYSIS_STATUS") {
      const current = this.applicationStore.snapshot();
      const result = message.result as { canonicalEvidence?: unknown } | undefined;
      this.applicationStore.update({
        backgroundWorkers: {
          ...current.backgroundWorkers,
          [message.worker]: {
            status: message.status,
            progress: message.status === "complete" ? 100 : undefined,
            message: message.error ?? `${message.worker} background worker is ${message.status}.`,
            error: message.error,
            result: message.result,
            canonicalEvidence: result?.canonicalEvidence as
              OkfCanonicalEvidenceEnvelope | undefined,
            workerId: message.workerId,
            snapshotDigest: message.snapshotDigest,
            extractionRunId: message.extractionRunId,
            scopePaths: message.scopePaths ? [...message.scopePaths] : undefined,
            startedAt: message.startedAt,
            completedAt: message.completedAt,
            durationMs: message.durationMs,
            attempt: message.attempt,
            maxAttempts: message.maxAttempts,
            retryCount: message.retryCount,
            retryAt: message.retryAt,
            updatedAt: new Date().toISOString()
          }
        }
      });
    }
    if (message.type === "NOTIFICATION") {
      if (message.message.startsWith("Refresh queued")) {
        const current = this.applicationStore.snapshot();
        this.applicationStore.update({
          status: "indexing",
          ingestion: {
            ...(current.ingestion ?? {
              active: true,
              progress: 0,
              stage: "indexing",
              message: "Repository indexing is in progress."
            }),
            active: true,
            queuedRefresh: true
          }
        });
      }
      this.applicationStore.update({
        notification: { level: message.level, message: message.message }
      });
    }
    if (message.type === "TASK_HANDOFFS_RESULT")
      this.applicationStore.update({ handoffs: message.sessions });
    void this.panel?.webview.postMessage(message);
    this.browserView?.broadcast(message);
  }

  async openBrowserView(): Promise<void> {
    if (!this.browserView) {
      const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "media").fsPath;
      this.browserView = await startBrowserViewServer({
        mediaRoot,
        store: this.applicationStore,
        dispatch: async (message) => this.handleMessage(message)
      });
      this.extensionContext.subscriptions.push({
        dispose: () => {
          void this.browserView?.dispose();
          this.browserView = undefined;
        }
      });
    }
    const external = await vscode.env.asExternalUri(
      vscode.Uri.parse(this.browserView.createBootstrapUrl())
    );
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
    return (
      (active ? vscode.workspace.getWorkspaceFolder(active) : undefined)?.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    );
  }

  /** Public accessor for the current workspace root, used by maintenance commands. */
  get activeWorkspaceRoot(): string | undefined {
    return this.workspaceRoot();
  }

  /** Surface an informational message to the user (toast). Used by maintenance commands. */
  notify(message: string): void {
    this.output.info(message);
  }
}

type PersistedHandoffRecord = {
  packageValue: TaskStatePackage;
  status: "Shared" | "Restored";
  warnings: string[];
  activity: Array<{ at: string; actor: string; action: string }>;
};

function authoritativeHandoffInput(
  result: KeystoneTaskResult,
  root: string,
  plan?: SDLCPlan,
  correctionPackets: CorrectionPacket[] = []
): TaskStatePackageInput {
  const stories = plan?.stories ?? [];
  const completed = stories.filter((s) => s.status === "completed");
  const pending = stories.filter(
    (s) => !["completed", "cancelled", "superseded"].includes(s.status)
  );
  const blocked = stories.filter((s) => s.status === "blocked");
  const current =
    pending.find((s) =>
      [
        "in-progress",
        "awaiting-validation",
        "review-required",
        "delegated",
        "awaiting-delegation-approval"
      ].includes(s.status)
    ) ?? pending[0];
  const spec = plan?.specificationDocument;
  const acceptance = [
    ...new Set(
      spec?.acceptanceCriteria?.length
        ? spec.acceptanceCriteria
        : stories.flatMap((s) => s.acceptanceCriteria)
    )
  ];
  const relevantFiles = result.relevantFiles.filter(handoffImplementationPath);
  const relevantSymbols = result.relevantSymbols.filter((value) => {
    const match = value.match(/—\s*([^:]+):\d+$/);
    return !match || handoffImplementationPath(match[1].trim());
  });
  const research = result.researchDocument;
  const qa = result.analysisEvidence?.qa;
  const security = result.analysisEvidence?.security;
  const performance = result.analysisEvidence?.performance;
  return {
    handoffId: `handoff-${Date.now()}`,
    taskId: plan?.id ?? result.taskWorkspace?.id ?? `task-${Date.now()}`,
    createdBy: "keystone-user",
    repositoryReference: {
      repositoryName: path.basename(root),
      expectedBranch: "manual-sync",
      workspaceFingerprint: result.taskWorkspace?.id
    },
    task: {
      originalUserRequest: plan?.intent ?? research.problemStatement,
      normalizedProblemStatement: research.problemStatement,
      businessGoal: research.problemStatement,
      technicalGoal:
        research.recommendedApproach?.[0] ??
        "Implement the approved repository-specific behavior safely.",
      scope: relevantFiles,
      nonGoals: [
        "Automatic Git mutation",
        "Credential or token sharing",
        "Unapproved repository-wide refactoring"
      ],
      constraints: [
        ...new Set([
          "Git and merge-request access remain read-only",
          ...(research.constraints ?? [])
        ])
      ],
      assumptions: research.unknowns.length
        ? []
        : ["Repository R&D has no unresolved blocking question."],
      acceptanceCriteria: acceptance.length
        ? acceptance
        : (result.acceptanceCriteria ?? result.qaChecklist)
    },
    specification: {
      approvedBehavior:
        plan?.specificationStatus === "approved" ? (spec?.functionalRequirements ?? []) : [],
      functionalRequirements: spec?.functionalRequirements ?? result.acceptanceCriteria ?? [],
      nonFunctionalRequirements: spec?.nonFunctionalRequirements ?? [],
      uiRequirements: [],
      apiRequirements: spec?.affectedInterfaces ?? [],
      dataRequirements: spec?.dataChanges ?? [],
      securityRequirements: [
        ...(result.securityConstraints ?? []),
        ...(security?.findings.map((item) => `${item.severity}: ${item.title}`) ?? [])
      ],
      performanceRequirements: [
        ...(result.performanceConstraints ?? []),
        ...(performance?.findings.map((item) => `${item.severity}: ${item.title}`) ?? [])
      ],
      compatibilityRequirements: spec?.constraints ?? research.constraints
    },
    plan: {
      phases: stories.map((s) => ({
        id: s.id,
        title: s.title,
        tasks: [
          {
            id: s.id,
            title: s.title,
            status:
              s.status === "completed"
                ? "COMPLETED"
                : s.status === "blocked"
                  ? "BLOCKED"
                  : s.status === "in-progress"
                    ? "ACTIVE"
                    : "PENDING",
            dependencies: s.dependencies,
            subtasks: s.acceptanceCriteria
          }
        ]
      })),
      currentPhase: current?.title,
      currentTask: current?.id,
      completedTasks: completed.map((s) => s.title),
      pendingTasks: pending.map((s) => s.title),
      blockedTasks: blocked.map((s) => s.title),
      deferredTasks: stories
        .filter((s) => s.status === "superseded" || s.status === "cancelled")
        .map((s) => s.title)
    },
    sdlcPlan: plan,
    progress: {
      progressPercentage: stories.length
        ? Math.round((completed.length / stories.length) * 100)
        : 0,
      completedWorkSummary: completed.map((s) => s.title),
      currentActivity: current?.title,
      pendingAction: current?.objective,
      blockers: blocked.flatMap((s) => (s.blockers.length ? s.blockers : [s.title])),
      openQuestions: research.unknowns,
      lastUpdateTime: new Date().toISOString()
    },
    context: {
      architectureSummary:
        research.affectedArchitecture.join(" · ") ||
        "Authoritative OKF-backed Keystone repository intelligence",
      relevantModules: [
        ...new Set((result.impactedServices ?? []).map((item) => item.split(" — ")[0]))
      ],
      relevantFiles,
      relevantSymbols,
      dependencyRelationships: research.affectedFlows,
      impactedComponents: [
        ...new Set([...(result.impactedServices ?? []), ...(result.relatedApis ?? [])])
      ],
      repositoryIntelligenceSnapshotReference: ".keystone/intelligence/current.json",
      compressedTaskContext: result.copilotPrompt,
      importantCodeExcerpts: [],
      conventionsToFollow:
        result.copilotCustomizations?.instructions.map(
          (item) => `${item.path}: ${item.description}`
        ) ?? [],
      thingsToAvoid: [
        "Git write operations",
        "Unapproved autonomous changes",
        "Credential or token sharing"
      ],
      knownArchitecturalConstraints: [
        ...(result.architectureConstraints ?? []),
        ...research.constraints
      ]
    },
    changes: {
      filesExpectedToChange: relevantFiles,
      filesReportedChanged: result.analysisEvidence?.gitReview.changedFiles ?? [],
      filesAdded: [],
      filesRemoved: [],
      majorImplementationChanges: completed.map((s) => s.title),
      knownUnfinishedAreas: pending.map((s) => s.title)
    },
    quality: {
      testsPlanned: result.relatedTests,
      testsAdded: [],
      testsReportedPassing: [],
      testsReportedFailing: [],
      testsPending: result.missingTests,
      staticAnalysisFindings:
        qa?.gaps.map((item) => `${item.type}: ${item.path} — ${item.reason}`) ?? [],
      securityFindings:
        security?.findings.map(
          (item) => `${item.severity}: ${item.path}:${item.line} ${item.title}`
        ) ?? [],
      performanceFindings:
        performance?.findings.map(
          (item) => `${item.severity}: ${item.path}:${item.line} ${item.title}`
        ) ?? [],
      accessibilityFindings: [],
      knownRegressions: [],
      qualityChecksStillRequired: pending.flatMap((s) =>
        s.acceptanceCriteria.filter((c) => !s.satisfiedCriteria.includes(c))
      )
    },
    correctionPackets: correctionPackets.length ? correctionPackets : undefined,
    decisions: {
      acceptedDecisions: stories.flatMap((s) => s.decisions),
      rejectedAlternatives: [],
      decisionReasons: [],
      assumptions: [],
      unresolvedQuestions: research.unknowns,
      risks: [...research.risks],
      reviewerComments: []
    },
    continuation: {
      exactNextRecommendedAction: current?.objective ?? "Review completion evidence",
      suggestedFirstPrompt: result.copilotPrompt,
      expectedFilesToInspect: relevantFiles,
      expectedTestsToRun: result.relatedTests,
      environmentRequirements: [],
      setupReminders: [],
      restoreWarnings: [],
      manualRepositorySyncReminder: "Synchronize the repository manually before restoring.",
      definitionOfCompletion: current?.acceptanceCriteria ?? acceptance
    }
  };
}
function handoffImplementationPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  if (/(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(normalized))
    return true;
  if (
    /(?:^|\/)(?:node_modules|dist|build|coverage|docs?|scripts?|\.github|vendor|generated)(?:\/|$)/.test(
      normalized
    )
  )
    return false;
  if (/^(?:package(?:-lock)?\.json|tsconfig|eslint|prettier|vite|webpack|rollup)/.test(normalized))
    return false;
  return true;
}
