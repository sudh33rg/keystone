import { QaAgent } from "./qaAgent";
import { ModernizationAgent } from "./modernizationAgent";
import { PerformanceAgent } from "./performanceAgent";
import { PrEvidenceAgent } from "./prEvidenceAgent";
import { SecurityAgent } from "./securityAgent";
import type { ContextBuildOptions } from "../../context/intentContextBuilder";
import {
  ContextEngine,
  operationForIntentType,
  type ContextEngineLogger,
  type ContextDiagnostic,
  type ContextLogEntry,
  type ContextUserContext,
  type ContextWorkspaceState,
  type ContextChangesState
} from "../../context/contextEngine";
import { classifyIntent } from "../../context/IntentClassifier";
import { routeIntent } from "../../context/routing/intentRouter";
import { MetricsStore } from "../../platform/metrics/metricsStore";
import type { DeveloperIntent, KeystoneRunResult, RepoIntelligence } from "../../domain/types";
import { discoverCopilotCustomizations } from "../../context/copilotCustomizations";
import { selectCanonicalContext } from "../../intelligence/okf/canonicalContext";
import type { IntentState } from "../../intent/intentState";

/**
 * Orchestrates one intent analysis from deterministic repository intelligence to a
 * bounded Copilot context packet and validation evidence.
 *
 * Core stages are intentionally fail-closed. Keystone must never return a
 * structurally invalid "successful" result containing null context/QA/security/
 * performance fields. A failed stage is surfaced to the UI with its exact stage
 * name; only telemetry persistence is best-effort.
 */
export class CaptainAgent {
  constructor(private readonly contextLogger?: ContextEngineLogger) {}

  async run(
    intent: DeveloperIntent,
    intelligence: RepoIntelligence,
    contextOptions: ContextBuildOptions = {},
    contextInputs: ContextPreparationInputs = {}
  ): Promise<KeystoneRunResult> {
    const analysis = await stage("intent classification", () => classifyIntent(intent));
    const routeDecision = routeIntent(analysis);
    const customizations = await stage("Copilot customization discovery", () =>
      discoverCopilotCustomizations(intent.workspaceRoot)
    );
    let okfSnapshot = contextOptions.okfSnapshot;
    const tokenBudget =
      contextOptions.delegationTokenBudget ??
      (contextOptions.compressionTier === "aggressive"
        ? 6_000
        : contextOptions.compressionTier === "off"
          ? 24_000
          : 6_000);
    const contextPreparation = await stage("context engineering", () =>
      new ContextEngine(intent.workspaceRoot, this.contextLogger).prepareContext({
        intent,
        objective: intent.text,
        operation: operationForIntentType(analysis.intentType),
        tokenBudget,
        intelligence,
        routeDecision,
        skills: customizations.skills,
        buildOptions: contextOptions,
        sourceRevision: contextOptions.okfSnapshot?.manifest.digests.snapshot,
        decisions: contextInputs.decisions,
        intentState: contextInputs.intentState,
        workspace: contextInputs.workspace,
        changes: contextInputs.changes,
        diagnostics: contextInputs.diagnostics,
        logs: contextInputs.logs,
        userContext: [
          ...(contextInputs.userContext ?? []),
          ...customizations.instructions.flatMap((instruction) =>
            instruction.guidance.map((content) => ({
              label: instruction.path,
              path: instruction.path,
              source: "repository-instruction",
              content
            }))
          )
        ]
      })
    );
    const contextPack = contextPreparation.contextPack;
    const canonicalTaskContext = okfSnapshot
      ? selectCanonicalContext(okfSnapshot, intent.text, {
          graphMode: "impact",
          graphLimit: 120,
          preferredPaths: contextPack.relevantFiles.map((file) => file.path)
        })
      : undefined;
    // The bounded canonical selection is sufficient for downstream task analysis. Release the
    // full snapshot reference before QA/security/performance/modernization continue.
    okfSnapshot = undefined;
    contextOptions.okfSnapshot = undefined;
    const qa = stageSync("task QA analysis", () =>
      new QaAgent().analyze(contextPack, intelligence, canonicalTaskContext)
    );
    const security = stageSync("task security analysis", () =>
      new SecurityAgent().analyze(contextPack, canonicalTaskContext)
    );
    const performance = stageSync("task performance analysis", () =>
      new PerformanceAgent().analyze(contextPack, canonicalTaskContext)
    );
    const modernization = stageSync("task modernization analysis", () =>
      new ModernizationAgent().assess(contextPack, canonicalTaskContext)
    );
    const prEvidence = stageSync("PR evidence generation", () =>
      new PrEvidenceAgent().generate(contextPack, qa, security, performance, modernization)
    );
    const metrics = MetricsStore.fromRun(
      intent.id,
      analysis,
      routeDecision,
      contextPack,
      qa,
      security,
      performance,
      modernization,
      prEvidence
    );
    try {
      await new MetricsStore(intent.workspaceRoot).append(metrics);
    } catch {
      /* Telemetry cannot invalidate engineering analysis. */
    }
    return {
      intent,
      intentAnalysis: analysis,
      routeDecision,
      intelligence,
      contextPack,
      contextPackage: contextPreparation.contextPackage,
      qa,
      security,
      performance,
      modernization,
      prEvidence,
      metrics
    };
  }
}

export interface ContextPreparationInputs {
  readonly decisions?: readonly string[];
  readonly intentState?: IntentState;
  readonly workspace?: ContextWorkspaceState;
  readonly changes?: ContextChangesState;
  readonly diagnostics?: readonly ContextDiagnostic[];
  readonly logs?: readonly ContextLogEntry[];
  readonly userContext?: readonly ContextUserContext[];
}

async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `Keystone intent analysis failed during ${name}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
function stageSync<T>(name: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new Error(
      `Keystone intent analysis failed during ${name}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
