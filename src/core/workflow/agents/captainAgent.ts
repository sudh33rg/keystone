import { QaAgent } from "./qaAgent";
import { ModernizationAgent } from "./modernizationAgent";
import { PerformanceAgent } from "./performanceAgent";
import { PrEvidenceAgent } from "./prEvidenceAgent";
import { SecurityAgent } from "./securityAgent";
import {
  buildIntentContextPack,
  type ContextBuildOptions
} from "../../context/intentContextBuilder";
import { classifyIntent } from "../../context/IntentClassifier";
import { routeIntent } from "../../context/routing/intentRouter";
import { MetricsStore } from "../../platform/metrics/metricsStore";
import type { DeveloperIntent, KeystoneRunResult, RepoIntelligence } from "../../domain/types";
import { discoverCopilotCustomizations } from "../../context/copilotCustomizations";
import { selectCanonicalContext } from "../../intelligence/okf/canonicalContext";

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
  async run(
    intent: DeveloperIntent,
    intelligence: RepoIntelligence,
    contextOptions: ContextBuildOptions = {}
  ): Promise<KeystoneRunResult> {
    const analysis = await stage("intent classification", () => classifyIntent(intent));
    const routeDecision = routeIntent(analysis);
    const customizations = await stage("Copilot customization discovery", () =>
      discoverCopilotCustomizations(intent.workspaceRoot)
    );
    let okfSnapshot = contextOptions.okfSnapshot;
    const contextPack = await stage("context engineering", () =>
      buildIntentContextPack(
        intent,
        intelligence,
        routeDecision,
        customizations.skills,
        contextOptions
      )
    );
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
      qa,
      security,
      performance,
      modernization,
      prEvidence,
      metrics
    };
  }
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
