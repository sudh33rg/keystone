import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { emptyRepoIntelligence, indexRepository } from "../ingestion/repoIndexer";
import { normalizeMaxFileSizeBytes } from "../ingestion/fileScanner";
import { RevisionGuard } from "../ingestion/revisionGuard";
import { reclaimSnapshotArchives } from "../ingestion/snapshotPrune";
import { IntelligenceStore } from "../ingestion/intelligenceStore";
import type {
  EvidenceMetadata,
  RepoIntelligence,
  SemanticCall,
  TypeRelationshipFact
} from "../../domain/types";
import {
  INTELLIGENCE_FAMILIES,
  INTELLIGENCE_STAGES,
  type IntelligenceFamily,
  type IntelligenceFamilySummary,
  type IntelligencePipelineOptions,
  type IntelligenceStageId,
  type IntelligenceStageResult,
  type RepositoryIntelligenceSnapshot
} from "./types";
import {
  analyzeTypeScriptProjectIsolated,
  buildTypeScriptCpg,
  buildUniversalCpg,
  CpgShardStore,
  type TypeScriptSemanticResult
} from "../cpg";
import { OkfSnapshotStore } from "../okf/store";
import { repoIntelligenceToOkf } from "../okf/fromRepoIntelligence";
import {
  analyzeRepositoryGraph,
  createGraphImpactAnalyzer,
  type RepositoryGraphAnalysis
} from "./derivedGraph";
import { evaluateIntelligenceHealth } from "./health";
import { planIncrementalUpdate } from "./incremental";
import type { IncrementalUpdatePlan } from "./incremental";
import { buildIntelligenceFindings } from "./findings";
import type { IntelligenceFinding } from "./findings";
import { buildRuntimeVerification, type RuntimeVerification } from "./runtime";
import { buildRepositoryEvolution, type RepositoryEvolution } from "./evolution";
import { analyzeDeadCode, type DeadCodeCandidate } from "./deadCode";
import { GitReadOnly } from "../../platform/git/gitReadOnly";
import { runStageInWorker } from "./stageWorkerPool";

const STORE = ".keystone/intelligence";

type StageDefinition = {
  id: IntelligenceStageId;
  label: string;
  family: IntelligenceFamily;
  cognitive?: boolean;
  analyze(context: StageContext): Promise<StageProjection> | StageProjection;
};
export type StageProjection = {
  summary: string;
  items?: string[];
  metrics?: Record<string, number | string | boolean>;
};
type StageContext = {
  root: string;
  persist: boolean;
  intelligence: RepoIntelligence;
  graph: RepositoryGraphAnalysis;
  runtime: RuntimeVerification;
  semantic: TypeScriptSemanticResult;
  evolution: RepositoryEvolution;
  deadCode: readonly DeadCodeCandidate[];
  previous: Map<IntelligenceStageId, IntelligenceStageResult>;
};

export interface SerializedStageContext {
  root: string;
  persist: boolean;
  intelligence: RepoIntelligence;
  graph: Omit<RepositoryGraphAnalysis, "impactedBy">;
  runtime: RuntimeVerification;
  semantic: TypeScriptSemanticResult;
  evolution: RepositoryEvolution;
  deadCode: readonly DeadCodeCandidate[];
  previous: ReadonlyArray<readonly [IntelligenceStageId, IntelligenceStageResult]>;
}

export async function runIntelligenceStage(
  stageId: string,
  serialized: SerializedStageContext
): Promise<StageProjection> {
  const definition = STAGES.find((stage) => stage.id === stageId);
  if (!definition) throw new Error(`Unknown intelligence stage: ${stageId}.`);
  const graph = {
    ...serialized.graph,
    impactedBy: createGraphImpactAnalyzer(
      serialized.intelligence.files.map((file) => file.path),
      serialized.graph.localEdges,
      serialized.intelligence.tests
    )
  } as RepositoryGraphAnalysis;
  return definition.analyze({
    root: serialized.root,
    persist: serialized.persist,
    intelligence: serialized.intelligence,
    graph,
    runtime: serialized.runtime,
    semantic: serialized.semantic,
    evolution: serialized.evolution,
    deadCode: serialized.deadCode,
    previous: new Map(serialized.previous)
  });
}

