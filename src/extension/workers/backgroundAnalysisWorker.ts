import fs from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createGapAnalyzer } from "@core/workflow/quality/qaGapAnalysis";
import {
  analyzeRepositoryPerformance,
  analyzeRepositorySecurity
} from "@core/intelligence/analysis";
import { RepositoryModelBuilder } from "@core/intelligence/repository/model-builder";
import { ModernizationPlatformApi } from "@core/workflow/modernization/modernization-api";
import type { RepoIntelligence } from "@core/domain/types";
import type { RepositoryIntelligenceSnapshot } from "@core/intelligence/pipeline/types";
import type { OkfCanonicalEvidenceEnvelope } from "@core/intelligence/okf/types";
import type { BackgroundWorkerInput } from "../core/backgroundWorkerCoordinator";

type WorkerKind = "qa" | "security" | "performance" | "modernization";
const input = workerData as BackgroundWorkerInput & {
  kind: WorkerKind;
  workerId: string;
  startedAt: string;
  attempt: number;
  maxAttempts: number;
};

async function persist(name: string, value: unknown): Promise<void> {
  const target = path.join(input.root, ".keystone", "background", `${name}.json`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = JSON.parse(await fs.readFile(target, "utf8")) as {
      snapshotDigest?: string;
      startedAt?: string;
    };
    if (
      existing.snapshotDigest &&
      (existing.snapshotDigest !== input.snapshotDigest ||
        (existing.startedAt && Date.parse(existing.startedAt) > Date.parse(input.startedAt)))
    )
      return;
  } catch {
    // The record may not exist yet; the atomic write below creates it.
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function run(): Promise<unknown> {
  const snapshot = await readSnapshot(input.snapshotPath);
  if (!snapshot?.intelligence) {
    throw new Error("No promoted repository intelligence snapshot is available for the worker.");
  }
  const canonicalEvidence = input.canonicalEvidence[input.kind];
  const result =
    input.kind === "qa"
      ? await createGapAnalyzer({
          workspaceRoot: input.root,
          config: { scopePaths: canonicalEvidence.paths }
        }).analyzeQuick({ changedPaths: [...canonicalEvidence.paths] })
      : input.kind === "security"
        ? await analyzeRepositorySecurity(input.root, { scopePaths: canonicalEvidence.paths })
        : input.kind === "performance"
          ? await analyzeRepositoryPerformance(input.root, { scopePaths: canonicalEvidence.paths })
          : await runModernization(input.root, snapshot.intelligence);
  return withCanonicalEvidence(result, canonicalEvidence);
}

function withCanonicalEvidence(
  result: unknown,
  canonicalEvidence: OkfCanonicalEvidenceEnvelope
): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return { ...(result as Record<string, unknown>), canonicalEvidence };
}

async function runModernization(root: string, intelligence: RepoIntelligence): Promise<unknown> {
  const builder = new RepositoryModelBuilder();
  const repository = builder.buildFromIntelligence(root, intelligence);
  return new ModernizationPlatformApi().propose({
    repository,
    scanScope: {
      expectedFiles: intelligence.files.length,
      indexedFiles: intelligence.files.length,
      excludedPaths: []
    }
  });
}

async function readSnapshot(file: string): Promise<RepositoryIntelligenceSnapshot | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as RepositoryIntelligenceSnapshot;
  } catch {
    return undefined;
  }
}

void run()
  .then(async (result) => {
    const completedAt = new Date().toISOString();
    const durationMs = Date.parse(completedAt) - Date.parse(input.startedAt);
    const persisted = {
      ...(result && typeof result === "object" && !Array.isArray(result) ? result : { result }),
      kind: input.kind,
      workerStatus: "complete",
      workerId: input.workerId,
      snapshotDigest: input.snapshotDigest,
      extractionRunId: input.extractionRunId,
      scopePaths: input.canonicalEvidence[input.kind].paths,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      retryCount: input.attempt - 1,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      generatedAt: completedAt
    };
    await persist(input.kind, persisted);
    parentPort?.postMessage({
      kind: input.kind,
      status: "complete",
      result: persisted,
      completedAt,
      durationMs
    });
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date().toISOString();
    const durationMs = Date.parse(completedAt) - Date.parse(input.startedAt);
    await persist(input.kind, {
      kind: input.kind,
      workerStatus: "failed",
      error: message,
      workerId: input.workerId,
      snapshotDigest: input.snapshotDigest,
      extractionRunId: input.extractionRunId,
      scopePaths: input.canonicalEvidence[input.kind].paths,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      retryCount: input.attempt - 1,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      generatedAt: completedAt
    }).catch(() => undefined);
    parentPort?.postMessage({
      kind: input.kind,
      status: "failed",
      error: message,
      completedAt,
      durationMs
    });
  });
