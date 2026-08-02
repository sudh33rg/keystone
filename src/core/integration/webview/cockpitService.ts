import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { CaptainAgent } from "../../workflow/agents/captainAgent";
import {
  buildRepositoryIntelligence,
  IntelligencePipelineCancelledError,
  type IntelligenceWorkerPoolProgress,
  type RepositoryIntelligenceSnapshot
} from "../../intelligence/pipeline";
import { LanguageCapabilityRegistry } from "../../intelligence/languages/languageRegistry";
import type {
  ContextPack,
  ContextPacketPayload,
  ContextPacketSegmentKind,
  CorrectionPacket,
  CorrectionPacketReason,
  DeveloperIntent,
  KeystoneRunResult,
  RepoIntelligence
} from "../../domain/types";
import {
  enhanceIntent,
  type EnhancementMode,
  type EnhancementSession
} from "../../context/promptEnhancer";
import {
  runValidationCommand,
  type ValidationRunResult
} from "../../workflow/validation/validationRunner";
import { detectValidationCommands } from "../../workflow/validation/validationCommands";
import { planFailureRemediation } from "../../workflow/quality/failureRemediation";
import { generateTests } from "../../workflow/quality/generation";
import type {
  CockpitSettings,
  CopilotDelegationResult,
  IntelligenceActivityEvent,
  IntelligenceManifest,
  KeystoneTaskResult,
  KeystoneWebviewState,
  TaskIntelligenceSignal,
  WorkspaceSummary
} from "./messageRouter";
import { RepositoryModelBuilder } from "../../intelligence/repository/model-builder";
import { ModernizationPlatformApi } from "../../workflow/modernization/modernization-api";
import type {
  ModernizationDecisionInput,
  ModernizationPlan,
  ModernizationProposal
} from "../../workflow/modernization/model";
import {
  TaskWorkspaceManager,
  type TaskWorkspaceRef
} from "../../workflow/tasks/taskWorkspaceManager";
import type { TaskStatePackage } from "../../workflow/handoff/contracts";
import { OkfSnapshotStore, type OkfSnapshotSummaryProjection } from "../../intelligence/okf/store";
import { queryOkfSnapshot, type OkfQueryResult } from "../../intelligence/okf/queryEngine";
import type {
  KeystoneOkfSnapshot,
  OkfCanonicalEvidenceEnvelope
} from "../../intelligence/okf/types";
import {
  canonicalEvidenceEnvelope,
  selectCanonicalContext,
  type CanonicalContextSelection
} from "../../intelligence/okf/canonicalContext";
import { PORTABLE_OKF_VERSION } from "../../intelligence/okf/bundle";
import { GitReadOnly } from "../../platform/git/gitReadOnly";
import type { RepositoryInsightReport } from "../../intelligence/analysis/model";
import type { GapAnalysisResult } from "../../workflow/quality/qaGapAnalysis";
import type { SemanticEnrichmentProvider } from "../../intelligence/languages/semanticEnrichment";
import {
  discoverCopilotCustomizations,
  type CopilotCustomizationInventory
} from "../../context/copilotCustomizations";
import { CpgShardStore } from "../../intelligence/cpg";
import {
  buildCpgExplorerResult,
  buildOkfGraphView,
  exploreOkfSnapshot,
  type IntelligenceCpgResult,
  type IntelligenceExplorerResult,
  type IntelligenceGraphMode,
  type IntelligenceGraphResult
} from "../../intelligence/explorer";
import type { CpgEdgeKind } from "../../intelligence/cpg/types";
import type { OkfGraphProjection } from "../../intelligence/okf/projections";
import {
  createResearchDocument,
  type SDLCPlan,
  type SDLCPlanningContext,
  type SDLCResearchEvidence
} from "../../workflow/sdlc/engine";

const INTELLIGENCE_DIR = ".keystone/intelligence";
const SUMMARY_PATH = `${INTELLIGENCE_DIR}/summary.json`;
const MANIFEST_PATH = `${INTELLIGENCE_DIR}/manifest.json`;
const ACTIVITY_PATH = `${INTELLIGENCE_DIR}/activity.json`;
const SETTINGS_PATH = ".keystone/settings.json";
const CONTEXT_CACHE_DIR = ".keystone/context/cache";
const CONTEXT_PACKET_VERSION = 4;
const CONTEXT_EVALUATIONS_PATH = ".keystone/context/evaluations.json";
const ENHANCEMENT_SESSIONS_DIR = ".keystone/context/sessions";
const CONTEXT_FEEDBACK_PATH = ".keystone/context/feedback.json";
const QUERY_CACHE_DIR = ".keystone/cache/query";
const GRAPH_CACHE_DIR = ".keystone/cache/graph";

