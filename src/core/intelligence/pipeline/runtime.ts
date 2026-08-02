import fs from "node:fs/promises";
import path from "node:path";
import type { IntelligenceFinding } from "./findings";
import { detectValidationCommands } from "../../workflow/validation/validationCommands";

export interface RuntimeEvidence {
  readonly id: string;
  readonly kind: "trace" | "metric" | "log" | "test" | "deployment" | "unknown";
  readonly source: string;
  readonly filePath?: string;
  readonly signal: string;
}

export interface RuntimeVerification {
  readonly evidence: readonly RuntimeEvidence[];
  readonly correlations: ReadonlyArray<{
    findingId: string;
    evidenceIds: readonly string[];
    confidence: number;
  }>;
  readonly validationCommands: readonly string[];
  readonly degraded: boolean;
  readonly warnings: readonly string[];
}

export interface RemediationGateInput {
  readonly verification: RuntimeVerification;
  readonly affectedFiles: readonly string[];
  readonly approval: "required" | "granted";
  readonly maxAffectedFiles?: number;
}

export async function buildRuntimeVerification(
  root: string,
  findings: readonly IntelligenceFinding[]
): Promise<RuntimeVerification> {
  const warnings: string[] = [];
  const evidence = await readTelemetry(root, warnings);
  const validationCommands = await readValidationCommands(root);
  const correlations = findings.flatMap((finding) => {
    const matches = evidence.filter(
      (item) => finding.filePath && item.filePath === finding.filePath
    );
    return matches.length
      ? [
          {
            findingId: finding.id,
            evidenceIds: matches.map((item) => item.id),
            confidence: Math.min(1, finding.confidence + 0.2)
          }
        ]
      : [];
  });
  if (!evidence.length)
    warnings.push("No runtime telemetry mapping is available; conclusions are static-only.");
  if (!validationCommands.length) warnings.push("No supported validation commands were found.");
  return { evidence, correlations, validationCommands, degraded: warnings.length > 0, warnings };
}

export function evaluateRemediationGate(input: RemediationGateInput): {
  allowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.approval !== "granted") reasons.push("Explicit approval is required.");
  if (!input.verification.evidence.length) reasons.push("Runtime evidence is required.");
  if (!input.verification.validationCommands.length)
    reasons.push("At least one validation command is required.");
  if (!input.affectedFiles.length) reasons.push("The affected file scope is empty.");
  if (input.affectedFiles.length > (input.maxAffectedFiles ?? 20))
    reasons.push(`Affected scope exceeds ${input.maxAffectedFiles ?? 20} files.`);
  return { allowed: reasons.length === 0, reasons };
}

async function readTelemetry(root: string, warnings: string[]): Promise<RuntimeEvidence[]> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(root, ".keystone", "telemetry-map.json"), "utf8")
    ) as unknown;
    const items = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { mappings?: unknown }).mappings)
        ? (raw as { mappings: unknown[] }).mappings
        : [];
    return items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        id: String(item.id ?? `runtime-${index}`),
        kind: runtimeKind(item.behaviorType ?? item.kind),
        source: String(item.source ?? ".keystone/telemetry-map.json"),
        filePath:
          typeof item.sourcePath === "string"
            ? item.sourcePath
            : typeof item.filePath === "string"
              ? item.filePath
              : undefined,
        signal: String(item.signal ?? item.name ?? "runtime signal")
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warnings.push(
        `Runtime telemetry mapping could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    return [];
  }
}

async function readValidationCommands(root: string): Promise<string[]> {
  return (await detectValidationCommands(root)).all;
}

function runtimeKind(value: unknown): RuntimeEvidence["kind"] {
  return ["trace", "metric", "log", "test", "deployment"].includes(String(value))
    ? (String(value) as RuntimeEvidence["kind"])
    : "unknown";
}
