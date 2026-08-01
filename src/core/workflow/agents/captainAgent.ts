import { QaAgent } from "./qaAgent";
import { ModernizationAgent } from "./modernizationAgent";
import { PerformanceAgent } from "./performanceAgent";
import { PrEvidenceAgent } from "./prEvidenceAgent";
import { SecurityAgent } from "./securityAgent";
import { buildIntentContextPack, type ContextBuildOptions } from "../../context/intentContextBuilder";
import { classifyIntent } from "../../context/IntentClassifier";
import { routeIntent } from "../../context/routing/intentRouter";
import { MetricsStore } from "../../platform/metrics/metricsStore";
import type { DeveloperIntent, KeystoneRunResult, RepoIntelligence } from "../../domain/types";
import { discoverCopilotCustomizations } from '../../context/copilotCustomizations';

/**
 * CaptainAgent orchestrates the intent analysis pipeline.
 *
 * Error handling: each sub-agent call is wrapped in safeRun() so a single
 * failure in one deterministic analysis stage does not abort the entire run.
 * The outer try/catch catches catastrophic failures and returns a degraded result.
 */
export class CaptainAgent {
  async run(intent: DeveloperIntent, intelligence: RepoIntelligence, contextOptions: ContextBuildOptions = {}): Promise<KeystoneRunResult> {
    try {
      const analysis = await classifyIntent(intent);
      const routeDecision = routeIntent(analysis);
      const customizations = await discoverCopilotCustomizations(intent.workspaceRoot);
      const skills = customizations.skills;
      const contextPack = await this.safeRun(
        () => buildIntentContextPack(intent, intelligence, routeDecision, skills, contextOptions),
        null as any,
      );
      const qa = this.safeRunSync(() => new QaAgent().analyze(contextPack, intelligence), null as any);
      const security = this.safeRunSync(() => new SecurityAgent().analyze(contextPack), null as any);
      const performance = this.safeRunSync(() => new PerformanceAgent().analyze(contextPack), null as any);
      const modernization = this.safeRunSync(() => new ModernizationAgent().assess(contextPack), null as any);
      const prEvidence = this.safeRunSync(
        () => new PrEvidenceAgent().generate(contextPack, qa, security, performance, modernization),
        null as any,
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
        prEvidence,
      );
      await this.safeRun(() => new MetricsStore(intent.workspaceRoot).append(metrics), undefined);

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
        metrics,
      };
    } catch (err) {
      // Catastrophic failure: return a degraded result with warnings
      const msg = err instanceof Error ? err.message : String(err);
      return {
        intent,
        intentAnalysis: await classifyIntent(intent),
        routeDecision: {
          selectedRoute: "human-review",
          confidence: 0.3,
          reason: `Run failed: ${msg}`,
          steps: [],
          estimatedTokenSaving: 0,
          requiredApprovals: [],
          risks: ["Run failed"],
          fallbackPath: "human-review",
        },
        intelligence,
        contextPack: null as any,
        qa: null as any,
        security: null as any,
        performance: null as any,
        modernization: null as any,
        prEvidence: null as any,
        metrics: null as any,
      };
    }
  }

  /**
   * Run an async sub-agent call with error isolation.
   */
  private async safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fallback;
    }
  }

  /**
   * Run a sync sub-agent call with error isolation.
   */
  private safeRunSync<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fallback;
    }
  }
}
