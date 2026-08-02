import { METRICS_FILE } from "../config/defaults";
import { JsonStorage } from "../storage/jsonStorage";
import type {
  ContextPack,
  IntentAnalysis,
  KeystoneMetrics,
  ModernizationAssessment,
  PerformanceAnalysis,
  PrEvidence,
  QaAnalysis,
  RouteDecision,
  SecurityAnalysis
} from "../../domain/types";

export class MetricsStore extends JsonStorage<KeystoneMetrics[]> {
  constructor(workspaceRoot: string) {
    super(workspaceRoot, METRICS_FILE, []);
  }

  async append(metric: KeystoneMetrics): Promise<void> {
    const metrics = await this.read();
    metrics.push(metric);
    await this.write(metrics);
  }

  static fromRun(
    taskId: string,
    analysis: IntentAnalysis,
    route: RouteDecision,
    pack: ContextPack,
    qa: QaAnalysis,
    security: SecurityAnalysis,
    performance: PerformanceAnalysis,
    modernization: ModernizationAssessment,
    prEvidence: PrEvidence
  ): KeystoneMetrics {
    return {
      taskId,
      intentType: analysis.intentType,
      selectedRoute: route.selectedRoute,
      copilotRecommended: route.selectedRoute === "copilot" || route.selectedRoute === "hybrid",
      copilotPromptGenerated: pack.copilotPrompt.length > 0,
      estimatedRawTokens: pack.estimatedRawTokens,
      estimatedPackedTokens: pack.estimatedPackedTokens,
      estimatedTokenReductionPercentage: pack.estimatedReductionPercent,
      contextPackSize: pack.copilotPrompt.length,
      filesIncluded: pack.relevantFiles.length,
      filesExcluded: Math.max(0, pack.estimatedRawTokens - pack.relevantFiles.length),
      qaConfidence: qa.coverageConfidence,
      impactedTestsCount: qa.impactedTests.length,
      missingTestAreasCount: qa.missingTestAreas.length,
      securityRiskLevel: security.riskLevel,
      performanceRiskLevel: performance.riskLevel,
      modernizationRiskLevel: modernization.riskLevel,
      prEvidenceGenerated: prEvidence.markdown.length > 0,
      userApprovedRoute: false,
      userCopiedPrompt: false,
      userRegeneratedContext: false,
      createdAt: new Date().toISOString()
    };
  }
}