export async function buildRepositoryIntelligence(
  root: string,
  options: IntelligencePipelineOptions = {}
): Promise<RepositoryIntelligenceSnapshot> {
  const startedAt = new Date().toISOString();
  const runId = `intelligence-${Date.now().toString(36)}`;
  const warnings: string[] = [];
  const reportNotice = (message: string): void => {
    try {
      options.onWarning?.(message);
    } catch (error) {
      console.warn(
        `[Keystone intelligence] Warning reporter failed: ${errorMessage(error)}. Original warning: ${message}`
      );
    }
    if (!options.onWarning) console.warn(`[Keystone intelligence] ${message}`);
    try {
      options.onProgress?.({
        stage: "structural",
        order: 1,
        total: INTELLIGENCE_STAGES.length,
        progress: 4.8,
        message: `Warning: ${message}`
      });
    } catch (error) {
      console.warn(`[Keystone intelligence] Progress reporter failed: ${errorMessage(error)}.`);
    }
  };
  const reportWarning = (message: string): void => {
    warnings.push(message);
    reportNotice(message);
  };
  if (options.signal?.aborted) throw new IntelligencePipelineCancelledError("structural");

  // Stale-intelligence guard. The working tree revision (Git HEAD) is recorded
  // in a sidecar outside the OKF boundary. If HEAD no longer matches the record,
  // the cached structural index cannot be trusted for incremental reuse — a
  // branch switch or checkout can legitimately leave file contents/hashes
  // identical to a stale baseline. Clearing the prior stores forces a full
  // rebuild from the current tree.
  const revisionGuard = new RevisionGuard(root);
  const mismatch = await revisionGuard.detectMismatch().catch(() => undefined);
  if (mismatch) {
    reportNotice(
      mismatch.previous
        ? `Working tree moved to ${mismatch.current.branch} (${mismatch.current.head.slice(0, 12)}); discarding stale intelligence for a full rebuild.`
        : `Initial intelligence run for ${mismatch.current.branch} (${mismatch.current.head.slice(0, 12)}).`
    );
    try {
      await fs.rm(path.join(root, STORE), { recursive: true, force: true });
    } catch (error) {
      reportWarning(`Could not clear stale intelligence store: ${errorMessage(error)}.`);
    }
  }
  const previousSnapshot = await readSnapshot(root, reportWarning);
  if (options.persist !== false) {
    try {
      await fs.rm(path.join(root, STORE, "stages"), { recursive: true, force: true });
    } catch (error) {
      if (isAbortError(error, options.signal)) throw error;
      reportWarning(`Could not clear previous stage records: ${errorMessage(error)}.`);
    }
  }
  let intelligence: RepoIntelligence;
  const maxFileSizeBytes = normalizeMaxFileSizeBytes(options.maxFileSizeBytes);
  let skippedLargeFiles = 0;
  try {
    intelligence = await indexRepository(root, {
      persist: options.persist,
      signal: options.signal,
      maxFileSizeBytes,
      onDiscovery: (discovered, file, skipped) => {
        skippedLargeFiles = skipped;
        options.onProgress?.({
          stage: "structural",
          order: 1,
          total: STAGES.length,
          progress: 1,
          message: `Discovering ${file} (${discovered} files found; files over ${formatBytes(maxFileSizeBytes)} skipped${skipped ? `: ${skipped}` : ""})`
        });
      },
      onFile: (indexed, total, file) =>
        options.onProgress?.({
          stage: "structural",
          order: 1,
          total: STAGES.length,
          progress: Math.min(4, Math.round((indexed / Math.max(total, 1)) * 4)),
          message: `Indexing ${file} (${indexed}/${total})`
        }),
      onWarning: reportWarning,
      onPersistence: (event) =>
        options.onProgress?.({
          stage: "structural",
          order: 1,
          total: STAGES.length,
          progress: {
            "structural-store": 4.1,
            "okf-read": 4.2,
            "okf-build": 4.3,
            "okf-store": 4.4,
            "okf-complete": 4.9
          }[event.phase],
          message: event.message
        }),
      semanticEnricher: options.semanticEnricher,
      affectedPaths: options.affectedPaths
    });
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Structural ingestion failed; continuing with an empty structural index: ${errorMessage(error)}.`
    );
    intelligence = emptyRepoIntelligence(root);
  }
  if (skippedLargeFiles)
    reportNotice(
      `Skipped ${skippedLargeFiles} file${skippedLargeFiles === 1 ? "" : "s"} larger than ${formatBytes(maxFileSizeBytes)} during ingestion.`
    );
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 4,
    message: "Building repository dependency graph..."
  });
  const graphStartedAt = Date.now();
  let graph: RepositoryGraphAnalysis;
  try {
    graph = analyzeRepositoryGraph(intelligence);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Repository dependency graph failed; continuing with an empty graph: ${errorMessage(error)}.`
    );
    graph = emptyRepositoryGraph(intelligence);
  }
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 5,
    message: `Repository dependency graph ready in ${Date.now() - graphStartedAt}ms (${graph.localEdges.length} local edges).`
  });
  const semanticPaths = intelligence.files
    .filter((file) => /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path) && !file.isGenerated)
    .map((file) => file.path);
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 6,
    message: `Resolving compiler semantics for ${semanticPaths.length} TypeScript/JavaScript files...`
  });
  const semanticStartedAt = Date.now();
  let semantic: TypeScriptSemanticResult;
  try {
    semantic = await analyzeTypeScriptProjectIsolated(
      root,
      semanticPaths,
      options.signal,
      (message) =>
        options.onProgress?.({
          stage: "structural",
          order: 1,
          total: STAGES.length,
          progress: message.includes("complete") ? 8 : 7,
          message
        })
    );
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Compiler semantics failed; continuing with deterministic intelligence: ${errorMessage(error)}.`
    );
    semantic = emptyTypeScriptSemanticResult();
  }
  // Merge semantic evidence into the in-memory model now, but defer canonical
  // OKF promotion until every ingestion stage has completed. A failed early
  // promotion used to leave a valid structural snapshot with no worker input.
  mergeProjectSemanticEvidence(intelligence, semantic);
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 8,
    message: `Compiler semantics ready in ${Date.now() - semanticStartedAt}ms; planning repository projections...`
  });
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 8,
    message: "Planning incremental, evolution, dead-code, finding, and runtime projections..."
  });
  let incremental: IncrementalUpdatePlan;
  try {
    incremental = planIncrementalUpdate(previousSnapshot?.intelligence, intelligence);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Incremental planning failed; continuing with a full rebuild plan: ${errorMessage(error)}.`
    );
    incremental = fullIncrementalPlan(intelligence);
  }
  let evolution: RepositoryEvolution;
  try {
    evolution = await buildRepositoryEvolution(root, incremental);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Repository evolution analysis failed; continuing without Git coupling: ${errorMessage(error)}.`
    );
    evolution = emptyRepositoryEvolution(incremental);
  }
  for (const warning of evolution.warnings) {
    // Git coupling is an optional evidence source for local/non-Git workspaces.
    // Keep it visible in activity without making an otherwise complete OKF
    // snapshot unusable or preventing downstream workers from starting.
    if (warning.startsWith("Git coupling unavailable:")) reportNotice(warning);
    else reportWarning(warning);
  }
  options.onProgress?.({
    stage: "structural",
    order: 1,
    total: STAGES.length,
    progress: 9,
    message: "Repository projection planning complete; preparing intelligence stages..."
  });
  let deadCode: DeadCodeCandidate[];
  try {
    deadCode = analyzeDeadCode(intelligence, graph, semantic);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Dead-code analysis failed; continuing without dead-code findings: ${errorMessage(error)}.`
    );
    deadCode = [];
  }
  let findings: IntelligenceFinding[];
  try {
    findings = buildIntelligenceFindings(intelligence, graph, evolution, deadCode);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Intelligence finding generation failed; continuing without derived findings: ${errorMessage(error)}.`
    );
    findings = [];
  }
  let runtime: RuntimeVerification;
  try {
    runtime = await buildRuntimeVerification(root, findings);
  } catch (error) {
    if (isAbortError(error, options.signal))
      throw new IntelligencePipelineCancelledError("structural");
    reportWarning(
      `Runtime verification failed; continuing without runtime evidence: ${errorMessage(error)}.`
    );
    runtime = emptyRuntimeVerification();
  }
  for (const warning of runtime.warnings) {
    if (
      warning === "No runtime telemetry mapping is available; conclusions are static-only." ||
      warning === "No supported validation commands were found."
    )
      reportNotice(warning);
    else reportWarning(warning);
  }
  const context: StageContext = {
    root,
    persist: options.persist !== false,
    intelligence,
    graph,
    runtime,
    semantic,
    evolution,
    deadCode,
    previous: new Map()
  };
  const configuredWorkers = Number(options.maxWorkers ?? 5);
  const maxWorkers = Number.isFinite(configuredWorkers)
    ? Math.max(1, Math.min(16, Math.floor(configuredWorkers)))
    : 5;
  const stageResults = new Map<IntelligenceStageId, IntelligenceStageResult>();
  const pending = new Set(STAGES.map((stage) => stage.id));
  const dependencies: Partial<Record<IntelligenceStageId, readonly IntelligenceStageId[]>> = {
    impact: ["git-change"],
    context: ["git-change"]
  };
  const workerPath = path.join(__dirname, "intelligenceStageWorker.js");
  let completedStages = 0;

  while (pending.size) {
    if (options.signal?.aborted) throw new IntelligencePipelineCancelledError("structural");
    const ready = STAGES.filter(
      (stage) =>
        pending.has(stage.id) &&
        (dependencies[stage.id] ?? []).every((dependency) => stageResults.has(dependency))
    );
    if (!ready.length)
      throw new Error("Intelligence stage dependency graph could not make progress.");
    const batch = ready.slice(0, maxWorkers);
    const previous = new Map(stageResults);
    for (const definition of batch) {
      const progress = 10 + Math.round((completedStages / STAGES.length) * 88);
      options.onProgress?.({
        stage: definition.id,
        order: STAGES.indexOf(definition) + 1,
        total: STAGES.length,
        progress,
        message: `Starting ${definition.label} on an intelligence worker (pool ${maxWorkers}).`,
        workerPool: {
          maxWorkers,
          activeWorkers: batch.length,
          completedStages,
          totalStages: STAGES.length,
          queuedStages: Math.max(0, pending.size - batch.length),
          currentStages: batch.map((item) => item.label)
        }
      });
    }
    const results = await Promise.all(
      batch.map((definition) =>
        executeStage(
          definition,
          context,
          previous,
          workerPath,
          options,
          completedStages,
          reportWarning
        )
      )
    );
    for (const result of results) {
      stageResults.set(result.id, result);
      pending.delete(result.id);
      completedStages += 1;
      const progress = 10 + Math.round((completedStages / STAGES.length) * 88);
      options.onProgress?.({
        stage: result.id,
        order: result.order,
        total: STAGES.length,
        progress,
        message: `${result.label} ${result.status} in ${result.durationMs}ms (${completedStages}/${STAGES.length} stages complete).`,
        workerPool: {
          maxWorkers,
          activeWorkers: batch.filter((item) => !stageResults.has(item.id)).length,
          completedStages,
          totalStages: STAGES.length,
          queuedStages: Math.max(0, pending.size - batch.length),
          currentStages: batch
            .filter((item) => !stageResults.has(item.id))
            .map((item) => item.label)
        }
      });
    }
    context.previous = new Map(stageResults);
    if (options.persist !== false) {
      await Promise.all(
        results.map(async (result) => {
          try {
            await writeJson(
              root,
              `${STORE}/stages/${String(result.order).padStart(2, "0")}-${result.id}.json`,
              result
            );
          } catch (error) {
            reportWarning(
              `Could not persist ${result.label}; continuing with its in-memory result: ${errorMessage(error)}.`
            );
          }
        })
      );
    }
  }

  const stages = STAGES.map((stage) => stageResults.get(stage.id)!);

  // Warnings are observable evidence, not a pipeline failure. A run is
  // degraded only when a stage fails or a required persisted artifact cannot
  // be produced; optional Git/runtime/diagnostic warnings must not block the
  // completed intelligence and worker handoff.
  const status = stages.some((stage) => stage.status === "failed") ? "degraded" : "ready";
  const cpgMetrics = context.previous.get("code-property-graph")?.metrics ?? {};
  const ingestion = {
    inputFingerprint: fingerprint(intelligence),
    indexedFiles: intelligence.files.length,
    indexedBytes: intelligence.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    discoveryMode: "unbounded-incremental" as const,
    completedWithoutFileCap: true,
    fileSizeLimitBytes: maxFileSizeBytes,
    skippedLargeFiles,
    cpgEligibleFiles: Number(cpgMetrics.eligibleFiles ?? 0),
    cpgIndexedFiles: Number(cpgMetrics.indexedFiles ?? 0),
    reusedFiles: intelligence.incrementalStats?.reusedFiles ?? 0,
    analyzedFiles: intelligence.incrementalStats?.analyzedFiles ?? intelligence.files.length,
    cpgShardsWritten: Number(cpgMetrics.shardsWritten ?? 0),
    cpgShardsReused: Number(cpgMetrics.shardsReused ?? 0),
    cpgShardsDeleted: Number(cpgMetrics.shardsDeleted ?? 0),
    warnings
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
  if (options.persist !== false) {
    options.onProgress?.({
      stage: "runtime-observability",
      order: STAGES.length,
      total: STAGES.length,
      progress: 99,
      message: "Promoting the completed repository model to canonical OKF..."
    });
    try {
      await promoteProjectSemanticEvidence(
        root,
        intelligence,
        runId,
        options,
        reportWarning,
        false
      );
    } catch (error) {
      if (isAbortError(error, options.signal))
        throw new IntelligencePipelineCancelledError("runtime-observability");
      snapshot.status = "degraded";
      reportWarning(
        `Canonical OKF promotion failed after ingestion; background workers will remain idle until a successful manual re-index: ${errorMessage(error)}`
      );
    }
    try {
      await writeJson(root, `${STORE}/snapshot.json`, snapshot);
    } catch (error) {
      reportWarning(
        `Could not persist the intelligence snapshot; returning the completed in-memory result: ${errorMessage(error)}.`
      );
      snapshot.status = "degraded";
    }
    await revisionGuard
      .current()
      .then((current) => (current ? revisionGuard.write(current) : undefined))
      .catch((error) =>
        reportWarning(`Could not record the working-tree revision: ${errorMessage(error)}.`)
      );
    // Prune the write-only snapshot archive so it cannot grow unbounded across
    // runs. These archives are never read back, so retaining only the newest is
    // sufficient for forensic recovery without the ~110 MB/run disk cost.
    await reclaimSnapshotArchives(root).catch((error) =>
      reportWarning(
        `Could not prune snapshot archives or persistent caches: ${errorMessage(error)}.`
      )
    );
  }
  options.onProgress?.({
    stage: "runtime-observability",
    order: STAGES.length,
    total: STAGES.length,
    progress: 100,
    message:
      snapshot.status === "ready"
        ? `All repository intelligence families are ready${warnings.length ? ` with ${warnings.length} non-blocking warning(s)` : ""}.`
        : "Repository intelligence completed with blocking failures; inspect ingestion activity."
  });
  return snapshot;
}

export class IntelligencePipelineCancelledError extends Error {
  constructor(readonly stage: IntelligenceStageId) {
    super(`Intelligence pipeline cancelled before ${stage}.`);
    this.name = "IntelligencePipelineCancelledError";
  }
}

function summarizeFamilies(stages: IntelligenceStageResult[]): IntelligenceFamilySummary[] {
  return INTELLIGENCE_FAMILIES.map((id) => {
    const familyStages = stages.filter((stage) => stage.family === id);
    const completedStages = familyStages.filter((stage) => stage.status === "complete").length;
    return {
      id,
      label: familyLabel(id),
      stageCount: STAGES.filter((stage) => stage.family === id).length,
      completedStages,
      itemCount: familyStages.reduce((sum, stage) => sum + stage.itemCount, 0),
      status: familyStages.some((stage) => stage.status === "failed")
        ? "failed"
        : completedStages === STAGES.filter((stage) => stage.family === id).length
          ? "complete"
          : "pending"
    };
  });
}

function familyLabel(id: IntelligenceFamily): string {
  return {
    "repository-structure": "Repository Structure Intelligence",
    "code-graph": "Code Graph Intelligence",
    "build-test-qa": "Build, Test, and QA Intelligence",
    "architecture-sdlc": "Architecture and SDLC Intelligence",
    "context-token": "Context and Token Intelligence",
    "runtime-analysis": "Runtime and Observability Intelligence"
  }[id];
}
function stage(
  id: IntelligenceStageId,
  label: string,
  family: IntelligenceFamily,
  analyze: StageDefinition["analyze"],
  cognitive = false
): StageDefinition {
  return { id, label, family, analyze, cognitive };
}
function pathsMatching(intelligence: RepoIntelligence, pattern: RegExp): string[] {
  return intelligence.files.map((file) => file.path).filter((file) => pattern.test(file));
}
function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function fingerprint(intelligence: RepoIntelligence): string {
  const input = intelligence.files
    .map(
      (file) =>
        `${file.path}\0${file.sizeBytes}\0${file.lineCount}\0${file.contentHash ?? ""}\0${file.structuralHash ?? ""}`
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(input).digest("hex");
}
async function readJsonFile(
  root: string,
  relative: string
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relative), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function emptyRepositoryGraph(intelligence: RepoIntelligence): RepositoryGraphAnalysis {
  return {
    localEdges: [],
    hubs: [],
    entryPoints: [],
    orphanSourceFiles: [],
    cycles: [],
    communities: [],
    flows: [],
    impactedBy: createGraphImpactAnalyzer(
      intelligence.files.map((file) => file.path),
      [],
      intelligence.tests
    )
  };
}

function emptyTypeScriptSemanticResult(): TypeScriptSemanticResult {
  return {
    projectConfigs: [],
    files: 0,
    calls: [],
    relationships: [],
    callbacks: [],
    unresolvedCalls: 0,
    diagnostics: 0,
    configuredDiagnostics: 0,
    fallbackDiagnostics: 0,
    configuredFiles: 0,
    fallbackFiles: 0,
    diagnosticCodes: {},
    diagnosticExamples: []
  };
}

function mergeProjectSemanticEvidence(
  intelligence: RepoIntelligence,
  semantic: TypeScriptSemanticResult
): boolean {
  const existingCalls = intelligence.calls ?? [];
  const existingTypes = intelligence.typeRelationships ?? [];
  const callableSymbols = semantic.calls.length
    ? buildCallableSymbolIndex(intelligence)
    : new Map<string, Array<{ name: string; line: number }>>();
  const semanticCalls = semantic.calls.map((call) => ({
    filePath: normalizeRelativePath(call.sourcePath),
    caller: enclosingCallable(callableSymbols, call.sourcePath, call.sourceLine),
    callee: call.callee,
    line: call.sourceLine,
    targetFilePath: normalizeRelativePath(call.targetPath),
    targetLine: call.targetLine,
    evidence: compilerEvidence(call.sourcePath, call.sourceLine)
  }));
  const semanticTypes = semantic.relationships
    .filter(
      (relationship): relationship is typeof relationship & { kind: "extends" | "implements" } =>
        relationship.kind === "extends" || relationship.kind === "implements"
    )
    .map((relationship) => ({
      filePath: normalizeRelativePath(relationship.sourcePath),
      source: relationship.sourceName,
      target: relationship.targetName,
      kind: relationship.kind,
      line: relationship.sourceLine,
      targetFilePath: normalizeRelativePath(relationship.targetPath),
      targetLine: relationship.targetLine,
      evidence: compilerEvidence(relationship.sourcePath, relationship.sourceLine)
    }));
  if (!semanticCalls.length && !semanticTypes.length) return false;

  const mergedCalls = mergeSemanticCalls(semanticCalls, existingCalls);
  const mergedTypes = mergeSemanticTypes(semanticTypes, existingTypes);
  intelligence.calls = mergedCalls;
  intelligence.typeRelationships = mergedTypes;
  return (
    !sameSemanticCalls(existingCalls, mergedCalls) || !sameSemanticTypes(existingTypes, mergedTypes)
  );
}

async function promoteProjectSemanticEvidence(
  root: string,
  intelligence: RepoIntelligence,
  extractionRunId: string,
  options: IntelligencePipelineOptions,
  reportWarning: (message: string) => void,
  showProgress = true
): Promise<void> {
  options.signal?.throwIfAborted();
  const onProgress = showProgress ? options.onProgress : undefined;
  onProgress?.({
    stage: "structural",
    order: 1,
    total: INTELLIGENCE_STAGES.length,
    progress: 8.5,
    message: "Promoting compiler-bound calls and type relationships into canonical OKF..."
  });
  try {
    await new IntelligenceStore(root).write(intelligence);
  } catch (error) {
    reportWarning(
      `Could not persist project-aware semantic facts in the structural index; canonical promotion will continue: ${errorMessage(error)}.`
    );
  }
  options.signal?.throwIfAborted();
  const okfStore = new OkfSnapshotStore(root);
  const previousSnapshot = await okfStore.read();
  const snapshot = repoIntelligenceToOkf(intelligence, {
    previousSnapshot,
    extractionRunId,
    observedAt: intelligence.indexedAt,
    onWarning: reportWarning
  });
  await okfStore.write(snapshot, {
    onProgress: (message) =>
      onProgress?.({
        stage: "structural",
        order: 1,
        total: INTELLIGENCE_STAGES.length,
        progress: 9,
        message
      })
  });
}

function mergeSemanticCalls(
  preferred: readonly SemanticCall[],
  existing: readonly SemanticCall[]
): SemanticCall[] {
  const byKey = new Map<string, SemanticCall>();
  for (const call of existing) byKey.set(semanticCallKey(call), call);
  for (const call of preferred) byKey.set(semanticCallKey(call), call);
  return [...byKey.values()];
}

function mergeSemanticTypes(
  preferred: readonly TypeRelationshipFact[],
  existing: readonly TypeRelationshipFact[]
): TypeRelationshipFact[] {
  const byKey = new Map<string, TypeRelationshipFact>();
  for (const relationship of existing) byKey.set(typeRelationshipKey(relationship), relationship);
  for (const relationship of preferred) byKey.set(typeRelationshipKey(relationship), relationship);
  return [...byKey.values()];
}

function semanticCallKey(call: SemanticCall): string {
  return `${call.filePath}:${call.line}:${call.caller ?? ""}:${call.callee}`;
}

function typeRelationshipKey(relationship: TypeRelationshipFact): string {
  return `${relationship.kind}:${relationship.filePath}:${relationship.line}:${relationship.source}:${relationship.target}`;
}

function sameSemanticCalls(left: readonly SemanticCall[], right: readonly SemanticCall[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (call, index) => semanticCallValueKey(call) === semanticCallValueKey(right[index])
  );
}

function sameSemanticTypes(
  left: readonly TypeRelationshipFact[],
  right: readonly TypeRelationshipFact[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (relationship, index) =>
      typeRelationshipValueKey(relationship) === typeRelationshipValueKey(right[index])
  );
}

function semanticCallValueKey(call: SemanticCall): string {
  return `${semanticCallKey(call)}:${call.targetFilePath ?? ""}:${call.targetLine ?? ""}:${evidenceKey(call.evidence)}`;
}

function typeRelationshipValueKey(relationship: TypeRelationshipFact): string {
  return `${typeRelationshipKey(relationship)}:${relationship.targetFilePath ?? ""}:${relationship.targetLine ?? ""}:${evidenceKey(relationship.evidence)}`;
}

function evidenceKey(evidence: EvidenceMetadata | undefined): string {
  if (!evidence) return "";
  return [
    evidence.source,
    evidence.confidence,
    evidence.evidencePath ?? "",
    evidence.evidenceLine ?? "",
    evidence.extractorVersion,
    evidence.stale ?? "",
    evidence.warnings?.join("\u001f") ?? ""
  ].join("\u001e");
}

function buildCallableSymbolIndex(
  intelligence: RepoIntelligence
): Map<string, Array<{ name: string; line: number }>> {
  const byFile = new Map<string, Array<{ name: string; line: number }>>();
  for (const symbol of intelligence.symbols) {
    if (symbol.kind !== "function" && symbol.kind !== "method") continue;
    const fileSymbols = byFile.get(normalizeRelativePath(symbol.filePath)) ?? [];
    fileSymbols.push({ name: symbol.name, line: symbol.line });
    byFile.set(normalizeRelativePath(symbol.filePath), fileSymbols);
  }
  for (const symbols of byFile.values()) symbols.sort((left, right) => left.line - right.line);
  return byFile;
}

function enclosingCallable(
  callableSymbols: ReadonlyMap<string, Array<{ name: string; line: number }>>,
  filePath: string,
  line: number
): string | undefined {
  const symbols = callableSymbols.get(normalizeRelativePath(filePath));
  if (!symbols?.length) return undefined;

  let low = 0;
  let high = symbols.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (symbols[middle].line <= line) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return undefined;

  let candidate = low - 1;
  while (candidate > 0 && symbols[candidate - 1].line === symbols[candidate].line) candidate--;
  return symbols[candidate].name;
}

function compilerEvidence(filePath: string, line: number): EvidenceMetadata {
  return {
    source: "typescript-checker",
    confidence: 1,
    evidencePath: normalizeRelativePath(filePath),
    evidenceLine: line,
    extractorVersion: "typescript-semantic:v1"
  };
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kilobytes = value / 1024;
  if (kilobytes < 1024)
    return `${Number.isInteger(kilobytes) ? kilobytes : kilobytes.toFixed(1)} KiB`;
  const megabytes = kilobytes / 1024;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MiB`;
}