export class CockpitService {
  private cancelled = false;
  private abortController?: AbortController;
  private runGeneration = 0;
  private readonly modernization = new ModernizationPlatformApi();
  private readonly taskWorkspaces: TaskWorkspaceManager;
  private activeTaskWorkspace?: TaskWorkspaceRef;
  private activityWrite: Promise<void> = Promise.resolve();
  private okfSnapshotCache?: KeystoneOkfSnapshot;
  private okfSnapshotDigest?: string;
  private readonly queryCache = new Map<string, OkfQueryResult>();
  private readonly graphCache = new Map<string, IntelligenceGraphResult>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly runtime: {
      semanticEnricher?: SemanticEnrichmentProvider;
      maxWorkers?: number;
    } = {}
  ) {
    this.taskWorkspaces = new TaskWorkspaceManager(workspaceRoot);
  }

  private async readOkfSnapshot(): Promise<KeystoneOkfSnapshot | undefined> {
    const store = new OkfSnapshotStore(this.workspaceRoot);
    const manifest = await store.readManifest();
    if (!manifest) {
      this.invalidateOkfCaches();
      return undefined;
    }
    const digest = manifest.digests.snapshot ?? manifest.extractionRunId;
    if (this.okfSnapshotCache && this.okfSnapshotDigest === digest) return this.okfSnapshotCache;
    const snapshot = await store.read();
    if (!snapshot) {
      this.invalidateOkfCaches();
      return undefined;
    }
    if (this.okfSnapshotDigest !== digest) {
      this.queryCache.clear();
      this.graphCache.clear();
    }
    this.okfSnapshotDigest = digest;
    this.okfSnapshotCache = snapshot;
    return snapshot;
  }

  private invalidateOkfCaches(): void {
    this.okfSnapshotCache = undefined;
    this.okfSnapshotDigest = undefined;
    this.queryCache.clear();
    this.graphCache.clear();
  }

  private okfCacheKey(
    snapshot: KeystoneOkfSnapshot,
    kind: "query" | "graph",
    input: Record<string, unknown>
  ): string {
    const normalizedInput = {
      ...input,
      ...(typeof input.query === "string"
        ? { query: input.query.trim().replace(/\s+/g, " ").toLowerCase() }
        : {})
    };
    return createHash("sha256")
      .update(
        JSON.stringify({
          snapshot: snapshot.manifest.digests.snapshot ?? snapshot.manifest.extractionRunId,
          kind,
          input: normalizedInput
        })
      )
      .digest("hex");
  }

  private remember<T>(cache: Map<string, T>, key: string, value: T): void {
    if (!cache.has(key) && cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, value);
  }

  cancelIngestion(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async loadState(): Promise<KeystoneWebviewState> {
    this.activeTaskWorkspace = await this.taskWorkspaces.latestActive();
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(
      `${INTELLIGENCE_DIR}/snapshot.json`
    );
    const intelligence =
      snapshot?.intelligence ?? (await this.readJson<RepoIntelligence>(SUMMARY_PATH));
    const okf = await new OkfSnapshotStore(this.workspaceRoot).readSummaryProjection();
    const currentSnapshotDigest = okf
      ? (okf.manifest.digests.snapshot ?? okf.manifest.digests.okf ?? okf.manifest.extractionRunId)
      : undefined;
    const portableOkf = await this.readJson<PortableOkfBundleManifest>(
      `${INTELLIGENCE_DIR}/okf-bundle/.keystone-bundle.json`
    );
    const manifest = await this.readJson<IntelligenceManifest>(MANIFEST_PATH);
    const activity = (await this.readJson<IntelligenceActivityEvent[]>(ACTIVITY_PATH)) ?? [];
    const modernizationProposal = await this.readJson<ModernizationProposal>(
      ".keystone/modernization/proposal.json"
    );
    const modernizationPlan = await this.readJson<ModernizationPlan>(
      ".keystone/modernization/plan.json"
    );
    const backgroundEntries = await Promise.all(
      (["qa", "security", "performance", "modernization"] as const).map(
        async (name) => [name, await this.readJson(`.keystone/background/${name}.json`)] as const
      )
    );
    const backgroundAnalysis = Object.fromEntries(
      backgroundEntries.filter((entry) => entry[1] !== undefined)
    );
    const backgroundWorkers = Object.fromEntries(
      backgroundEntries
        .filter((entry) => entry[1] !== undefined)
        .map(([name, value]) => {
          const record = value as {
            status?: string;
            workerStatus?: string;
            error?: string;
            canonicalEvidence?: unknown;
            generatedAt?: string;
            workerId?: string;
            snapshotDigest?: string;
            extractionRunId?: string;
            scopePaths?: string[];
            startedAt?: string;
            completedAt?: string;
            durationMs?: number;
            reason?: string;
          };
          const storedStatus =
            record.workerStatus ?? (record.status === "failed" ? "failed" : "complete");
          const stale =
            storedStatus === "complete" &&
            Boolean(
              currentSnapshotDigest &&
              record.snapshotDigest &&
              record.snapshotDigest !== currentSnapshotDigest
            );
          const status = stale ? "stale" : storedStatus;
          const failed = status === "failed";
          const inactive = status !== "complete";
          return [
            name,
            {
              status,
              progress: inactive ? 0 : 100,
              message: stale
                ? `${name} worker result is stale; a newer promoted OKF snapshot is active.`
                : failed
                  ? (record.error ?? `${name} background worker failed.`)
                  : status === "cancelled"
                    ? (record.reason ?? `${name} background worker was cancelled.`)
                    : `${name} background worker result restored from disk.`,
              error: stale ? (record.reason ?? "Worker result is stale.") : record.error,
              result: stale ? undefined : value,
              canonicalEvidence: stale ? undefined : record.canonicalEvidence,
              workerId: record.workerId,
              snapshotDigest: record.snapshotDigest,
              extractionRunId: record.extractionRunId,
              scopePaths: record.scopePaths,
              startedAt: record.startedAt,
              completedAt: record.completedAt,
              durationMs: record.durationMs,
              updatedAt: record.generatedAt ?? new Date().toISOString()
            }
          ];
        })
    );
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const activeTask = this.activeTaskWorkspace
      ? await this.taskWorkspaces.snapshot(this.activeTaskWorkspace)
      : undefined;
    const latestCorrectionPacket = this.activeTaskWorkspace
      ? await this.taskWorkspaces.latestCorrectionPacket(this.activeTaskWorkspace)
      : undefined;
    const snapshotDigest = currentSnapshotDigest;
    const activeCorrectionPacket =
      latestCorrectionPacket && snapshotDigest === latestCorrectionPacket.snapshotDigest
        ? latestCorrectionPacket
        : undefined;
    if (modernizationProposal) this.modernization.restoreProposal(modernizationProposal);
    const degraded = snapshot?.status === "degraded";
    return {
      status: degraded ? "error" : intelligence ? "ready" : "idle",
      intelligence: intelligence
        ? toWorkspaceSummary(intelligence, snapshot, okf, portableOkf)
        : undefined,
      intelligenceManifest: manifest ?? emptyManifest(),
      intelligenceActivity: activity,
      ingestion: {
        active: false,
        progress: intelligence ? 100 : 0,
        stage: degraded ? "degraded" : intelligence ? "complete" : "not-started",
        message: intelligence
          ? degraded
            ? "Persisted repository intelligence loaded with warnings; inspect ingestion activity."
            : "Persisted repository intelligence loaded."
          : "No repository intelligence has been created yet.",
        persistedPath: SUMMARY_PATH
      },
      modernizationProposal,
      modernizationPlan,
      backgroundAnalysis,
      backgroundWorkers,
      settings,
      activeTask,
      correctionPacket: activeCorrectionPacket
    };
  }

  async index(
    onProgress: (
      message: string,
      progress: number,
      stage: string,
      workerPool?: IntelligenceWorkerPoolProgress
    ) => void,
    affectedPaths: readonly string[] = []
  ): Promise<KeystoneWebviewState> {
    const generation = ++this.runGeneration;
    // Clear cancelled flag BEFORE building controller so concurrent
    // cancelIngestion() calls cannot race us into an aborted state.
    this.cancelled = false;
    const controller = new AbortController();
    this.abortController = controller;
    controller.signal.addEventListener(
      "abort",
      () => {
        this.cancelled = true;
      },
      { once: true }
    );
    try {
      await fs.mkdir(path.join(this.workspaceRoot, INTELLIGENCE_DIR), { recursive: true });
    } catch (error) {
      const warning = `Could not prepare the intelligence directory; ingestion will continue in memory: ${error instanceof Error ? error.message : String(error)}.`;
      onProgress(warning, 4.8, "structural");
      await this.recordBestEffort("warning", warning, 4.8);
    }
    await this.recordBestEffort("indexing", "Repository ingestion started.", 5);
    onProgress(
      affectedPaths.length
        ? `Refreshing ${affectedPaths.length} changed/affected path(s) while reconciling the canonical snapshot...`
        : "Scanning repository files without LLM calls...",
      12,
      "scanning"
    );
    // Ensure no cancellation race: before the expensive work, re-check.
    if (this.cancelled) return this.cancelledState();
    let snapshot: RepositoryIntelligenceSnapshot;
    try {
      snapshot = await buildRepositoryIntelligence(this.workspaceRoot, {
        signal: controller.signal,
        cognitive: true,
        semanticEnricher: this.runtime.semanticEnricher,
        maxWorkers: this.runtime.maxWorkers,
        affectedPaths,
        onWarning: (warning) => {
          onProgress(`Warning: ${warning}`, 4.8, "structural");
          void this.recordBestEffort("warning", warning, 4.8);
        },
        onProgress: (event) => {
          if (generation === this.runGeneration)
            onProgress(event.message, event.progress, event.stage, event.workerPool);
        }
      });
    } catch (error) {
      if (error instanceof IntelligencePipelineCancelledError)
        return generation === this.runGeneration ? this.cancelledState() : this.loadState();
      const warning = `Repository ingestion encountered an unexpected error and continued with the previous state: ${error instanceof Error ? error.message : String(error)}.`;
      onProgress(`Warning: ${warning}`, 100, "degraded");
      await this.recordBestEffort("warning", warning, 100);
      if (generation !== this.runGeneration) return this.loadState();
      const previousState = await this.loadState();
      const previousManifest = previousState.intelligenceManifest ?? emptyManifest();
      const manifest: IntelligenceManifest = {
        ...previousManifest,
        status: "error",
        updatedAt: new Date().toISOString(),
        reason: warning,
        error: warning
      };
      return {
        ...previousState,
        status: "error",
        intelligenceManifest: manifest,
        intelligenceActivity: await this.activity(),
        ingestion: {
          active: false,
          progress: 100,
          stage: "degraded",
          message: warning,
          persistedPath: SUMMARY_PATH
        }
      };
    } finally {
      if (generation === this.runGeneration) this.abortController = undefined;
    }
    // After the expensive operation: check both guards.
    if (this.cancelled || generation !== this.runGeneration) return this.cancelledState();
    this.invalidateOkfCaches();
    const okf = await new OkfSnapshotStore(this.workspaceRoot).readSummaryProjection();
    const portableOkf = await this.readJson<PortableOkfBundleManifest>(
      `${INTELLIGENCE_DIR}/okf-bundle/.keystone-bundle.json`
    );
    const summary = toWorkspaceSummary(snapshot.intelligence, snapshot, okf, portableOkf);
    const completedStages = snapshot.stages.filter((stage) => stage.status === "complete").length;
    const readinessReason =
      snapshot.status === "ready"
        ? `All ${snapshot.stages.length} repository intelligence stages completed; intelligence health is ${snapshot.health.status} (${snapshot.health.score}/100).${snapshot.ingestion.warnings.length ? ` ${snapshot.ingestion.warnings.join(" ")}` : ""}`
        : `${snapshot.stages.length - completedStages} intelligence stage(s) failed; ${snapshot.ingestion.warnings.length} non-fatal warning(s) were recorded and processing continued.`;
    const manifest: IntelligenceManifest = {
      status: snapshot.status === "ready" ? "ready" : "error",
      indexedAt: snapshot.intelligence.indexedAt,
      updatedAt: new Date().toISOString(),
      summaryPath: SUMMARY_PATH,
      activityPath: ACTIVITY_PATH,
      fileCount: summary.fileCount,
      branch: summary.git.branch,
      reason: readinessReason,
      completedStages,
      totalStages: snapshot.stages.length
    };
    try {
      await this.writeJson(MANIFEST_PATH, manifest);
    } catch (error) {
      const warning = `Could not persist the intelligence manifest; the completed result remains available in memory: ${error instanceof Error ? error.message : String(error)}.`;
      onProgress(`Warning: ${warning}`, 100, "complete");
      await this.recordBestEffort("warning", warning, 100);
    }
    await this.recordBestEffort(
      snapshot.status === "ready" ? "complete" : "degraded",
      `Indexed ${summary.fileCount} files; ${completedStages}/${snapshot.stages.length} stages completed.`,
      100
    );
    onProgress(
      snapshot.status === "ready"
        ? "Repository intelligence is ready."
        : "Repository intelligence completed with warnings; inspect ingestion activity.",
      100,
      snapshot.status === "ready" ? "complete" : "degraded"
    );
    return {
      status: snapshot.status === "ready" ? "ready" : "error",
      intelligence: summary,
      intelligenceManifest: manifest,
      intelligenceActivity: await this.activity(),
      ingestion: {
        active: false,
        progress: 100,
        stage: snapshot.status === "ready" ? "complete" : "degraded",
        message:
          snapshot.status === "ready"
            ? "Repository intelligence is ready and persisted."
            : "Repository intelligence is degraded because one or more stages failed; inspect stage evidence.",
        persistedPath: SUMMARY_PATH
      }
    };
  }

  async analyze(
    text: string,
    editorContext: { currentFile?: string } = {}
  ): Promise<KeystoneTaskResult> {
    const intent: DeveloperIntent = {
      id: `task-${Date.now()}`,
      text,
      workspaceRoot: this.workspaceRoot,
      createdAt: new Date().toISOString()
    };
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(
      `${INTELLIGENCE_DIR}/snapshot.json`
    );
    const intelligence =
      snapshot?.intelligence ?? (await this.readJson<RepoIntelligence>(SUMMARY_PATH));
    if (!intelligence)
      throw new Error(
        "Repository intelligence is not ready. Wait for background indexing to finish."
      );
    const canonicalSnapshot = await this.readOkfSnapshot();
    if (!canonicalSnapshot)
      throw new Error(
        "The canonical OKF snapshot is not ready. Wait for intelligence promotion to finish."
      );
    const gitDiff = await this.gitDiff();
    const copilotCustomizations = await discoverCopilotCustomizations(this.workspaceRoot);
    const customizationFingerprint = createHash("sha256")
      .update(JSON.stringify(copilotCustomizations))
      .digest("hex");
    const feedback = (await this.readJson<ContextFeedback[]>(CONTEXT_FEEDBACK_PATH)) ?? [];
    const learnedFeedback = feedbackForIntent(text, feedback);
    const okfManifest = canonicalSnapshot.manifest;
    const canonicalSnapshotDigest =
      okfManifest?.digests.snapshot ??
      okfManifest?.extractionRunId ??
      snapshot?.ingestion.inputFingerprint ??
      intelligence.indexedAt;
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          contextPacketVersion: CONTEXT_PACKET_VERSION,
          text: text.trim(),
          currentFile: editorContext.currentFile,
          gitDiff: createHash("sha256").update(gitDiff).digest("hex"),
          feedback: learnedFeedback,
          fingerprint: canonicalSnapshotDigest,
          customizationFingerprint,
          settings: {
            compressionTier: settings?.compressionTier,
            codingStandards: settings?.codingStandards,
            thingsToAvoid: settings?.thingsToAvoid
          }
        })
      )
      .digest("hex");
    const cached = await this.readJson<{
      createdAt: string;
      result: KeystoneTaskResult;
      contextPacketPayloads?: NonNullable<ContextPack["contextPacketPayloads"]>;
      contextPackId?: string;
      contextSnapshotDigest?: string;
    }>(`${CONTEXT_CACHE_DIR}/${cacheKey}.json`);
    if (cached && Date.now() - Date.parse(cached.createdAt) < 24 * 60 * 60 * 1000) {
      const detected = await detectValidationCommands(this.workspaceRoot);
      const result = ensureTaskResearch(text, {
        ...cached.result,
        copilotCustomizations,
        validationCommands: detected.all,
        retrievalMetrics: cached.result.retrievalMetrics
          ? { ...cached.result.retrievalMetrics, cacheHit: true }
          : undefined
      });
      if (!cached.result.researchDocument || !cached.result.intentId)
        await this.writeJson(`${CONTEXT_CACHE_DIR}/${cacheKey}.json`, {
          createdAt: cached.createdAt,
          result,
          contextPacketPayloads: cached.contextPacketPayloads ?? [],
          contextPackId: cached.contextPackId,
          contextSnapshotDigest:
            cached.contextSnapshotDigest ?? result.contextManifest?.snapshotDigest
        });
      await this.record(
        "context-cache-hit",
        `Reused intent context ${cacheKey.slice(0, 12)} with ${result.contextTokens?.prompt ?? 0} prompt tokens and pre-plan R&D ${result.researchDocument.id}.`
      );
      await this.recordEvaluation(text, result);
      return this.materializeTaskWorkspace(text, result, {
        contextPacketPayloads: cached.contextPacketPayloads ?? [],
        contextPackId: cached.contextPackId,
        contextSnapshotDigest:
          cached.contextSnapshotDigest ?? result.contextManifest?.snapshotDigest
      });
    }
    const retrievalText: string | undefined = undefined;
    // Keep the authoritative OKF snapshot scoped only to context construction. On a real
    // repository it can be tens of MB on disk and substantially larger in memory. Releasing
    // it before QA/security/performance/modernization prevents extension-host memory spikes.
    const run = await (async () => {
      const okfSnapshot = canonicalSnapshot;
      return new CaptainAgent().run(intent, intelligence, {
        compressionTier: settings?.compressionTier ?? "standard",
        codingStandards: settings?.codingStandards,
        thingsToAvoid: settings?.thingsToAvoid,
        retrievalText,
        semanticEvidence: snapshot?.stages.find((stage) => stage.id === "code-property-graph")
          ?.items,
        currentFile: editorContext.currentFile,
        gitDiff,
        preferredPaths: learnedFeedback
          .filter((entry) => entry.score > 0)
          .map((entry) => entry.path),
        excludedPaths: learnedFeedback
          .filter((entry) => entry.score < 0)
          .map((entry) => entry.path),
        okfSnapshot
      });
    })();
    await this.record(
      "context-generated",
      `Intent context generated from ${run.contextPack.relevantFiles.length} ranked files: ${run.contextPack.estimatedRawTokens} raw → ${run.contextPack.estimatedPackedTokens} prompt tokens.`
    );
    const analysisEvidence = await this.loadTaskAnalysisEvidence(
      run.contextPack.relevantFiles.map((file) => file.path),
      gitDiff,
      snapshot ?? { findings: [], intelligence },
      run
    );
    const testGeneration = await generateTests({
      feature: text,
      sourceCode:
        run.contextPack.contextSections
          ?.map((section) => section.content)
          .filter(Boolean)
          .join("\n\n") ?? run.contextPack.relevantFiles.map((file) => file.path).join("\n"),
      apiContracts: run.contextPack.relatedApis.map(
        (api) => `${api.method} ${api.path} — ${api.filePath}:${api.line}`
      ),
      businessRules: run.contextPack.acceptanceCriteria
    });
    const detected = await detectValidationCommands(this.workspaceRoot);
    const result = ensureTaskResearch(text, {
      ...normalizeRunResult(run, settings, analysisEvidence, copilotCustomizations),
      validationCommands: detected.all,
      testGeneration
    });
    await this.writeJson(`${CONTEXT_CACHE_DIR}/${cacheKey}.json`, {
      createdAt: new Date().toISOString(),
      result,
      contextPacketPayloads: run.contextPack.contextPacketPayloads ?? [],
      contextPackId: run.contextPack.id,
      contextSnapshotDigest: run.contextPack.contextManifest?.snapshotDigest
    });
    await this.record(
      "intent-research-ready",
      `Pre-plan R&D ${result.researchDocument.id} is ready for review before SDLC planning.`
    );
    await this.recordEvaluation(text, result);
    return this.materializeTaskWorkspace(text, result, {
      contextPacketPayloads: run.contextPack.contextPacketPayloads ?? [],
      contextPackId: run.contextPack.id,
      contextSnapshotDigest: run.contextPack.contextManifest?.snapshotDigest
    });
  }

  private async loadTaskAnalysisEvidence(
    relevantFiles: readonly string[],
    gitDiff: string,
    repositorySnapshot: Pick<RepositoryIntelligenceSnapshot, "findings" | "intelligence">,
    run: KeystoneRunResult
  ): Promise<NonNullable<KeystoneTaskResult["analysisEvidence"]>> {
    const relevant = new Set(relevantFiles.map(normalizeWorkspacePath));
    const [qaCached, securityCached, performanceCached, modernizationCached] = await Promise.all([
      this.readJson<GapAnalysisResult>(".keystone/background/qa.json"),
      this.readJson<RepositoryInsightReport>(".keystone/background/security.json"),
      this.readJson<RepositoryInsightReport>(".keystone/background/performance.json"),
      this.readJson<ModernizationProposal>(".keystone/background/modernization.json")
    ]);
    const git = new GitReadOnly(this.workspaceRoot);
    const [branch, status] = await Promise.all([git.branch(), git.status()]);
    const changedFiles = [
      ...new Set(
        status
          .split(/\r?\n/)
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
          .map((value) => (value.includes(" -> ") ? value.split(" -> ").at(-1)! : value))
          .map(normalizeWorkspacePath)
      )
    ];
    const signalPaths = new Set([...relevant, ...changedFiles]);
    const okfStore = new OkfSnapshotStore(this.workspaceRoot);
    const graphProjection = await okfStore.readGraphProjection();
    const canonicalSnapshot = await this.readOkfSnapshot();
    if (!canonicalSnapshot)
      throw new Error(
        "The canonical OKF snapshot is not ready. Wait for intelligence promotion to finish."
      );
    const canonicalSelection = selectCanonicalContext(
      canonicalSnapshot,
      [...signalPaths].join(" "),
      {
        graphMode: "impact",
        graphLimit: 120,
        preferredPaths: [...signalPaths]
      }
    );
    const sharedCanonicalEvidence = canonicalEvidenceEnvelope(
      canonicalSnapshot,
      canonicalSelection
    );
    const persistedCanonicalEvidence = (
      value: unknown
    ): OkfCanonicalEvidenceEnvelope | undefined => {
      if (!value || typeof value !== "object") return undefined;
      const candidate = (value as { canonicalEvidence?: unknown }).canonicalEvidence;
      if (!candidate || typeof candidate !== "object") return undefined;
      const envelope = candidate as Partial<OkfCanonicalEvidenceEnvelope>;
      return envelope.snapshotDigest &&
        envelope.extractionRunId &&
        Array.isArray(envelope.unitIds) &&
        Array.isArray(envelope.relationshipIds) &&
        Array.isArray(envelope.evidenceIds) &&
        Array.isArray(envelope.paths) &&
        envelope.generatedAt
        ? (candidate as OkfCanonicalEvidenceEnvelope)
        : undefined;
    };
    const promotedDigest =
      canonicalSnapshot.manifest.digests.snapshot ?? canonicalSnapshot.manifest.extractionRunId;
    const promotedRun = canonicalSnapshot.manifest.extractionRunId;
    const isCurrentWorkerArtifact = (value: unknown): boolean => {
      const envelope = persistedCanonicalEvidence(value);
      return Boolean(
        envelope &&
        envelope.snapshotDigest === promotedDigest &&
        envelope.extractionRunId === promotedRun
      );
    };
    const qaIsCurrent = Boolean(qaCached && isCurrentWorkerArtifact(qaCached));
    const securityIsCurrent = Boolean(securityCached && isCurrentWorkerArtifact(securityCached));
    const performanceIsCurrent = Boolean(
      performanceCached && isCurrentWorkerArtifact(performanceCached)
    );
    const modernizationIsCurrent = Boolean(
      modernizationCached && isCurrentWorkerArtifact(modernizationCached)
    );
    const pendingWorkers = [
      !qaIsCurrent && "qa",
      !securityIsCurrent && "security",
      !performanceIsCurrent && "performance",
      !modernizationIsCurrent && "modernization"
    ].filter((value): value is string => Boolean(value));
    if (pendingWorkers.length)
      await this.record(
        "background-worker-evidence-pending",
        `Canonical task analysis supplied evidence while ${pendingWorkers.join(", ")} worker artifact(s) await the promoted snapshot ${promotedDigest.slice(0, 12)}….`
      );

    const relevantInsight = (report: RepositoryInsightReport) =>
      report.findings.filter(
        (finding) => relevant.size === 0 || relevant.has(normalizeWorkspacePath(finding.path))
      );
    const canonicalFindings = (
      category: "security" | "performance",
      fallbackRisk: string
    ): Array<{
      id: string;
      severity: string;
      title: string;
      path: string;
      line: number;
      explanation: string;
      remediation: string;
      confidence: number;
    }> => {
      const findings = repositorySnapshot.findings
        .filter(
          (finding) =>
            finding.category === category &&
            (!finding.filePath ||
              relevant.size === 0 ||
              relevant.has(normalizeWorkspacePath(finding.filePath)))
        )
        .map((finding) => ({
          id: finding.id,
          severity: String(finding.severity),
          title: finding.title,
          path: normalizeWorkspacePath(finding.filePath ?? "workspace"),
          line: 0,
          explanation: finding.description,
          remediation: finding.remediation,
          confidence: finding.confidence
        }));
      if (!findings.length && fallbackRisk !== "low")
        findings.push({
          id: `${category}-canonical-summary`,
          severity: fallbackRisk,
          title: `Canonical ${category} summary`,
          path: relevantFiles[0] ?? "workspace",
          line: 0,
          explanation: `${fallbackRisk} risk was reported by the canonical task agent.`,
          remediation: `Review the selected OKF ${category} evidence before delegation.`,
          confidence: 0.65
        });
      return findings;
    };
    const securityFindings = securityIsCurrent
      ? relevantInsight(securityCached!)
      : canonicalFindings("security", run.security.riskLevel);
    const performanceFindings = performanceIsCurrent
      ? relevantInsight(performanceCached!)
      : canonicalFindings("performance", run.performance.riskLevel);
    const rawQaGaps = qaIsCurrent
      ? qaCached!.gaps
      : run.qa.missingTestAreas.map((reason, index) => ({
          type: "no-coverage-data",
          filePath: relevantFiles[index] ?? relevantFiles[0] ?? "workspace",
          severity: 0.35,
          reason: `Canonical OKF task analysis: ${reason}`
        }));
    const qaGaps = rawQaGaps.filter(
      (gap) =>
        relevant.size === 0 ||
        relevant.has(
          normalizeWorkspacePath(
            path.isAbsolute(gap.filePath)
              ? path.relative(this.workspaceRoot, gap.filePath)
              : gap.filePath
          )
        )
    );
    const modernizationGaps = modernizationIsCurrent
      ? modernizationCached!.gaps
      : repositorySnapshot.findings
          .filter(
            (finding) =>
              finding.category === "modernization" &&
              (!finding.filePath || relevant.size === 0 || relevant.has(finding.filePath))
          )
          .map((finding) => ({
            id: finding.id,
            area: "code",
            title: finding.title,
            priority: finding.severity,
            evidence: [...finding.evidence]
          }))
          .concat(
            run.modernization.candidates.map((candidate, index) => ({
              id: `canonical-modernization-${index + 1}`,
              area: "code",
              title: candidate,
              priority: run.modernization.riskLevel,
              evidence: ["Canonical OKF task selection"]
            }))
          );
    const canonicalEvidence = Object.fromEntries(
      (
        [
          ["qa", qaIsCurrent ? persistedCanonicalEvidence(qaCached) : undefined],
          ["security", securityIsCurrent ? persistedCanonicalEvidence(securityCached) : undefined],
          [
            "performance",
            performanceIsCurrent ? persistedCanonicalEvidence(performanceCached) : undefined
          ],
          [
            "modernization",
            modernizationIsCurrent ? persistedCanonicalEvidence(modernizationCached) : undefined
          ]
        ] as const
      )
        .map(([name, evidence]) => [name, evidence ?? sharedCanonicalEvidence] as const)
        .filter(
          (
            entry
          ): entry is readonly [
            "qa" | "security" | "performance" | "modernization",
            OkfCanonicalEvidenceEnvelope
          ] => Boolean(entry[1])
        )
    );
    const securitySignals = mergeTaskIntelligenceSignals(
      taskIntelligenceSignals(graphProjection, signalPaths, "security"),
      canonicalTaskIntelligenceSignals(canonicalSelection, signalPaths, "security")
    );
    const performanceSignals = mergeTaskIntelligenceSignals(
      taskIntelligenceSignals(graphProjection, signalPaths, "performance"),
      canonicalTaskIntelligenceSignals(canonicalSelection, signalPaths, "performance")
    );
    const qaRecommendations = qaIsCurrent
      ? qaCached!.recommendations
          .filter(
            (item) =>
              !item.affectedFiles?.length ||
              item.affectedFiles.some((file) =>
                relevant.has(
                  normalizeWorkspacePath(
                    path.isAbsolute(file) ? path.relative(this.workspaceRoot, file) : file
                  )
                )
              )
          )
          .map((item) => `${item.priority}: ${item.title} — ${item.description}`)
      : [
          ...run.qa.recommendedTests,
          "Background QA worker evidence is pending; this task result remains bounded to the promoted OKF selection."
        ];
    const diffHash = createHash("sha256").update(gitDiff).digest("hex");
    const diffArtifactPath = ".keystone/reviews/latest-read-only.diff";
    await this.writeText(diffArtifactPath, gitDiff);
    return {
      canonicalEvidence,
      qa: {
        scanMode: qaIsCurrent ? qaCached!.scanMode : "canonical-okf",
        gaps: qaGaps.map((gap) => ({
          type: gap.type,
          path: normalizeWorkspacePath(
            path.isAbsolute(gap.filePath)
              ? path.relative(this.workspaceRoot, gap.filePath)
              : gap.filePath
          ),
          severity: gap.severity,
          reason: gap.reason
        })),
        recommendations: qaRecommendations
      },
      security: {
        riskLevel: riskLevelForFindings(
          securityFindings,
          securityIsCurrent ? securityCached!.riskLevel : run.security.riskLevel
        ),
        findings: securityFindings.map((item) => ({
          id: item.id,
          severity: item.severity,
          title: item.title,
          path: normalizeWorkspacePath(item.path),
          line: item.line,
          explanation: item.explanation,
          remediation: item.remediation,
          confidence: item.confidence
        })),
        intelligenceSignals: securitySignals
      },
      performance: {
        riskLevel: riskLevelForFindings(
          performanceFindings,
          performanceIsCurrent ? performanceCached!.riskLevel : run.performance.riskLevel
        ),
        findings: performanceFindings.map((item) => ({
          id: item.id,
          severity: item.severity,
          title: item.title,
          path: normalizeWorkspacePath(item.path),
          line: item.line,
          explanation: item.explanation,
          remediation: item.remediation,
          confidence: item.confidence
        })),
        intelligenceSignals: performanceSignals
      },
      modernization: {
        proposalId: modernizationIsCurrent ? modernizationCached!.id : undefined,
        coveragePercent: modernizationIsCurrent
          ? modernizationCached!.scanCoverage.coveragePercent
          : 0,
        gaps: modernizationGaps.map((gap) => ({
          id: gap.id,
          area: gap.area,
          title: gap.title,
          priority: gap.priority,
          evidence: [...gap.evidence]
        }))
      },
      gitReview: {
        readOnly: true,
        branch: branch || undefined,
        changedFiles,
        diffHash,
        diffArtifactPath,
        diffBytes: Buffer.byteLength(gitDiff, "utf8")
      }
    };
  }

  async saveSettings(settings: CockpitSettings): Promise<void> {
    await fs.mkdir(path.join(this.workspaceRoot, ".keystone"), { recursive: true });
    await this.writeJson(SETTINGS_PATH, validateSettings(settings));
    await this.record("settings", "Cockpit policy settings saved.");
  }

  async enhanceUserIntent(
    text: string,
    mode: EnhancementMode,
    sessionId?: string,
    currentFile?: string
  ): Promise<EnhancementSession> {
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(
      `${INTELLIGENCE_DIR}/snapshot.json`
    );
    const intelligence =
      snapshot?.intelligence ?? (await this.readJson<RepoIntelligence>(SUMMARY_PATH));
    if (!intelligence)
      throw new Error(
        "Repository intelligence is not ready. Wait for background indexing to finish."
      );
    const settings = await this.readJson<CockpitSettings>(SETTINGS_PATH);
    const previous = sessionId
      ? await this.readJson<EnhancementSession>(
          `${ENHANCEMENT_SESSIONS_DIR}/${safeId(sessionId)}.json`
        )
      : undefined;
    const okfSnapshot = await this.readOkfSnapshot();
    if (!okfSnapshot)
      throw new Error(
        "The canonical OKF snapshot is not ready. Wait for intelligence promotion to finish."
      );
    const session = await enhanceIntent({
      text,
      mode,
      intelligence,
      currentFile,
      previous,
      okfSnapshot
    });
    await this.writeJson(`${ENHANCEMENT_SESSIONS_DIR}/${session.id}.json`, session);
    await this.record(
      "intent-enhanced",
      `${mode} enhancement ${session.status}; confidence=${Math.round(session.confidence * 100)}%; evidence=${session.evidence.length}.`
    );
    return session;
  }

  async enhancementSessions(): Promise<EnhancementSession[]> {
    try {
      const sessions = await Promise.all(
        (await fs.readdir(path.join(this.workspaceRoot, ENHANCEMENT_SESSIONS_DIR)))
          .filter((file) => file.endsWith(".json"))
          .map((file) => this.readJson<EnhancementSession>(`${ENHANCEMENT_SESSIONS_DIR}/${file}`))
      );
      return sessions
        .filter((session): session is EnhancementSession => Boolean(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 30);
    } catch {
      return [];
    }
  }

  async deleteEnhancementSession(sessionId: string): Promise<void> {
    try {
      await fs.unlink(
        path.join(this.workspaceRoot, ENHANCEMENT_SESSIONS_DIR, `${safeId(sessionId)}.json`)
      );
    } catch {
      /* Already absent. */
    }
  }

  async retrieveContextOriginal(
    relativePath: string,
    expectedHash?: string
  ): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    changed: boolean;
    currentHash: string;
  }> {
    const target = path.resolve(this.workspaceRoot, relativePath);
    if (!target.startsWith(`${path.resolve(this.workspaceRoot)}${path.sep}`))
      throw new Error("Context path is outside the workspace.");
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(this.workspaceRoot),
      fs.realpath(target)
    ]);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`))
      throw new Error("Context path resolves outside the workspace.");
    const content = await fs.readFile(realTarget, "utf8");
    const limit = 200_000;
    const currentHash = createHash("sha256").update(content).digest("hex");
    return {
      path: relativePath,
      content: content.slice(0, limit),
      truncated: content.length > limit,
      changed: Boolean(expectedHash && expectedHash !== currentHash),
      currentHash
    };
  }

  async loadContextPacket(
    packetId: string,
    segmentKinds?: readonly ContextPacketSegmentKind[]
  ): Promise<{
    taskId: string;
    packetId: string;
    stale: boolean;
    snapshotDigest?: string;
    currentSnapshotDigest?: string;
    segmentKinds?: ContextPacketSegmentKind[];
    packet?: ContextPacketPayload;
  }> {
    const active = await this.ensureActiveTask();
    const envelope = await this.taskWorkspaces.contextPacketEnvelope(active);
    if (!envelope) throw new Error("The active task has no persisted context packet envelope.");
    const packet = envelope.packets.find((item) => item.id === packetId);
    if (!packet) throw new Error(`Context packet ${packetId} is not available in the active task.`);
    const manifest = await new OkfSnapshotStore(this.workspaceRoot).readManifest();
    const currentSnapshotDigest = manifest
      ? (manifest.digests.snapshot ?? manifest.extractionRunId)
      : undefined;
    const stale = Boolean(
      envelope.snapshotDigest &&
      currentSnapshotDigest &&
      envelope.snapshotDigest !== currentSnapshotDigest
    );
    if (stale) {
      await this.record(
        "context-packet-stale",
        `Rejected ${packetId}; task snapshot ${envelope.snapshotDigest?.slice(0, 12)} differs from current OKF ${currentSnapshotDigest?.slice(0, 12)}.`
      );
      return {
        taskId: active.id,
        packetId,
        stale: true,
        snapshotDigest: envelope.snapshotDigest,
        currentSnapshotDigest
      };
    }
    const requested = segmentKinds?.length ? new Set(segmentKinds) : undefined;
    const segments = requested
      ? packet.segments.filter((segment) => requested.has(segment.kind))
      : packet.segments;
    if (!segments.length)
      throw new Error(`Context packet ${packetId} has no segments matching the requested mode.`);
    const selectedKinds = [...new Set(segments.map((segment) => segment.kind))];
    const selectedPaths = [
      ...new Set(segments.flatMap((segment) => (segment.path ? [segment.path] : [])))
    ];
    const selectedPacket: ContextPacketPayload = {
      ...packet,
      segmentKinds: selectedKinds,
      paths: selectedPaths,
      estimatedTokens: segments.reduce((sum, segment) => sum + segment.estimatedTokens, 0),
      segments,
      content: segments.map((segment) => segment.content).join("\n\n")
    };
    await this.record(
      "context-packet-loaded",
      `Loaded ${packetId} (${selectedKinds.join(", ")}) from the current OKF snapshot.`
    );
    return {
      taskId: active.id,
      packetId,
      stale: false,
      snapshotDigest: envelope.snapshotDigest,
      currentSnapshotDigest,
      segmentKinds: selectedKinds,
      packet: selectedPacket
    };
  }

  async recordContextFeedback(
    intent: string,
    pathValue: string | undefined,
    rating: ContextFeedback["rating"]
  ): Promise<void> {
    const feedback = (await this.readJson<ContextFeedback[]>(CONTEXT_FEEDBACK_PATH)) ?? [];
    const intentTerms = [
      ...new Set(
        intent
          .toLowerCase()
          .match(/[a-z0-9_]+/g)
          ?.filter((term) => term.length > 2) ?? []
      )
    ].slice(0, 20);
    feedback.unshift({
      id: createHash("sha256")
        .update(`${Date.now()}|${intent}|${pathValue ?? ""}|${rating}`)
        .digest("hex")
        .slice(0, 16),
      timestamp: new Date().toISOString(),
      intentTerms,
      path: pathValue,
      rating
    });
    await this.writeJson(CONTEXT_FEEDBACK_PATH, feedback.slice(0, 500));
    await this.record("context-feedback", `${rating}${pathValue ? `: ${pathValue}` : ""}.`);
  }

  async clearContextCache(): Promise<number> {
    const directory = path.join(this.workspaceRoot, CONTEXT_CACHE_DIR);
    let removed = 0;
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          await fs.unlink(path.join(directory, entry.name));
          removed += 1;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.record("context-cache-cleared", `Removed ${removed} cached context pack(s).`);
    return removed;
  }

  async queryIntelligence(query: string): Promise<{
    query: string;
    intent: string;
    answer: string;
    confidence: number;
    traversedRelationships: number;
    warnings: string[];
    plan: {
      terms: readonly string[];
      seedIds: readonly string[];
      seedLabels: readonly string[];
      relationshipKinds: readonly string[];
      maxDepth: number;
      strategy: string;
    };
    traversals: readonly {
      sourceId: string;
      targetId: string;
      relationship: string;
      sourceLabel: string;
      targetLabel: string;
    }[];
    items: Array<{
      id: string;
      label: string;
      kind: string;
      path?: string;
      line?: number;
      summary: string;
      reason: string;
      score: number;
      confidence: number;
      evidenceIds: string[];
      relationshipPath: string[];
    }>;
  }> {
    const snapshot = await this.readOkfSnapshot();
    if (!snapshot)
      throw new Error("Authoritative OKF intelligence is not ready. Index the repository first.");
    const cacheKey = this.okfCacheKey(snapshot, "query", { query, limit: 50 });
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      await this.recordBestEffort(
        "intelligence-query-cache-hit",
        `Reused cached OKF query for ${query.trim() || "empty query"}.`
      );
      return {
        ...cached,
        items: cached.items.map((item) => ({
          ...item,
          evidenceIds: [...item.evidenceIds],
          relationshipPath: [...item.relationshipPath]
        })),
        warnings: [...cached.warnings]
      };
    }
    const persisted = await this.readJson<OkfQueryResult>(`${QUERY_CACHE_DIR}/${cacheKey}.json`);
    if (persisted) {
      this.remember(this.queryCache, cacheKey, persisted);
      await this.recordBestEffort(
        "intelligence-query-persistent-cache-hit",
        `Reused persisted OKF query for ${query.trim() || "empty query"}.`
      );
      return cloneQueryResult(persisted);
    }
    const result = queryOkfSnapshot(snapshot, query, 50);
    this.remember(this.queryCache, cacheKey, result);
    await this.writeCacheBestEffort(`${QUERY_CACHE_DIR}/${cacheKey}.json`, result);
    await this.recordBestEffort(
      "intelligence-query",
      `${result.intent} query returned ${result.items.length} evidence-backed result(s) after ${result.traversedRelationships} relationship traversal(s).`
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        evidenceIds: [...item.evidenceIds],
        relationshipPath: [...item.relationshipPath]
      })),
      warnings: [...result.warnings]
    };
  }

  async exploreIntelligence(
    query = "",
    kind = "all",
    cursor?: string
  ): Promise<IntelligenceExplorerResult> {
    const snapshot = await this.readOkfSnapshot();
    if (!snapshot)
      throw new Error("Authoritative OKF intelligence is not ready. Index the repository first.");
    const result = exploreOkfSnapshot(snapshot, { query, kind, cursor, limit: 120 });
    await this.recordBestEffort(
      "intelligence-explorer",
      `Explorer returned page ${result.items.length} ${kind === "all" ? "knowledge" : kind} item(s)${query ? ` for ${query}` : ""}.`
    );
    return result;
  }

  async graphIntelligence(
    mode: IntelligenceGraphMode,
    query = "",
    seedIds: readonly string[] = []
  ): Promise<IntelligenceGraphResult> {
    const snapshot = await this.readOkfSnapshot();
    if (!snapshot)
      throw new Error("Authoritative OKF intelligence is not ready. Index the repository first.");
    const cacheKey = this.okfCacheKey(snapshot, "graph", { mode, query, seedIds });
    const cached = this.graphCache.get(cacheKey);
    if (cached) {
      await this.recordBestEffort(
        "intelligence-graph-cache-hit",
        `Reused cached ${mode} graph neighborhood.`
      );
      return cached;
    }
    const persisted = await this.readJson<IntelligenceGraphResult>(
      `${GRAPH_CACHE_DIR}/${cacheKey}.json`
    );
    if (persisted) {
      this.remember(this.graphCache, cacheKey, persisted);
      await this.recordBestEffort(
        "intelligence-graph-persistent-cache-hit",
        `Reused persisted ${mode} graph neighborhood.`
      );
      return persisted;
    }
    const result = buildOkfGraphView(snapshot, {
      mode,
      query,
      seedIds,
      depth: mode === "impact" ? 3 : mode === "flows" ? 2 : 2,
      limit: mode === "repository" ? 90 : mode === "flows" ? 70 : 120
    });
    this.remember(this.graphCache, cacheKey, result);
    await this.writeCacheBestEffort(`${GRAPH_CACHE_DIR}/${cacheKey}.json`, result);
    await this.recordBestEffort(
      "intelligence-graph",
      `${mode} graph returned ${result.nodes.length} node(s) and ${result.edges.length} edge(s).`
    );
    return result;
  }

  async cpgIntelligence(
    sourcePath?: string,
    edgeKind: CpgEdgeKind | "all" = "all",
    focusNodeId?: string
  ): Promise<IntelligenceCpgResult> {
    const store = new CpgShardStore(this.workspaceRoot);
    const manifest = await store.manifest();
    const files = Object.values(manifest?.files ?? {})
      .map((entry) => ({
        sourcePath: entry.sourcePath,
        nodeCount: entry.nodeCount,
        edgeCount: entry.edgeCount,
        capabilities: entry.capabilities
      }))
      .sort(
        (a, b) => cpgFileScore(b) - cpgFileScore(a) || a.sourcePath.localeCompare(b.sourcePath)
      );
    const selected = sourcePath && manifest?.files[sourcePath] ? sourcePath : files[0]?.sourcePath;
    const graph = selected ? await store.get(selected) : undefined;
    const result = buildCpgExplorerResult(graph, files, { edgeKind, focusNodeId, limit: 220 });
    await this.recordBestEffort(
      "intelligence-cpg",
      selected
        ? `CPG explorer opened ${selected}: ${result.nodes.length} visible node(s), ${result.edges.length} visible edge(s).`
        : "CPG explorer found no persisted shards."
    );
    return result;
  }
  private async gitDiff(): Promise<string> {
    return new GitReadOnly(this.workspaceRoot).diff();
  }

  private async latestCopilotResult(
    taskId: string
  ): Promise<(CopilotDelegationResult & { taskWorkspaceId?: string }) | undefined> {
    const directory = path.join(this.workspaceRoot, ".keystone/copilot/results");
    try {
      const files = (await fs.readdir(directory))
        .filter((file) => file.endsWith(".json"))
        .sort()
        .reverse();
      for (const file of files) {
        const result = await this.readJson<CopilotDelegationResult & { taskWorkspaceId?: string }>(
          `.keystone/copilot/results/${file}`
        );
        if (result?.taskWorkspaceId === taskId) return result;
      }
    } catch {
      /* No captured Copilot result exists yet. */
    }
    return undefined;
  }

  private async recordEvaluation(intent: string, result: KeystoneTaskResult): Promise<void> {
    const history =
      (await this.readJson<Array<Record<string, unknown>>>(CONTEXT_EVALUATIONS_PATH)) ?? [];
    history.unshift({
      timestamp: new Date().toISOString(),
      intentHash: createHash("sha256").update(intent).digest("hex").slice(0, 16),
      tokens: result.contextTokens,
      retrieval: result.retrievalMetrics
    });
    await this.writeJson(CONTEXT_EVALUATIONS_PATH, history.slice(0, 200));
  }

  async approveDelegation(
    mode: string,
    prompt: string,
    correctionPacketId?: string
  ): Promise<void> {
    const active = await this.ensureActiveTask();
    const expected = await this.taskWorkspaces.delegationPrompt(active);
    const matchesTaskPrompt = normalizePrompt(prompt) === normalizePrompt(expected);
    if (!matchesTaskPrompt && correctionPacketId) {
      const packet = await this.taskWorkspaces.latestCorrectionPacket(active);
      if (
        packet?.id !== correctionPacketId ||
        normalizePrompt(prompt) !== normalizePrompt(packet.prompt)
      )
        throw new Error(
          "The approved correction prompt does not match the active OKF correction packet. Regenerate it before delegating."
        );
    } else if (!matchesTaskPrompt) {
      throw new Error(
        "The approved prompt does not match the generated task delegation packet. Regenerate the context before delegating."
      );
    }
    await this.record(
      "delegation-approved",
      `${mode} approved${correctionPacketId ? ` for correction packet ${correctionPacketId}` : ""} with ${Math.ceil(prompt.length / 4)} estimated tokens.`
    );
    this.activeTaskWorkspace = await this.taskWorkspaces.update(active, "approved", {
      percent: 30,
      current: `Delegated through ${mode}`,
      completed: [
        "Repository intelligence gathered",
        "Specification reviewed",
        "Delegation approved"
      ]
    });
  }

  async recordDelegationResult(result: CopilotDelegationResult): Promise<string> {
    const active = await this.ensureActiveTask();
    const id = createHash("sha256")
      .update(
        `${result.startedAt}|${result.mode}|${result.model?.id ?? "external"}|${result.storyId ?? active.id}`
      )
      .digest("hex")
      .slice(0, 20);
    const relative = `.keystone/copilot/results/${result.startedAt.replace(/[:.]/g, "-")}-${id}.json`;
    await this.writeJson(relative, { ...result, taskWorkspaceId: active.id });
    const completed = [
      "Repository intelligence gathered",
      "Specification reviewed",
      "Delegation approved"
    ];
    if (result.captured && result.success) completed.push("Copilot response captured by Keystone");
    this.activeTaskWorkspace = await this.taskWorkspaces.update(
      active,
      result.success ? "in-progress" : "blocked",
      {
        percent: result.captured && result.success ? 55 : result.success ? 40 : 30,
        current:
          result.captured && result.success
            ? "Copilot result captured; review changes and validate"
            : result.success
              ? "Copilot opened externally; capture evidence before validation"
              : "Copilot delegation failed",
        completed,
        blockers: result.success ? [] : [result.error ?? "Copilot delegation failed"]
      }
    );
    await this.record(
      result.success ? "delegation-result" : "delegation-failed",
      result.captured && result.success
        ? `Captured Copilot response using ${result.model?.name ?? result.model?.id ?? "language model"}; artifact=${relative}.`
        : result.success
          ? `${result.mode} opened externally; response was not captured.`
          : `${result.mode} failed: ${result.error ?? "unknown error"}.`
    );
    return relative;
  }

  async createCorrectionPacket(
    request: {
      reason?: CorrectionPacketReason;
      commands?: readonly string[];
      failures?: readonly string[];
      remediations?: readonly string[];
      changedPaths?: readonly string[];
    } = {}
  ): Promise<CorrectionPacket> {
    const active = await this.ensureActiveTask();
    const task = await this.taskWorkspaces.snapshot(active);
    const latestValidation = await this.readJson<{ results?: ValidationRunResult[] }>(
      ".keystone/validation/latest.json"
    );
    const validationResults = latestValidation?.results ?? [];
    const commands = [
      ...(request.commands ?? validationResults.map((result) => result.command))
    ].filter(Boolean);
    const failures = [
      ...(request.failures ??
        validationResults
          .filter((result) => result.status === "failed")
          .flatMap((result) =>
            result.summary.errors?.length
              ? result.summary.errors.map((error) => `${result.command}: ${error}`)
              : [`${result.command}: ${result.stderr || "Validation failed."}`]
          ))
    ].filter(Boolean);
    const remediations = [
      ...(request.remediations ??
        validationResults.flatMap((result) =>
          (result.remediation ?? []).flatMap((proposal) => [
            proposal.summary,
            ...proposal.recommendedActions,
            proposal.copilotPrompt
          ])
        ))
    ].filter(Boolean);
    const snapshot = await this.readOkfSnapshot();
    if (!snapshot)
      throw new Error("Cannot create a correction packet without a current OKF snapshot.");
    const git = new GitReadOnly(this.workspaceRoot);
    const [gitStatus, gitDiff] = await Promise.all([
      git.status().catch(() => ""),
      git.diff().catch(() => "")
    ]);
    const changedPaths = uniqueStrings([
      ...(request.changedPaths ?? []).map(normalizeWorkspacePath),
      ...gitStatus
        .split(/\r?\n/)
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
        .map((value) => (value.includes(" -> ") ? value.split(" -> ").at(-1)! : value))
        .map(normalizeWorkspacePath)
    ]);
    const diffHash = createHash("sha256").update(gitDiff).digest("hex");
    const envelope = await this.taskWorkspaces.contextPacketEnvelope(active);
    const originalPaths = envelope?.packets.flatMap((packet) => packet.paths) ?? [];
    const intent = String(
      task.task.intent ?? task.task.normalizedProblemStatement ?? "Active Keystone task"
    );
    const selection = selectCanonicalContext(snapshot, `${intent}\n${failures.join("\n")}`, {
      graphMode: "impact",
      graphLimit: 120,
      preferredPaths: [...changedPaths, ...originalPaths]
    });
    const affectedPaths = uniqueStrings([...changedPaths, ...selection.paths]);
    const selectedPaths = uniqueStrings([
      ...changedPaths,
      ...selection.paths,
      ...originalPaths
    ]).slice(0, 8);
    const sourceExcerpts = (
      await Promise.all(
        selectedPaths.map(async (sourcePath) => {
          try {
            const source = await this.retrieveContextOriginal(sourcePath);
            return `## ${sourcePath}\n${truncate(source.content, 3_000)}`;
          } catch {
            return undefined;
          }
        })
      )
    ).filter((value): value is string => Boolean(value));
    const latestCopilot = await this.latestCopilotResult(active.id);
    const snapshotDigest =
      snapshot.manifest.digests.snapshot ??
      snapshot.manifest.digests.okf ??
      snapshot.manifest.extractionRunId;
    const canonicalEvidence = [
      `OKF snapshot: ${snapshotDigest}`,
      `Query intent: ${selection.query.intent}; confidence ${selection.query.confidence.toFixed(2)}.`,
      ...selection.query.items
        .slice(0, 16)
        .map(
          (item) =>
            `- ${item.kind} ${item.label}${item.path ? ` — ${item.path}` : ""}: ${item.reason}`
        ),
      ...selection.query.traversals
        .slice(0, 24)
        .map(
          (traversal) =>
            `- ${traversal.sourceLabel} -[${traversal.relationship}]-> ${traversal.targetLabel}`
        )
    ];
    const packet: CorrectionPacket = {
      id: createHash("sha256")
        .update(
          `${active.id}|${snapshotDigest}|${request.reason ?? "manual"}|${commands.join("\n")}|${failures.join("\n")}|${Date.now()}`
        )
        .digest("hex")
        .slice(0, 24),
      taskId: active.id,
      reason: request.reason ?? (failures.length ? "validation-failure" : "manual"),
      createdAt: new Date().toISOString(),
      snapshotDigest,
      validation: {
        commands: uniqueStrings(commands),
        failures: uniqueStrings(failures).slice(0, 40),
        remediations: uniqueStrings(remediations).slice(0, 40)
      },
      copilot: {
        captured: Boolean(latestCopilot?.captured),
        mode: latestCopilot?.mode,
        artifactPath: latestCopilot?.artifactPath,
        responseExcerpt: latestCopilot?.text ? truncate(latestCopilot.text, 4_000) : undefined
      },
      canonical: {
        unitIds: [...selection.unitIds],
        relationshipIds: [...selection.relationshipIds],
        evidenceIds: [...selection.evidenceIds],
        paths: [...selection.paths]
      },
      changedPaths,
      affectedPaths,
      diffHash,
      selectedPaths,
      prompt: [
        "You are GitHub Copilot performing a user-approved Keystone correction pass.",
        "Keystone has reselected the current repository evidence from the promoted OKF snapshot.",
        "Do not search, crawl, enumerate, or retrieve the entire repository. Use only the selected evidence below and report a missing-evidence gap instead of widening scope.",
        `\n# Intent\n${intent}`,
        `\n# Validation failures\n${failures.map((failure) => `- ${failure}`).join("\n") || "- No structured failure text was captured; inspect the listed commands."}`,
        `\n# Validation commands\n${commands.map((command) => `- ${command}`).join("\n") || "- None recorded."}`,
        `\n# Changed-file evidence\n${changedPaths.map((value) => `- ${value}`).join("\n") || "- No Git working-tree changes were detected."}`,
        `\n# OKF affected paths\n${
          affectedPaths
            .slice(0, 120)
            .map((value) => `- ${value}`)
            .join("\n") || "- No affected path was selected."
        }`,
        `Diff SHA-256: ${diffHash}`,
        `\n# Remediation guidance\n${remediations.map((item) => `- ${item}`).join("\n") || "- Classify the failure before changing product or test behavior."}`,
        `\n# Previous Copilot result\n${latestCopilot?.text ? truncate(latestCopilot.text, 4_000) : "No captured Copilot response is available; use the validation evidence as the source of truth."}`,
        `\n# Canonical OKF evidence\n${canonicalEvidence.join("\n")}`,
        `\n# Current selected source excerpts\n${sourceExcerpts.join("\n\n") || "No selected source body could be read; report the evidence gap."}`,
        "\nExecution boundary: propose the smallest correction, preserve the stated intent and tests, return changed files plus validation results, and do not perform Git write or remote merge operations."
      ].join("\n")
    };
    await this.taskWorkspaces.appendCorrectionPacket(active, packet);
    if (packet.validation.failures.length) {
      this.activeTaskWorkspace = await this.taskWorkspaces.update(active, "blocked", {
        percent: 78,
        current: "Correction packet ready; awaiting user-approved Copilot retry",
        blockers: ["Validation failure requires correction packet review"]
      });
    }
    await this.record(
      "correction-packet-generated",
      `${packet.id} generated from ${packet.validation.failures.length} validation failure(s), ${packet.canonical.unitIds.length} OKF unit(s), and ${packet.canonical.relationshipIds.length} relationship(s).`
    );
    return packet;
  }

  async recordDecision(category: "task" | "risk", action: string, subject: string): Promise<void> {
    if (category === "task" && action === "approved") {
      const active = await this.ensureActiveTask();
      this.activeTaskWorkspace = await this.taskWorkspaces.update(active, "approved", {
        percent: 20,
        current: "Task approved; awaiting delegation"
      });
    }
    if (category === "task" && action === "rejected") {
      const active = await this.ensureActiveTask();
      await this.taskWorkspaces.cancel(active, `Rejected by user: ${subject}`);
      this.activeTaskWorkspace = undefined;
    }
    await this.record(
      `${category}-${action}`,
      `${category === "task" ? "Task" : "Risk"} ${action}: ${subject}`
    );
  }

  async runValidation(scope: "impacted" | "all"): Promise<ValidationRunResult[]> {
    const active = await this.ensureActiveTask();
    this.activeTaskWorkspace = await this.taskWorkspaces.update(active, "validating", {
      percent: 75,
      current: `Running ${scope} validation`
    });
    const detected = await detectValidationCommands(this.workspaceRoot);
    const commands = scope === "impacted" ? detected.impacted : detected.all;
    if (!commands.length) {
      this.activeTaskWorkspace = await this.taskWorkspaces.update(active, "blocked", {
        percent: 75,
        current: "Validation unavailable",
        blockers: ["No supported validation scripts were found in package.json."]
      });
      return [
        {
          command: "validation",
          status: "failed",
          exitCode: undefined,
          stdout: "",
          stderr: "No supported validation scripts were found in package.json.",
          durationMs: 0,
          summary: { errors: ["No supported validation scripts were found."] }
        }
      ];
    }
    const results: ValidationRunResult[] = [];
    for (const command of commands) {
      const result = await runValidationCommand(command, this.workspaceRoot, 120_000);
      if (result.status === "failed") {
        const messages = result.summary.errors?.length
          ? result.summary.errors
          : [result.stderr || `${command} failed.`];
        result.remediation = messages.slice(0, 20).map((failureMessage, index) =>
          planFailureRemediation({
            testPath: `${command}#failure-${index + 1}`,
            failureMessage,
            failureStackTrace: result.stderr
          })
        );
      }
      results.push(result);
    }
    await this.writeJson(".keystone/validation/latest.json", {
      scope,
      completedAt: new Date().toISOString(),
      results
    });
    await this.record(
      "validation",
      `${scope} validation finished: ${results.filter((result) => result.status === "passed").length}/${results.length} passed.`
    );
    if (results.every((result) => result.status === "passed")) {
      await this.taskWorkspaces.resolveCorrectionPackets(
        active,
        results.map((result) => result.command)
      );
    }
    this.activeTaskWorkspace = await this.taskWorkspaces.update(
      this.activeTaskWorkspace!,
      results.every((result) => result.status === "passed") ? "in-progress" : "blocked",
      {
        percent: results.every((result) => result.status === "passed") ? 90 : 75,
        current: results.every((result) => result.status === "passed")
          ? "Validation passed; awaiting completion"
          : "Validation failed",
        blockers: results
          .filter((result) => result.status !== "passed")
          .map((result) => result.command)
      }
    );
    return results;
  }

  async completeActiveTask(): Promise<void> {
    const active = await this.ensureActiveTask();
    if (
      active.status === "planned" ||
      active.status === "blocked" ||
      active.status === "validating"
    )
      throw new Error(
        `Task cannot be completed while its status is ${active.status}. Approve it and resolve validation blockers first.`
      );
    await this.taskWorkspaces.complete(active);
    await this.record(
      "task-completed",
      `${active.name} marked done and removed after completion archive was recorded.`
    );
    this.activeTaskWorkspace = undefined;
  }

  async attachActiveSdlcPlan(plan: SDLCPlan): Promise<void> {
    const active = await this.ensureActiveTask();
    this.activeTaskWorkspace = await this.taskWorkspaces.attachSdlcPlan(active, plan);
    await this.record(
      "sdlc-plan-materialized",
      `${this.activeTaskWorkspace.relativePath} now contains the approved-research-derived specification and SDLC plan.`
    );
  }

  async approveIntentResearch(intentId: string): Promise<void> {
    const active = await this.ensureActiveTask();
    await this.taskWorkspaces.approveResearch(active, intentId);
    await this.record(
      "intent-research-approved",
      `R&D for ${intentId} was explicitly reviewed and approved; SDLC planning is now unlocked.`
    );
  }

  async exportActiveTaskForHandoff(targetRoot = this.workspaceRoot): Promise<string> {
    return this.taskWorkspaces.exportForHandoff(await this.ensureActiveTask(), targetRoot);
  }

  async correctionPacketsForActiveTask(): Promise<CorrectionPacket[]> {
    return this.taskWorkspaces.correctionPackets(await this.ensureActiveTask());
  }

  async discardTaskWorkspace(ref: TaskWorkspaceRef): Promise<void> {
    await this.taskWorkspaces.cancel(ref, "Analysis cancelled or superseded");
    if (this.activeTaskWorkspace?.id === ref.id) this.activeTaskWorkspace = undefined;
    await this.record(
      "task-analysis-discarded",
      `${ref.name} removed because its analysis result was cancelled or superseded.`
    );
  }

  async importTaskHandoff(packageValue: Record<string, unknown>): Promise<string> {
    const handoff = await this.taskWorkspaces.importHandoffPackage(packageValue);
    this.activeTaskWorkspace = await this.taskWorkspaces.createFromHandoff(
      packageValue as unknown as TaskStatePackage
    );
    await this.record(
      "task-handoff-materialized",
      `${this.activeTaskWorkspace.relativePath} created from verified handoff state.`
    );
    return handoff;
  }

  private async materializeTaskWorkspace(
    intent: string,
    result: KeystoneTaskResult,
    packetContext: {
      contextPacketPayloads: NonNullable<ContextPack["contextPacketPayloads"]>;
      contextPackId?: string;
      contextSnapshotDigest?: string;
    } = { contextPacketPayloads: [] }
  ): Promise<KeystoneTaskResult> {
    const taskFiles = result.relevantFiles.filter((file) => planningPathUseful(file));
    const taskSymbols = result.relevantSymbols.filter((symbol) => {
      const match = symbol.match(/—\s*([^:]+):\d+$/);
      return !match || planningPathUseful(match[1].trim());
    });
    const taskWorkspace = await this.taskWorkspaces.create({
      intent,
      intentType: result.intentType,
      route: result.route,
      relevantFiles: taskFiles,
      relevantSymbols: taskSymbols,
      tests: result.relatedTests,
      qaChecks: result.qaChecklist,
      securityRisk: result.securityRisk,
      performanceRisk: result.performanceRisk,
      modernizationNotes: result.modernizationNotes,
      contextPackets: result.contextPackets,
      contextPacketPayloads: packetContext.contextPacketPayloads,
      contextPackId: packetContext.contextPackId,
      contextSnapshotDigest: packetContext.contextSnapshotDigest,
      copilotPrompt: result.copilotPrompt,
      research: {
        intentId: result.intentId,
        title: result.researchDocument.title,
        markdown: result.researchDocument.markdown,
        status: result.researchStatus
      }
    });
    this.activeTaskWorkspace = taskWorkspace;
    await this.record(
      "task-workspace-created",
      `${taskWorkspace.relativePath} created for the accepted intent.`
    );
    return { ...result, taskWorkspace };
  }

  async analyzeModernization(): Promise<ModernizationProposal> {
    const snapshot = await this.readJson<RepositoryIntelligenceSnapshot>(
      `${INTELLIGENCE_DIR}/snapshot.json`
    );
    if (!snapshot?.intelligence)
      throw new Error(
        "Repository intelligence is not ready. Wait for background indexing to finish."
      );
    const canonicalSnapshot = await this.readOkfSnapshot();
    if (!canonicalSnapshot)
      throw new Error(
        "The canonical OKF snapshot is not ready. Wait for intelligence promotion to finish."
      );
    const builder = new RepositoryModelBuilder();
    const repository = builder.buildFromIntelligence(this.workspaceRoot, snapshot.intelligence);
    const selection = selectCanonicalContext(
      canonicalSnapshot,
      "modernization architecture dependency database testing operations",
      { graphMode: "impact", graphLimit: 120 }
    );
    const proposal = await this.modernization.propose({
      repository,
      objectives: [
        "Preserve existing business behavior while modernizing the accepted technology stack"
      ],
      scanScope: {
        expectedFiles: snapshot.intelligence.files.length,
        indexedFiles: repository.files.length,
        excludedPaths: builder.getExcludedPaths()
      }
    });
    const canonicalProposal = {
      ...proposal,
      canonicalEvidence: canonicalEvidenceEnvelope(canonicalSnapshot, selection)
    };
    await this.writeJson(".keystone/modernization/proposal.json", canonicalProposal);
    await this.record(
      "modernization-proposed",
      `${canonicalProposal.scanCoverage.analyzedFiles} files assessed from the promoted OKF snapshot; ${canonicalProposal.gaps.length} gaps and ${canonicalProposal.technologyRecommendations.length} technology recommendations produced.`
    );
    return canonicalProposal;
  }

  async restoreModernizationProposal(proposal: ModernizationProposal): Promise<void> {
    this.modernization.restoreProposal(proposal);
    await this.writeJson(".keystone/modernization/proposal.json", proposal);
  }

  async acceptModernization(
    proposalId: string,
    decision: ModernizationDecisionInput
  ): Promise<ModernizationPlan> {
    const persisted = await this.readJson<ModernizationProposal>(
      ".keystone/modernization/proposal.json"
    );
    if (persisted?.id === proposalId) this.modernization.restoreProposal(persisted);
    const existing = await this.readJson<ModernizationPlan>(".keystone/modernization/plan.json");
    if (
      existing?.decision?.proposalId === proposalId &&
      sameModernizationDecision(existing, decision) &&
      existing.taskWorkspace
    ) {
      const restoredRef = {
        ...existing.taskWorkspace,
        absolutePath: path.join(this.workspaceRoot, existing.taskWorkspace.relativePath)
      };
      if (
        await fs
          .access(restoredRef.absolutePath)
          .then(() => true)
          .catch(() => false)
      ) {
        this.activeTaskWorkspace = restoredRef;
        return { ...existing, taskWorkspace: restoredRef };
      }
    }
    const plan = await this.modernization.planAccepted(proposalId, decision);
    const taskWorkspace = await this.taskWorkspaces.createModernization(plan);
    if (existing?.taskWorkspace) {
      const superseded = {
        ...existing.taskWorkspace,
        absolutePath: path.join(this.workspaceRoot, existing.taskWorkspace.relativePath)
      };
      if (
        await fs
          .access(superseded.absolutePath)
          .then(() => true)
          .catch(() => false)
      )
        await this.taskWorkspaces.cancel(
          superseded,
          "Superseded by a revised modernization decision"
        );
    }
    this.activeTaskWorkspace = taskWorkspace;
    const materializedPlan: ModernizationPlan = { ...plan, taskWorkspace };
    await this.writeJson(".keystone/modernization/plan.json", materializedPlan);
    await this.record(
      "modernization-planned",
      `${plan.phases.length} accepted modernization phases and ${plan.specifications.length} specifications generated in ${taskWorkspace.relativePath}.`
    );
    return materializedPlan;
  }

  private async cancelledState(): Promise<KeystoneWebviewState> {
    await this.record("cancelled", "Repository ingestion cancelled by the user.", 0);
    return {
      status: "idle",
      intelligenceManifest: { ...emptyManifest(), reason: "Cancelled by user." },
      intelligenceActivity: await this.activity(),
      ingestion: {
        active: false,
        progress: 0,
        stage: "cancelled",
        message: "Repository ingestion was cancelled.",
        persistedPath: SUMMARY_PATH
      }
    };
  }

  private async activity(): Promise<IntelligenceActivityEvent[]> {
    return (await this.readJson<IntelligenceActivityEvent[]>(ACTIVITY_PATH)) ?? [];
  }
  private async ensureActiveTask(): Promise<TaskWorkspaceRef> {
    if (!this.activeTaskWorkspace)
      this.activeTaskWorkspace = await this.taskWorkspaces.latestActive();
    if (!this.activeTaskWorkspace) throw new Error("No active Keystone task workspace");
    return this.activeTaskWorkspace;
  }
  private async recordBestEffort(type: string, message: string, progress?: number): Promise<void> {
    try {
      await this.record(type, message, progress);
    } catch {
      /* Observability must never break a read-only product action. */
    }
  }
  private async record(type: string, message: string, progress?: number): Promise<void> {
    const write = this.activityWrite.then(async () => {
      const events = await this.activity();
      events.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        type,
        message,
        progress
      });
      await this.writeJson(ACTIVITY_PATH, events.slice(0, 100));
    });
    this.activityWrite = write.catch(() => undefined);
    return write;
  }
  private async readJson<T>(relative: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.workspaceRoot, relative), "utf8")) as T;
    } catch {
      return undefined;
    }
  }
  private async writeJson(relative: string, value: unknown): Promise<void> {
    const target = path.join(this.workspaceRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  }
  private async writeCacheBestEffort(relative: string, value: unknown): Promise<void> {
    try {
      await this.writeJson(relative, value);
    } catch (error) {
      await this.recordBestEffort(
        "cache-warning",
        `Persistent cache write failed for ${relative}: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
  }
  private async writeText(relative: string, value: string): Promise<void> {
    const target = path.join(this.workspaceRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, value, "utf8");
    await fs.rename(temporary, target);
  }
}

function cpgFileScore(file: {
  sourcePath: string;
  nodeCount: number;
  edgeCount: number;
  capabilities: { dfg: boolean; cfg: boolean; cdg: boolean; eog: boolean; typeResolution: boolean };
}): number {
  const pathValue = file.sourcePath.toLowerCase();
  const sourceBonus = /^(src|app|lib|packages?)\//.test(pathValue) ? 120 : 0;
  const codeBonus = /\.(?:[cm]?[jt]sx?|py|go|java|rs|rb|php|cs|kt|scala|swift)$/.test(pathValue)
    ? 100
    : 0;
  const testPenalty = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\./.test(pathValue)
    ? 180
    : 0;
  const configPenalty =
    /(?:^|\/)(?:\.github|docs?|config|scripts?)(?:\/|$)|(?:package|tsconfig|eslint|vite|webpack|rollup|prettier)/.test(
      pathValue
    )
      ? 110
      : 0;
  const semantic =
    (file.capabilities.dfg ? 30 : 0) +
    (file.capabilities.cfg ? 25 : 0) +
    (file.capabilities.cdg ? 20 : 0) +
    (file.capabilities.eog ? 15 : 0) +
    (file.capabilities.typeResolution ? 20 : 0);
  return (
    sourceBonus +
    codeBonus +
    semantic +
    Math.min(80, file.edgeCount / 3) +
    Math.min(50, file.nodeCount / 8) -
    testPenalty -
    configPenalty
  );
}

function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
function sameModernizationDecision(
  plan: ModernizationPlan,
  input: ModernizationDecisionInput
): boolean {
  if (!input.accepted || !plan.decision) return false;
  const targetId =
    input.customTarget?.id ?? input.selectedTargetId ?? plan.decision.targetArchitecture.id;
  if (plan.decision.targetArchitecture.id !== targetId) return false;
  return Object.entries(input.acceptedTechnologies ?? {}).every(
    ([category, technology]) => plan.decision?.technologies[category] === technology
  );
}

function emptyManifest(): IntelligenceManifest {
  return {
    status: "empty",
    updatedAt: new Date().toISOString(),
    summaryPath: SUMMARY_PATH,
    activityPath: ACTIVITY_PATH,
    fileCount: 0
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`;
}

type ContextFeedback = {
  id: string;
  timestamp: string;
  intentTerms: string[];
  path?: string;
  rating: "useful" | "irrelevant" | "helpful" | "unhelpful";
};

function feedbackForIntent(
  intent: string,
  feedback: readonly ContextFeedback[]
): Array<{ path: string; score: number }> {
  const terms = new Set(
    intent
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?.filter((term) => term.length > 2) ?? []
  );
  const scores = new Map<string, number>();
  for (const entry of feedback) {
    if (!entry.path || !entry.intentTerms.length) continue;
    const overlap =
      entry.intentTerms.filter((term) => terms.has(term)).length / entry.intentTerms.length;
    if (overlap < 0.3) continue;
    const delta = entry.rating === "useful" ? 1 : entry.rating === "irrelevant" ? -1 : 0;
    scores.set(entry.path, (scores.get(entry.path) ?? 0) + delta);
  }
  return [...scores.entries()]
    .map(([pathValue, score]) => ({ path: pathValue, score }))
    .filter((entry) => entry.score !== 0)
    .sort(
      (left, right) =>
        Math.abs(right.score) - Math.abs(left.score) || left.path.localeCompare(right.path)
    );
}

function validateSettings(settings: CockpitSettings): CockpitSettings {
  const clamp = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return {
    ...settings,
    compressionTier: settings.compressionTier ?? "standard",
    thresholds: {
      security: clamp(settings.thresholds.security),
      performance: clamp(settings.thresholds.performance),
      modernization: clamp(settings.thresholds.modernization)
    }
  };
}

function uniqueEvidence(
  context: ContextPack
): Array<{ kind: string; label: string; path?: string; okfId?: string; confidence?: number }> {
  const output: Array<{
    kind: string;
    label: string;
    path?: string;
    okfId?: string;
    confidence?: number;
  }> = [];
  const seen = new Set<string>();
  const add = (item: {
    kind: string;
    label: string;
    path?: string;
    okfId?: string;
    confidence?: number;
  }): void => {
    const key = item.okfId ?? `${item.kind}:${item.path ?? ""}:${item.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(item);
    }
  };
  for (const file of context.relevantFiles)
    add({
      kind: "file",
      label: file.summary || file.path,
      path: file.path,
      confidence: file.evidence?.confidence
    });
  for (const symbol of context.relevantSymbols)
    add({
      kind: "symbol",
      label: symbol.name,
      path: symbol.filePath,
      confidence: symbol.evidence?.confidence
    });
  for (const section of context.contextSections ?? [])
    for (const evidence of section.evidence ?? []) add({ ...evidence, path: section.path });
  return output.slice(0, 120);
}

interface PortableOkfBundleManifest {
  format: string;
  version: string;
  generatedBy: string;
  extractionRunId: string;
  sourceProfile: string;
  sourceProfileVersion: string;
  concepts: number;
  digest: string;
}

function toWorkspaceSummary(
  value: RepoIntelligence,
  snapshot?: RepositoryIntelligenceSnapshot,
  okf?: OkfSnapshotSummaryProjection,
  portable?: PortableOkfBundleManifest
): WorkspaceSummary {
  const gitStage = snapshot?.stages.find((stage) => stage.id === "git-change");
  return {
    fileCount: value.files.length,
    files: value.files,
    projectTypes: value.frameworkHints,
    architecture:
      value.services.length > 1
        ? "service-oriented"
        : value.frameworkHints.includes("react")
          ? "component-based"
          : "modular",
    git: {
      branch: String(gitStage?.metrics.branch ?? "workspace"),
      changedFiles: gitStage?.items ?? []
    },
    stages: snapshot?.stages,
    families: snapshot?.families,
    languageCapabilities: value.languageSupport?.length
      ? value.languageSupport.map((item) => ({
          id: item.id,
          label: item.label,
          level:
            item.semanticProvider === "none"
              ? item.baseline
              : `${item.baseline} + ${item.semanticProvider}`,
          extensions:
            new LanguageCapabilityRegistry().all().find((definition) => definition.id === item.id)
              ?.extensions ?? [],
          files: item.files,
          baseline: item.baseline,
          semanticProvider: item.semanticProvider,
          semanticFiles: item.semanticFiles,
          deterministicFiles: item.deterministicFiles,
          failedSemanticFiles: item.failedSemanticFiles,
          capabilities: item.capabilities,
          warnings: item.warnings
        }))
      : new LanguageCapabilityRegistry().summary(),
    universalTextFiles: value.files.filter((file) => file.language === "unknown").length,
    okf: okf
      ? {
          profile: okf.manifest.profile,
          version: okf.manifest.profileVersion,
          extractionRunId: okf.manifest.extractionRunId,
          units: okf.manifest.counts.units,
          relationships: okf.manifest.counts.relationships,
          observations: okf.manifest.counts.observations,
          evidence: okf.manifest.counts.evidence,
          active: okf.manifest.counts.active,
          deleted: okf.manifest.counts.deleted,
          graphNodes: okf.manifest.counts.units,
          graphEdges: okf.manifest.counts.relationships,
          cpgBindings: okf.cpgBindings,
          validated: okf.manifest.validation.valid,
          portableBundle: portable
            ? {
                path: `${INTELLIGENCE_DIR}/okf-bundle`,
                conceptFiles: portable.concepts,
                validated:
                  portable.format === "OKF" &&
                  portable.version === PORTABLE_OKF_VERSION &&
                  portable.extractionRunId === okf.manifest.extractionRunId,
                profile: `${portable.format} ${portable.version}`,
                generatedAt: okf.manifest.generatedAt
              }
            : undefined,
          evidenceSamples: okf.evidenceSamples.map((item) => ({
            id: item.id,
            path: item.source.workspaceRelativePath,
            method: item.method,
            observedAt: item.observedAt
          }))
        }
      : undefined
  };
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function cloneQueryResult(result: OkfQueryResult) {
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      evidenceIds: [...item.evidenceIds],
      relationshipPath: [...item.relationshipPath]
    })),
    warnings: [...result.warnings]
  };
}
function taskIntelligenceSignals(
  projection: OkfGraphProjection | undefined,
  relevantPaths: ReadonlySet<string>,
  category: "security" | "performance"
): TaskIntelligenceSignal[] {
  if (!projection) return [];
  const activeNodes = projection.nodes.filter((node) => node.lifecycle === "active");
  const byId = new Map(activeNodes.map((node) => [node.id, node]));
  const activeEdges = projection.edges.filter(
    (edge) => edge.lifecycle === "active" && byId.has(edge.sourceId) && byId.has(edge.targetId)
  );
  const nodePath = (node: (typeof activeNodes)[number] | undefined): string | undefined => {
    const value = node?.properties.path ?? node?.properties.filePath;
    return typeof value === "string" ? normalizeWorkspacePath(value) : undefined;
  };
  const focus = new Set(
    activeNodes
      .filter((node) => {
        const value = nodePath(node);
        return value ? relevantPaths.has(value) : false;
      })
      .map((node) => node.id)
  );
  for (let depth = 0; depth < 2; depth += 1) {
    for (const edge of activeEdges) {
      if (
        !["contains", "defines", "calls", "flows-to", "reads", "writes", "exposes"].includes(
          edge.kind
        )
      )
        continue;
      if (focus.has(edge.sourceId)) focus.add(edge.targetId);
      if (focus.has(edge.targetId)) focus.add(edge.sourceId);
    }
  }
  const signals: TaskIntelligenceSignal[] = [];
  const seen = new Set<string>();
  const add = (signal: TaskIntelligenceSignal): void => {
    const key = `${signal.kind}|${signal.okfId ?? ""}|${signal.relationship ?? ""}|${signal.relatedLabel ?? ""}`;
    if (seen.has(key) || signals.length >= 30) return;
    seen.add(key);
    signals.push(signal);
  };
  for (const node of activeNodes) {
    if (
      node.kind !== "risk-area" ||
      String(node.properties.category ?? "").toLowerCase() !== category
    )
      continue;
    const pathValue = nodePath(node);
    const connected = activeEdges.some(
      (edge) => edge.kind === "may-impact" && edge.sourceId === node.id && focus.has(edge.targetId)
    );
    if (
      (relevantPaths.size && !connected && !(pathValue && relevantPaths.has(pathValue))) ||
      (!relevantPaths.size && signals.length >= 8)
    )
      continue;
    add({
      kind: "risk-area",
      label: node.label,
      path: pathValue,
      line: typeof node.properties.line === "number" ? node.properties.line : undefined,
      okfId: node.okfId,
      summary: `${category} risk-area from authoritative OKF${pathValue ? ` at ${pathValue}` : ""}.`
    });
  }
  for (const edge of activeEdges) {
    if (!["calls", "flows-to", "reads", "writes"].includes(edge.kind)) continue;
    if (!focus.has(edge.sourceId) && !focus.has(edge.targetId)) continue;
    const source = byId.get(edge.sourceId),
      target = byId.get(edge.targetId);
    if (!source || !target) continue;
    const pathValue = nodePath(source) ?? nodePath(target);
    const kind: TaskIntelligenceSignal["kind"] =
      edge.kind === "calls"
        ? "call"
        : edge.kind === "reads" || edge.kind === "writes"
          ? "data-access"
          : "flow";
    add({
      kind,
      label: `${source.label} —[${edge.kind}]→ ${target.label}`,
      path: pathValue,
      line:
        typeof source.properties.line === "number"
          ? source.properties.line
          : typeof target.properties.line === "number"
            ? target.properties.line
            : undefined,
      okfId: edge.okfId,
      relationship: edge.kind,
      relatedLabel: target.label,
      summary: `${category} review context from authoritative OKF relationship ${edge.kind}: ${source.label} → ${target.label}.`
    });
  }
  return signals;
}

function canonicalTaskIntelligenceSignals(
  selection: CanonicalContextSelection | undefined,
  relevantPaths: ReadonlySet<string>,
  category: "security" | "performance"
): TaskIntelligenceSignal[] {
  if (!selection) return [];
  const nodes = new Map(selection.graph.nodes.map((node) => [node.id, node]));
  const nodePath = (id: string): string | undefined => {
    const value = nodes.get(id)?.path;
    return value ? normalizeWorkspacePath(value) : undefined;
  };
  const focus = new Set(
    selection.graph.nodes
      .filter((node) => {
        const value = node.path ? normalizeWorkspacePath(node.path) : undefined;
        return value ? relevantPaths.has(value) : false;
      })
      .map((node) => node.id)
  );
  const signals: TaskIntelligenceSignal[] = [];
  const seen = new Set<string>();
  const add = (signal: TaskIntelligenceSignal): void => {
    const key = `${signal.kind}|${signal.okfId ?? ""}|${signal.relationship ?? ""}|${signal.relatedLabel ?? ""}`;
    if (seen.has(key) || signals.length >= 30) return;
    seen.add(key);
    signals.push(signal);
  };
  for (const node of selection.graph.nodes) {
    if (
      node.kind !== "risk-area" ||
      String(node.properties.category ?? "").toLowerCase() !== category
    )
      continue;
    const pathValue = node.path ? normalizeWorkspacePath(node.path) : undefined;
    const connected = selection.graph.edges.some(
      (edge) => edge.kind === "may-impact" && edge.sourceId === node.id && focus.has(edge.targetId)
    );
    if (
      (relevantPaths.size && !connected && !(pathValue && relevantPaths.has(pathValue))) ||
      (!relevantPaths.size && signals.length >= 8)
    )
      continue;
    add({
      kind: "risk-area",
      label: node.label,
      path: pathValue,
      line: node.line,
      okfId: node.id,
      summary: `${category} risk-area from the canonical OKF task selection.`
    });
  }
  for (const edge of selection.graph.edges) {
    if (!(["calls", "flows-to", "reads", "writes"] as string[]).includes(edge.kind)) continue;
    if (!focus.has(edge.sourceId) && !focus.has(edge.targetId)) continue;
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!source || !target) continue;
    const pathValue = nodePath(edge.sourceId) ?? nodePath(edge.targetId);
    const kind: TaskIntelligenceSignal["kind"] =
      edge.kind === "calls"
        ? "call"
        : edge.kind === "reads" || edge.kind === "writes"
          ? "data-access"
          : "flow";
    add({
      kind,
      label: `${source.label} —[${edge.kind}]→ ${target.label}`,
      path: pathValue,
      line: source.line ?? target.line,
      okfId: edge.id,
      relationship: edge.kind,
      relatedLabel: target.label,
      summary: `${category} task context from canonical OKF relationship ${edge.kind}.`
    });
  }
  return signals;
}

function mergeTaskIntelligenceSignals(
  ...groups: readonly TaskIntelligenceSignal[][]
): TaskIntelligenceSignal[] {
  const output: TaskIntelligenceSignal[] = [];
  const seen = new Set<string>();
  for (const group of groups)
    for (const signal of group) {
      const key = `${signal.kind}|${signal.okfId ?? ""}|${signal.relationship ?? ""}|${signal.relatedLabel ?? ""}`;
      if (seen.has(key) || output.length >= 30) continue;
      seen.add(key);
      output.push(signal);
    }
  return output;
}

function riskLevelForFindings(findings: readonly { severity: string }[], fallback: string): string {
  if (!findings.length) return fallback;
  const weight = (value: string): number =>
    value === "critical" ? 4 : value === "high" ? 3 : value === "medium" ? 2 : 1;
  return findings.reduce(
    (best, item) => (weight(item.severity) > weight(best) ? item.severity : best),
    "low"
  );
}
function maxTaskRisk(left: string, right?: string): "low" | "medium" | "high" {
  const normalize = (value?: string): "low" | "medium" | "high" =>
    value === "critical" || value === "high" ? "high" : value === "medium" ? "medium" : "low";
  const weight = (value: "low" | "medium" | "high"): number =>
    value === "high" ? 3 : value === "medium" ? 2 : 1;
  const a = normalize(left),
    b = normalize(right);
  return weight(a) >= weight(b) ? a : b;
}
function mergeTaskEvidence(
  base: KeystoneTaskResult["evidence"] = [],
  analysis?: NonNullable<KeystoneTaskResult["analysisEvidence"]>
): NonNullable<KeystoneTaskResult["evidence"]> {
  if (!analysis) return base;
  const extra: NonNullable<KeystoneTaskResult["evidence"]> = [];
  for (const [worker, envelope] of Object.entries(analysis.canonicalEvidence ?? {}))
    extra.push({
      kind: "architecture",
      label: `${worker} background analysis · OKF snapshot ${envelope.snapshotDigest.slice(0, 12)}…`,
      confidence: 1,
      summary: `${envelope.unitIds.length} OKF unit(s), ${envelope.relationshipIds.length} relationship(s), and ${envelope.evidenceIds.length} evidence link(s).`
    });
  for (const item of analysis.qa.gaps)
    extra.push({
      kind: "test",
      label: `${item.type}: ${item.reason}`,
      path: item.path,
      confidence: Math.max(0, Math.min(1, item.severity)),
      summary: "Repository QA gap analysis"
    });
  for (const item of analysis.security.findings)
    extra.push({
      kind: "risk",
      label: `Security: ${item.title} @ ${item.path}:${item.line}`,
      path: item.path,
      confidence: item.confidence,
      summary: item.explanation
    });
  for (const item of analysis.security.intelligenceSignals)
    extra.push({
      kind: item.kind === "risk-area" ? "risk" : "flow",
      label: `Security intelligence: ${item.label}`,
      path: item.path,
      okfId: item.okfId,
      confidence: 0.85,
      summary: item.summary
    });
  for (const item of analysis.performance.findings)
    extra.push({
      kind: "risk",
      label: `Performance: ${item.title} @ ${item.path}:${item.line}`,
      path: item.path,
      confidence: item.confidence,
      summary: item.explanation
    });
  for (const item of analysis.performance.intelligenceSignals)
    extra.push({
      kind: item.kind === "risk-area" ? "risk" : "flow",
      label: `Performance intelligence: ${item.label}`,
      path: item.path,
      okfId: item.okfId,
      confidence: 0.85,
      summary: item.summary
    });
  for (const item of analysis.modernization.gaps.filter(
    (gap) => gap.priority === "high" || gap.priority === "critical"
  ))
    extra.push({
      kind: "architecture",
      label: `Modernization: ${item.title}`,
      confidence: 0.8,
      summary: item.evidence.join(" · ")
    });
  if (analysis.gitReview.changedFiles.length || analysis.gitReview.diffBytes)
    extra.push({
      kind: "flow",
      label: `Read-only Git diff: ${analysis.gitReview.changedFiles.length} changed file(s)`,
      confidence: 1,
      summary: `SHA-256 ${analysis.gitReview.diffHash}; ${analysis.gitReview.diffBytes} bytes; ${analysis.gitReview.diffArtifactPath ?? "not persisted"}`
    });
  const seen = new Set<string>();
  return [...base, ...extra].filter((item) => {
    const key = `${item.kind}|${item.path ?? ""}|${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function appendReadOnlyReview(
  markdown: string,
  analysis?: NonNullable<KeystoneTaskResult["analysisEvidence"]>
): string {
  if (!analysis) return markdown;
  const git = analysis.gitReview;
  return `${markdown}\n\n## Read-only Git review evidence\n\n- Branch: ${git.branch ?? "unknown"}\n- Changed files: ${git.changedFiles.length ? git.changedFiles.join(", ") : "none in working tree"}\n- Diff bytes: ${git.diffBytes}\n- Diff SHA-256: ${git.diffHash}\n- Local evidence artifact: ${git.diffArtifactPath ?? "none"}\n- Policy: Keystone only read Git status/diff metadata; it did not stage, commit, push, create, approve, or merge a remote change.\n`;
}

function isLikelyTestPath(value: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(value);
}
function planningPathUseful(value: string): boolean {
  const pathValue = normalizeWorkspacePath(value).toLowerCase();
  if (isLikelyTestPath(pathValue)) return true;
  if (/^(?:src|app|lib|packages?|services?|components?|server|client)\//.test(pathValue))
    return true;
  return (
    /\.(?:[cm]?[jt]sx?|py|go|java|rs|rb|php|cs|kt|scala|swift)$/.test(pathValue) &&
    !/(?:^|\/)(?:scripts?|docs?|\.github|vendor|generated)(?:\/|$)/.test(pathValue)
  );
}
function researchEvidenceUseful(kind: string, pathValue?: string): boolean {
  if (["api", "service", "data", "test", "risk", "flow"].includes(kind))
    return !pathValue || !/(?:^|\/)(?:node_modules|vendor|dist|build)(?:\/|$)/i.test(pathValue);
  if (kind === "architecture") return !pathValue || planningPathUseful(pathValue);
  if (kind === "symbol" || kind === "file")
    return Boolean(pathValue && planningPathUseful(pathValue));
  return false;
}
function researchEvidencePriority(kind: string): number {
  return (
    (
      {
        api: 0,
        service: 1,
        flow: 2,
        test: 3,
        risk: 4,
        data: 5,
        symbol: 6,
        file: 7,
        architecture: 8
      } as Record<string, number>
    )[kind] ?? 20
  );
}

type ResearchableTaskResult = Omit<
  KeystoneTaskResult,
  "intentId" | "researchStatus" | "researchDocument"
> &
  Partial<Pick<KeystoneTaskResult, "intentId" | "researchStatus" | "researchDocument">>;

function ensureTaskResearch(
  intentText: string,
  result: ResearchableTaskResult
): KeystoneTaskResult {
  const intentId =
    result.intentId?.trim() ||
    `intent-${createHash("sha256").update(intentText.trim()).digest("hex").slice(0, 20)}`;
  if (result.researchDocument?.markdown)
    return {
      ...result,
      intentId,
      researchStatus: result.researchStatus ?? "ready",
      researchDocument: result.researchDocument
    } as KeystoneTaskResult;
  const supportedKinds = new Set<SDLCResearchEvidence["kind"]>([
    "file",
    "symbol",
    "api",
    "service",
    "data",
    "test",
    "risk",
    "flow",
    "architecture"
  ]);
  const evidence: SDLCResearchEvidence[] = (result.evidence ?? [])
    .filter((item) => researchEvidenceUseful(item.kind, item.path))
    .sort(
      (a, b) =>
        researchEvidencePriority(a.kind) - researchEvidencePriority(b.kind) ||
        (b.confidence ?? 0) - (a.confidence ?? 0)
    )
    .slice(0, 32)
    .map((item, index) => ({
      id: item.okfId ?? `intent-evidence-${index + 1}`,
      kind: supportedKinds.has(item.kind as SDLCResearchEvidence["kind"])
        ? (item.kind as SDLCResearchEvidence["kind"])
        : "architecture",
      label: item.label,
      summary: item.summary ?? item.label,
      ...(item.path ? { path: item.path } : {}),
      ...(item.okfId ? { okfId: item.okfId } : {}),
      ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {})
    }));
  const planningFiles = result.relevantFiles.filter((pathValue) => planningPathUseful(pathValue));
  const planning: SDLCPlanningContext = {
    intentId,
    relevantFiles: planningFiles.length ? planningFiles : result.relevantFiles.slice(0, 12),
    relevantSymbols: result.relevantSymbols,
    relevantApis: result.relatedApis,
    relevantServices: result.impactedServices,
    affectedFlows: result.contextSections
      ?.filter((section) => planningPathUseful(section.path))
      .flatMap(
        (section) =>
          section.evidence
            ?.filter((item) => item.kind.includes("flow") || item.kind === "call")
            .map((item) => `${item.kind}: ${item.label}`) ?? []
      )
      .slice(0, 16),
    relatedTests: result.relatedTests,
    missingTests: result.missingTests,
    qaChecklist: result.qaChecklist,
    securityRisk: result.securityRisk,
    performanceRisk: result.performanceRisk,
    modernizationNotes: result.modernizationNotes,
    evidence,
    functionalRequirements: result.acceptanceCriteria,
    nonFunctionalRequirements: [
      ...(result.securityConstraints ?? []),
      ...(result.performanceConstraints ?? [])
    ],
    constraints: [
      ...(result.architectureConstraints ?? []),
      "Keystone Git access remains strictly read-only."
    ]
  };
  return {
    ...result,
    intentId,
    researchStatus: result.researchStatus ?? "ready",
    researchDocument: createResearchDocument(intentId, intentText, planning)
  } as KeystoneTaskResult;
}

function normalizeRunResult(
  run: KeystoneRunResult,
  settings?: CockpitSettings,
  analysisEvidence?: NonNullable<KeystoneTaskResult["analysisEvidence"]>,
  copilotCustomizations?: CopilotCustomizationInventory
): Omit<KeystoneTaskResult, "intentId" | "researchStatus" | "researchDocument"> {
  const tests = run.contextPack.relatedTests.map((test) => test.testFile);
  const securityRisk = maxTaskRisk(run.security.riskLevel, analysisEvidence?.security.riskLevel);
  const performanceRisk = maxTaskRisk(
    run.performance.riskLevel,
    analysisEvidence?.performance.riskLevel
  );
  const qaGaps = analysisEvidence?.qa.gaps ?? [];
  const missingTests = [
    ...new Set([...run.qa.missingTestAreas, ...qaGaps.map((gap) => `${gap.path}: ${gap.reason}`)])
  ];
  const qaChecklist = [
    ...new Set([...run.qa.checklist, ...(analysisEvidence?.qa.recommendations ?? [])])
  ];
  const modernizationGapNotes = (analysisEvidence?.modernization.gaps ?? [])
    .filter((gap) => gap.priority === "high" || gap.priority === "critical")
    .map((gap) => `${gap.priority}: ${gap.title}`);
  const modernizationNotes =
    run.intentAnalysis.intentType === "modernization"
      ? [...new Set([...run.modernization.phasedPlan, ...modernizationGapNotes])]
      : [];
  const excluded = run.intelligence.files
    .filter(
      (file) => !run.contextPack.relevantFiles.some((selected) => selected.path === file.path)
    )
    .slice(0, 30)
    .map((file) => ({
      path: file.path,
      reason: file.isGenerated ? "Generated file" : "Outside the selected task context"
    }));
  const risk = (level: "low" | "medium" | "high", area: string, detail: string) => ({
    area,
    level,
    detail
  });
  const policy = [
    settings?.codingStandards && `Coding standards:\n${settings.codingStandards}`,
    settings?.thingsToAvoid && `Additional things to avoid:\n${settings.thingsToAvoid}`
  ]
    .filter(Boolean)
    .join("\n\n");
  const promptWithPolicy = policy
    ? `${run.contextPack.copilotPrompt}\n\nWorkspace policy:\n${policy}`
    : run.contextPack.copilotPrompt;
  const copilotPrompt = promptWithPolicy;
  return {
    intentType: run.intentAnalysis.intentType,
    matchedRule: run.intentAnalysis.keywords[0],
    textKeywords: run.intentAnalysis.keywords,
    confidence: run.intentAnalysis.confidence,
    confidenceDetails: {
      overall: run.intentAnalysis.confidence * 100,
      signals: [
        { name: "Intent classification", score: run.intentAnalysis.confidence * 100, weight: 0.4 },
        { name: "Route decision", score: run.routeDecision.confidence * 100, weight: 0.35 },
        { name: "QA coverage", score: run.qa.coverageConfidence * 100, weight: 0.25 }
      ]
    },
    route: run.routeDecision.selectedRoute,
    reason: run.routeDecision.reason,
    routeEvidence: {
      matchedRule: run.intentAnalysis.keywords[0] ?? "fallback",
      confidence: run.routeDecision.confidence,
      reason: run.routeDecision.reason,
      whyNot: [`Fallback route: ${run.routeDecision.fallbackPath}`]
    },
    tokenReduction: run.contextPack.estimatedReductionPercent,
    relevantFiles: run.contextPack.relevantFiles.map((file) => file.path),
    relevantSymbols: run.contextPack.relevantSymbols.map(
      (symbol) => `${symbol.name} — ${symbol.filePath}:${symbol.line}`
    ),
    relatedTests: tests,
    missingTests,
    coverageConfidence: run.qa.coverageConfidence,
    validationCommands: ["npm run typecheck", "npm run lint", "npm test"],
    qaChecklist,
    securityRisk,
    performanceRisk,
    modernizationNotes,
    copilotPrompt,
    prMarkdown: appendReadOnlyReview(run.prEvidence.markdown, analysisEvidence),
    contextTokens: {
      raw: run.contextPack.estimatedRawTokens,
      selected: run.contextPack.selectedContextTokens ?? run.contextPack.estimatedPackedTokens,
      prompt: run.contextPack.estimatedPackedTokens,
      packets: run.contextPack.contextPackets?.length ?? 1,
      tier: run.contextPack.compressionTier ?? "standard"
    },
    contextSections: run.contextPack.contextSections?.map((section) => ({
      path: section.path,
      reason: section.reason,
      preview: section.content.slice(0, 500),
      estimatedTokens: section.estimatedTokens,
      sourceHash: section.sourceHash,
      score: section.score,
      evidence: section.evidence
    })),
    contextPackets: run.contextPack.contextPackets,
    boundedIntelligence: run.contextPack.boundedIntelligence,
    omittedContext: run.contextPack.omittedContext,
    contextManifest: run.contextPack.contextManifest,
    relatedApis: run.contextPack.relatedApis.map(
      (api) => `${api.method} ${api.path} — ${api.filePath}:${api.line}`
    ),
    impactedServices: run.contextPack.impactedServices
      .filter((service) => !isLikelyTestPath(service.filePath))
      .map((service) => `${service.name} — ${service.filePath}`),
    architectureConstraints: run.contextPack.architectureConstraints,
    securityConstraints: run.contextPack.securityConstraints,
    performanceConstraints: run.contextPack.performanceConstraints,
    acceptanceCriteria: run.contextPack.acceptanceCriteria,
    repoSkills: run.contextPack.repoSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      guidance: skill.guidance
    })),
    copilotCustomizations,
    evidence: mergeTaskEvidence(uniqueEvidence(run.contextPack), analysisEvidence),
    analysisEvidence,
    retrievalMetrics: run.contextPack.retrievalMetrics,
    detailedRisks: {
      architectureImpact: risk(
        run.routeDecision.risks.length > 2 ? "medium" : "low",
        "Architecture impact",
        run.routeDecision.reason
      ),
      securityRisk: risk(
        securityRisk,
        "Security risk",
        [
          ...run.security.checklist,
          ...(analysisEvidence?.security.findings.map(
            (item) => `${item.path}:${item.line} ${item.title}`
          ) ?? []),
          ...(analysisEvidence?.security.intelligenceSignals.map((item) => item.summary) ?? [])
        ].join(" · ") || "No security issue detected."
      ),
      performanceRisk: risk(
        performanceRisk,
        "Performance risk",
        [
          ...run.performance.checklist,
          ...(analysisEvidence?.performance.findings.map(
            (item) => `${item.path}:${item.line} ${item.title}`
          ) ?? []),
          ...(analysisEvidence?.performance.intelligenceSignals.map((item) => item.summary) ?? [])
        ].join(" · ") || "No performance issue detected."
      ),
      testGaps: risk(
        missingTests.length ? "medium" : "low",
        "Test gaps",
        missingTests.join(" · ") || "Mapped tests cover the selected context."
      ),
      dependencyChanges: risk(
        "low",
        "Dependency changes",
        "No dependency manifest change is proposed by the current task."
      )
    },
    excludedPaths: excluded
  };
}