function fullIncrementalPlan(intelligence: RepoIntelligence): IncrementalUpdatePlan {
  const changes = intelligence.files.map((file) => ({ path: file.path, kind: "added" as const }));
  return {
    action: "full",
    changes,
    filesToAnalyze: changes.map((change) => change.path),
    rerunGraph: true,
    rerunArchitecture: true,
    reason: "Incremental planning failed; a full rebuild plan was used."
  };
}

function emptyRepositoryEvolution(incremental: IncrementalUpdatePlan): RepositoryEvolution {
  return {
    changes: incremental.changes.reduce(
      (counts, change) => ({ ...counts, [change.kind]: counts[change.kind] + 1 }),
      { unchanged: 0, implementation: 0, structural: 0, added: 0, deleted: 0 }
    ),
    coupling: [],
    commitsAnalyzed: 0,
    degraded: true,
    warnings: ["Repository evolution analysis was unavailable."]
  };
}

function emptyRuntimeVerification(): RuntimeVerification {
  return {
    evidence: [],
    correlations: [],
    validationCommands: [],
    degraded: true,
    warnings: ["Runtime verification was unavailable."]
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

async function readSnapshot(
  root: string,
  onWarning?: (message: string) => void
): Promise<RepositoryIntelligenceSnapshot | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(root, STORE, "snapshot.json"), "utf8")
    ) as RepositoryIntelligenceSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      onWarning?.(`Could not read the previous intelligence snapshot: ${errorMessage(error)}.`);
    return undefined;
  }
}
async function writeJson(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  const temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

async function executeStage(
  definition: StageDefinition,
  context: StageContext,
  previous: Map<IntelligenceStageId, IntelligenceStageResult>,
  workerPath: string,
  options: IntelligencePipelineOptions,
  completedStages: number,
  onWarning: (message: string) => void
): Promise<IntelligenceStageResult> {
  const stageStarted = new Date();
  const order = STAGES.indexOf(definition) + 1;
  const stageContext = { ...context, previous };
  try {
    const projection = existsSync(workerPath)
      ? await runStageInWorker(
          workerPath,
          definition.id,
          serializeStageContext(stageContext, definition.id),
          options.signal
        )
      : await definition.analyze(stageContext);
    const completedAt = new Date();
    const items = projection.items ?? [];
    return {
      id: definition.id,
      order,
      label: definition.label,
      family: definition.family,
      status: "complete",
      startedAt: stageStarted.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - stageStarted.getTime(),
      itemCount: items.length,
      summary: projection.summary,
      items,
      metrics: projection.metrics ?? {},
      cognitivelyEnriched: Boolean(definition.cognitive)
    };
  } catch (error) {
    if (options.signal?.aborted) throw new IntelligencePipelineCancelledError(definition.id);
    const completedAt = new Date();
    const message = `${definition.label} failed; continuing with remaining intelligence stages: ${errorMessage(error)}.`;
    onWarning(message);
    return {
      id: definition.id,
      order,
      label: definition.label,
      family: definition.family,
      status: "failed",
      startedAt: stageStarted.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - stageStarted.getTime(),
      itemCount: 0,
      summary: "Stage failed.",
      items: [],
      metrics: { workerPoolCompletedBeforeFailure: completedStages },
      cognitivelyEnriched: false,
      error: errorMessage(error)
    };
  }
}

function serializeStageContext(
  context: StageContext,
  stageId: IntelligenceStageId
): SerializedStageContext {
  return {
    root: context.root,
    persist: context.persist,
    intelligence: projectIntelligenceForStage(context.intelligence, stageId),
    graph: projectGraphForStage(context.graph, stageId),
    runtime: context.runtime,
    semantic:
      stageId === "code-property-graph" ? context.semantic : emptyTypeScriptSemanticResult(),
    evolution: context.evolution,
    deadCode: context.deadCode,
    previous: [...context.previous.entries()]
  };
}

function projectIntelligenceForStage(
  intelligence: RepoIntelligence,
  stageId: IntelligenceStageId
): RepoIntelligence {
  const projected = emptyRepoIntelligence(intelligence.workspaceRoot);
  projected.indexedAt = intelligence.indexedAt;

  switch (stageId) {
    case "structural":
    case "build-script":
    case "configuration":
    case "data-persistence":
    case "sdlc-workflow":
    case "documentation":
    case "runtime-observability":
      projected.files = intelligence.files;
      break;
    case "language-framework":
      projected.files = intelligence.files;
      projected.frameworkHints = intelligence.frameworkHints;
      break;
    case "symbol":
      projected.files = intelligence.files;
      projected.symbols = intelligence.symbols;
      break;
    case "dependency":
      projected.dependencies = intelligence.dependencies;
      break;
    case "api-route":
      projected.apis = intelligence.apis;
      break;
    case "test":
      projected.files = intelligence.files;
      projected.tests = intelligence.tests;
      break;
    case "code-property-graph":
    case "context":
      projected.files = intelligence.files;
      projected.tests = intelligence.tests;
      break;
    case "architecture":
      projected.frameworkHints = intelligence.frameworkHints;
      projected.services = intelligence.services;
      break;
    case "risk":
      projected.securitySensitiveAreas = intelligence.securitySensitiveAreas;
      projected.performanceSensitivePaths = intelligence.performanceSensitivePaths;
      projected.modernizationCandidates = intelligence.modernizationCandidates;
      break;
    case "git-change":
    case "impact":
    case "security":
    case "performance":
      break;
  }
  return projected;
}

function projectGraphForStage(
  graph: RepositoryGraphAnalysis,
  stageId: IntelligenceStageId
): SerializedStageContext["graph"] {
  if (stageId === "call-graph" || stageId === "impact" || stageId === "context") {
    return {
      localEdges: graph.localEdges,
      hubs: graph.hubs,
      entryPoints: graph.entryPoints,
      orphanSourceFiles: graph.orphanSourceFiles,
      cycles: graph.cycles,
      communities: graph.communities,
      flows: graph.flows
    };
  }

  return {
    localEdges: [],
    hubs: [],
    entryPoints: stageId === "architecture" ? graph.entryPoints : [],
    orphanSourceFiles: stageId === "risk" ? graph.orphanSourceFiles : [],
    cycles: stageId === "architecture" || stageId === "risk" ? graph.cycles : [],
    communities: stageId === "architecture" ? graph.communities : [],
    flows: stageId === "architecture" ? graph.flows : []
  };
}

const STAGES: StageDefinition[] = [
  stage("structural", "Structural Intelligence", "repository-structure", ({ intelligence }) => {
    const roots = unique(intelligence.files.map((file) => file.path.split("/")[0]));
    return {
      summary: `${intelligence.files.length} files across ${roots.length} repository roots.`,
      items: roots,
      metrics: {
        files: intelligence.files.length,
        generated: intelligence.files.filter((file) => file.isGenerated).length,
        roots: roots.length
      }
    };
  }),
  stage(
    "language-framework",
    "Language & Framework Intelligence",
    "repository-structure",
    ({ intelligence }) => {
      const languages = unique(intelligence.files.map((file) => file.language).filter(Boolean));
      return {
        summary: `${languages.length} languages and ${intelligence.frameworkHints.length} framework signals detected.`,
        items: [...languages, ...intelligence.frameworkHints],
        metrics: { languages: languages.length, frameworks: intelligence.frameworkHints.length }
      };
    }
  ),
  stage(
    "build-script",
    "Build & Script Intelligence",
    "build-test-qa",
    async ({ root, intelligence }) => {
      const manifests = pathsMatching(
        intelligence,
        /(^|\/)(package\.json|pom\.xml|build\.gradle|Cargo\.toml|pyproject\.toml|Makefile)$/i
      );
      const pkg = await readJsonFile(root, "package.json");
      const scripts =
        pkg?.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : [];
      return {
        summary: `${manifests.length} build manifests and ${scripts.length} root scripts detected.`,
        items: [...manifests, ...scripts.map((value) => `script:${value}`)],
        metrics: { manifests: manifests.length, scripts: scripts.length }
      };
    }
  ),
  stage(
    "configuration",
    "Configuration Intelligence",
    "repository-structure",
    ({ intelligence }) => {
      const configs = pathsMatching(
        intelligence,
        /(^|\/)(tsconfig|vite|eslint|prettier|\.env|\.github|\.vscode|docker|k8s|helm|config)/i
      );
      return {
        summary: `${configs.length} configuration artifacts indexed.`,
        items: configs,
        metrics: { configs: configs.length }
      };
    }
  ),
  stage("symbol", "Symbol Intelligence", "code-graph", ({ intelligence }) => ({
    summary: `${intelligence.symbols.length} code symbols indexed.`,
    items: intelligence.symbols
      .slice(0, 100)
      .map((symbol) => `${symbol.kind}:${symbol.name} — ${symbol.filePath}:${symbol.line}`),
    metrics: {
      symbols: intelligence.symbols.length,
      exported: intelligence.symbols.filter((symbol) => symbol.exportStatus === "exported").length
    }
  })),
  stage("dependency", "Dependency Intelligence", "code-graph", ({ intelligence }) => ({
    summary: `${intelligence.dependencies.length} dependency edges indexed.`,
    items: intelligence.dependencies.slice(0, 100).map((edge) => `${edge.from} → ${edge.to}`),
    metrics: {
      dependencies: intelligence.dependencies.length,
      packages: intelligence.dependencies.filter((edge) => edge.kind === "package").length
    }
  })),
  stage("api-route", "API / Route Intelligence", "code-graph", ({ intelligence }) => ({
    summary: `${intelligence.apis.length} API and route endpoints indexed.`,
    items: intelligence.apis.map(
      (api) => `${api.method} ${api.path} — ${api.filePath}:${api.line}`
    ),
    metrics: { endpoints: intelligence.apis.length }
  })),
  stage(
    "data-persistence",
    "Data & Persistence Intelligence",
    "architecture-sdlc",
    ({ intelligence }) => {
      const items = pathsMatching(
        intelligence,
        /(schema|migration|model|entity|repository|dao|database|prisma|sequelize|typeorm|drizzle|sql)/i
      );
      return {
        summary: `${items.length} persistence-related artifacts detected.`,
        items,
        metrics: { artifacts: items.length }
      };
    }
  ),
  stage("test", "Test Intelligence", "build-test-qa", ({ intelligence }) => ({
    summary: `${intelligence.tests.length} test-to-source mappings indexed.`,
    items: intelligence.tests.map(
      (test) => `${test.testFile}${test.targetFile ? ` → ${test.targetFile}` : ""}`
    ),
    metrics: {
      tests: intelligence.files.filter((file) => file.isTest).length,
      mappings: intelligence.tests.length
    }
  })),
  stage("call-graph", "Call Graph Intelligence", "code-graph", ({ graph }) => ({
    summary: `${graph.localEdges.length} resolved file-flow edges across ${graph.communities.length} communities and ${graph.flows.length} entry-point flows.`,
    items: [
      ...graph.hubs.slice(0, 20).map((hub) => `hub:${hub.path} — degree ${hub.degree}`),
      ...graph.cycles.slice(0, 10).map((cycle) => `cycle:${cycle.join(" → ")}`)
    ],
    metrics: {
      edges: graph.localEdges.length,
      hubs: graph.hubs.length,
      cycles: graph.cycles.length,
      entryPoints: graph.entryPoints.length,
      communities: graph.communities.length,
      executionFlows: graph.flows.length,
      orphanSourceFiles: graph.orphanSourceFiles.length
    }
  })),
  stage(
    "code-property-graph",
    "Code Property Graph Intelligence",
    "code-graph",
    async ({ root, persist, intelligence, semantic }) => {
      const eligible = intelligence.files.filter((file) => !file.isGenerated);
      let nodes = 0;
      let astEdges = 0;
      let eogEdges = 0;
      let cfgEdges = 0;
      let dfgEdges = 0;
      let cdgEdges = 0;
      const items: string[] = [];
      const shardStore = persist ? new CpgShardStore(root) : undefined;
      const bindings = persist ? await new OkfSnapshotStore(root).readCpgBindings() : [];
      const fileBindingByPath = new Map<string, string>();
      const symbolBindingByPathLine = new Map<string, string>();
      const symbolBindingByPathLineName = new Map<string, string>();
      for (const binding of bindings) {
        if (binding.symbol && binding.line !== undefined) {
          const pathLine = `${binding.path}\0${binding.line}`;
          if (!symbolBindingByPathLine.has(pathLine))
            symbolBindingByPathLine.set(pathLine, binding.okfId);
          symbolBindingByPathLineName.set(`${pathLine}\0${binding.symbol}`, binding.okfId);
          continue;
        }
        if (!fileBindingByPath.has(binding.path))
          fileBindingByPath.set(binding.path, binding.okfId);
      }
      const resolveOkfId = (
        sourcePath: string,
        line: number,
        name?: string
      ): string | undefined => {
        const pathLine = `${sourcePath}\0${line}`;
        return (
          (name
            ? symbolBindingByPathLineName.get(`${pathLine}\0${name}`)
            : symbolBindingByPathLine.get(pathLine)) ?? fileBindingByPath.get(sourcePath)
        );
      };
      for (const file of eligible) {
        const content = await fs.readFile(path.join(root, file.path), "utf8");
        const resolver = (location: { startLine: number }, name?: string) =>
          resolveOkfId(file.path, location.startLine, name);
        const graph = /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path)
          ? buildTypeScriptCpg({ sourcePath: file.path, content, resolveOkfId: resolver })
          : buildUniversalCpg({
              sourcePath: file.path,
              content,
              language: file.language,
              resolveOkfId: resolver
            });
        nodes += graph.nodes.length;
        astEdges += graph.edges.filter((edge) => edge.kind === "ast").length;
        eogEdges += graph.edges.filter((edge) => edge.kind === "eog").length;
        cfgEdges += graph.edges.filter((edge) => edge.kind === "cfg").length;
        dfgEdges += graph.edges.filter((edge) => edge.kind === "dfg").length;
        cdgEdges += graph.edges.filter((edge) => edge.kind === "cdg").length;
        if (items.length < 100)
          items.push(`${file.path}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
        if (shardStore) await shardStore.put(graph);
      }
      const shardResult = shardStore ? await shardStore.finalize() : undefined;
      items.unshift(
        ...semantic.calls
          .slice(0, Math.max(0, 100 - items.length))
          .map(
            (call) =>
              `call:${call.sourcePath}:${call.sourceLine} → ${call.targetPath}:${call.targetLine}`
          )
      );
      items.unshift(
        ...semantic.relationships
          .slice(0, Math.max(0, 100 - items.length))
          .map((item) => `${item.kind}:${item.sourceName} → ${item.targetName}`)
      );
      items.unshift(
        ...semantic.callbacks
          .slice(0, Math.max(0, 100 - items.length))
          .map((item) => `callback:${item.registrar} → ${item.callback}`)
      );
      return {
        summary: `${eligible.length} text artifacts indexed into CPG projections; TypeScript/JavaScript use the compiler frontend and other languages use deterministic structural frontends, with ${semantic.calls.length} type-bound TS/JS calls.`,
        items,
        metrics: {
          eligibleFiles: eligible.length,
          indexedFiles: eligible.length,
          nodes,
          astEdges,
          eogEdges,
          cfgEdges,
          dfgEdges,
          cdgEdges,
          shardsWritten: shardResult?.written ?? 0,
          shardsReused: shardResult?.reused ?? 0,
          shardsDeleted: shardResult?.deleted ?? 0,
          semanticFiles: semantic.files,
          configuredSemanticFiles: semantic.configuredFiles,
          fallbackSemanticFiles: semantic.fallbackFiles,
          boundCalls: semantic.calls.length,
          typeRelationships: semantic.relationships.length,
          callbackEdges: semantic.callbacks.length,
          unresolvedCalls: semantic.unresolvedCalls,
          compilerDiagnostics: semantic.diagnostics,
          configuredCompilerDiagnostics: semantic.configuredDiagnostics,
          fallbackCompilerDiagnostics: semantic.fallbackDiagnostics,
          diagnosticCodes: JSON.stringify(semantic.diagnosticCodes),
          diagnosticMode: "syntax-options",
          typeResolution: true,
          cfg: true,
          dfg: true,
          cdg: true
        }
      };
    }
  ),
  stage(
    "architecture",
    "Architecture Intelligence",
    "architecture-sdlc",
    ({ intelligence, graph }) => ({
      summary: `${intelligence.services.length} service boundaries, ${graph.communities.length} file communities, and ${graph.flows.length} entry-point flows describe the current architecture.`,
      items: [
        ...intelligence.services.map((service) => `${service.name} — ${service.filePath}`),
        ...graph.entryPoints.map((file) => `entry:${file}`),
        ...graph.communities
          .slice(0, 10)
          .map((community) => `${community.id} — ${community.files.length} files`),
        ...intelligence.frameworkHints
      ],
      metrics: {
        services: intelligence.services.length,
        frameworks: intelligence.frameworkHints.length,
        entryPoints: graph.entryPoints.length,
        communities: graph.communities.length,
        executionFlows: graph.flows.length,
        cycles: graph.cycles.length
      }
    }),
    true
  ),
  stage(
    "git-change",
    "Git & Change Intelligence",
    "repository-structure",
    async ({ root, evolution }) => {
      try {
        const git = new GitReadOnly(root);
        const [branch, changed] = await Promise.all([git.branch(), git.status()]);
        const files = changed
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(2).trim());
        return {
          summary: `${files.length} changed files on ${branch.trim() || "detached HEAD"} with ${evolution.coupling.length} historical co-change pairs.`,
          items: [
            ...files,
            ...evolution.coupling
              .slice(0, 20)
              .map((pair) => `coupled:${pair.fileA} ↔ ${pair.fileB} (${pair.commits})`)
          ],
          metrics: {
            branch: branch.trim() || "detached",
            changedFiles: files.length,
            commitsAnalyzed: evolution.commitsAnalyzed,
            couplingPairs: evolution.coupling.length,
            structuralChanges: evolution.changes.structural,
            deletedFiles: evolution.changes.deleted
          }
        };
      } catch {
        return {
          summary: "Git metadata is unavailable.",
          items: [],
          metrics: {
            branch: "unavailable",
            changedFiles: 0,
            commitsAnalyzed: evolution.commitsAnalyzed,
            couplingPairs: evolution.coupling.length,
            structuralChanges: evolution.changes.structural,
            deletedFiles: evolution.changes.deleted
          }
        };
      }
    }
  ),
  stage(
    "impact",
    "Impact Intelligence",
    "architecture-sdlc",
    ({ graph, previous }) => {
      const changed = (previous.get("git-change")?.items ?? []).filter(
        (item) => !item.startsWith("coupled:")
      );
      const impact = graph.impactedBy(changed);
      return {
        summary: `${changed.length} changed files transitively impact ${impact.files.length} files and ${impact.tests.length} mapped tests.`,
        items: [
          ...impact.files.slice(0, 80),
          ...impact.tests.slice(0, 20).map((test) => `test:${test}`)
        ],
        metrics: {
          changedFiles: changed.length,
          impactedFiles: impact.files.length,
          impactedTests: impact.tests.length,
          traversalDepth: impact.depth
        }
      };
    },
    true
  ),
  stage(
    "context",
    "Context Intelligence",
    "context-token",
    ({ intelligence, graph, previous }) => {
      const changed = (previous.get("git-change")?.items ?? []).filter(
        (item) => !item.startsWith("coupled:")
      );
      const impact = graph.impactedBy(changed);
      const selected = changed.length
        ? impact.files.slice(0, 100)
        : unique([...graph.entryPoints, ...graph.hubs.map((hub) => hub.path)]).slice(0, 20);
      const raw = intelligence.files.reduce((sum, file) => sum + file.lineCount * 3, 0);
      const packed = selected.reduce(
        (sum, item) =>
          sum + (intelligence.files.find((file) => file.path === item)?.lineCount ?? 0) * 3,
        0
      );
      return {
        summary: `${selected.length} graph-ranked files selected with an estimated ${Math.max(0, Math.round((1 - packed / Math.max(raw, 1)) * 100))}% context reduction.`,
        items: selected,
        metrics: {
          selectedFiles: selected.length,
          rawTokens: raw,
          estimatedTokens: packed,
          graphRanked: true
        }
      };
    },
    true
  ),
  stage(
    "sdlc-workflow",
    "SDLC Workflow Intelligence",
    "architecture-sdlc",
    ({ intelligence }) => {
      const items = pathsMatching(
        intelligence,
        /(^|\/)(\.github\/workflows|Jenkinsfile|azure-pipelines|gitlab-ci|Dockerfile|deploy|release|pipeline)/i
      );
      return {
        summary: `${items.length} build, CI, release, and deployment workflow artifacts detected.`,
        items,
        metrics: { workflows: items.length }
      };
    },
    true
  ),
  stage(
    "risk",
    "Risk Intelligence",
    "architecture-sdlc",
    ({ intelligence, graph, deadCode }) => {
      const structural = [
        ...graph.cycles.map((cycle) => `dependency cycle: ${cycle.join(" → ")}`),
        ...graph.orphanSourceFiles.map((file) => `orphan source: ${file}`),
        ...deadCode.map((item) => `possible dead code: ${item.filePath}:${item.line} ${item.name}`)
      ];
      const items = [
        ...intelligence.securitySensitiveAreas,
        ...intelligence.performanceSensitivePaths,
        ...intelligence.modernizationCandidates,
        ...structural
      ];
      return {
        summary: `${items.length} combined code, structural, security, performance, and modernization risk signals detected.`,
        items: items.slice(0, 100),
        metrics: {
          security: intelligence.securitySensitiveAreas.length,
          performance: intelligence.performanceSensitivePaths.length,
          modernization: intelligence.modernizationCandidates.length,
          dependencyCycles: graph.cycles.length,
          orphanSourceFiles: graph.orphanSourceFiles.length,
          deadCodeCandidates: deadCode.length
        }
      };
    },
    true
  ),
  stage("security", "Security Intelligence", "architecture-sdlc", ({ intelligence }) => ({
    summary: `${intelligence.securitySensitiveAreas.length} security-sensitive areas require policy-aware handling.`,
    items: intelligence.securitySensitiveAreas.slice(0, 100),
    metrics: { sensitiveAreas: intelligence.securitySensitiveAreas.length }
  })),
  stage("performance", "Performance Intelligence", "architecture-sdlc", ({ intelligence }) => ({
    summary: `${intelligence.performanceSensitivePaths.length} performance-sensitive paths detected.`,
    items: intelligence.performanceSensitivePaths.slice(0, 100),
    metrics: { sensitivePaths: intelligence.performanceSensitivePaths.length }
  })),
  stage(
    "documentation",
    "Documentation Intelligence",
    "context-token",
    ({ intelligence }) => {
      const items = pathsMatching(
        intelligence,
        /(^|\/)(README|docs?\/|CHANGELOG|CONTRIBUTING|ADR|\.md$)/i
      );
      return {
        summary: `${items.length} documentation and decision artifacts indexed.`,
        items,
        metrics: { documents: items.length }
      };
    },
    true
  ),
  stage(
    "runtime-observability",
    "Runtime / Observability Intelligence",
    "runtime-analysis",
    ({ intelligence, runtime }) => {
      const items = pathsMatching(
        intelligence,
        /(telemetry|observability|metric|trace|logging|logger|opentelemetry|sentry|prometheus|health)/i
      );
      return {
        summary: `${items.length} integration points and ${runtime.evidence.length} mapped runtime signals produce ${runtime.correlations.length} static/runtime correlations.`,
        items: [...items, ...runtime.evidence.map((item) => `${item.kind}:${item.signal}`)],
        metrics: {
          integrationPoints: items.length,
          runtimeEvidence: runtime.evidence.length,
          correlations: runtime.correlations.length,
          degraded: runtime.degraded
        }
      };
    }
  )
];

if (STAGES.map((value) => value.id).join("|") !== INTELLIGENCE_STAGES.join("|"))
  throw new Error("Intelligence stage definitions do not match canonical execution order.");
