/**
 * CoverageGapService (spec §18) and QaRiskAssessmentService (spec §19).
 *
 * Both deterministic and explainable. Coverage gaps never fabricate runtime coverage:
 * when no coverage artifact is available, gaps are "unmapped" and explicitly labelled
 * (per §18 "Label it as an unmapped or unverified gap").
 */
import type { ChangeSet, CoverageGap, ImpactAnalysis } from "../../../shared/contracts/qaLifecycle";

export class CoverageGapService {
  detect(
    analysis: ImpactAnalysis,
    changeSet: ChangeSet,
    hasRuntimeCoverage: boolean,
  ): CoverageGap[] {
    const gaps: CoverageGap[] = [];
    const mappedTestEntities = new Set(analysis.tests.flatMap((t) => t.mappedEntityIds));

    for (const entity of analysis.entities) {
      const changed =
        entity.category === "changed-directly" ||
        changeSet.symbols.some((s) => s.symbolId === entity.entityId);
      const hasTest = mappedTestEntities.has(entity.entityId);
      if (changed && !hasTest) {
        gaps.push(
          gap({
            affectedEntityId: entity.entityId,
            gapType: "changed-symbol-no-test",
            risk: entity.isPublicContract ? "high" : "medium",
            layer: entity.productionTestClassification === "test" ? "unit" : "unit",
            scenario: `Add a test exercising ${entity.displayName} for the changed behaviour.`,
            testGen: !hasRuntimeCoverage ? entity.isPublicContract : true,
          }),
        );
      }
      if (entity.isPublicContract && !hasTest) {
        gaps.push(
          gap({
            affectedEntityId: entity.entityId,
            gapType: "public-contract-no-test",
            risk: "high",
            layer: "contract",
            scenario: `Add a contract test verifying the shape/behaviour of ${entity.displayName}.`,
            testGen: true,
          }),
        );
      }
      if (entity.category === "unresolved-possible-impact" && !hasTest) {
        gaps.push(
          gap({
            affectedEntityId: entity.entityId,
            gapType: "impacted-branch-no-test",
            risk: "medium",
            layer: "unit",
            scenario: `Add a test for the impacted branch ${entity.displayName}.`,
            testGen: false,
          }),
        );
      }
    }

    for (const flow of analysis.flows) {
      const hasIntegration = flow.relatedTestIds.length > 0;
      if (flow.changedStepEntityIds.length > 0 && !hasIntegration) {
        gaps.push(
          gap({
            affectedFlowId: flow.id,
            gapType: "affected-flow-no-integration-test",
            risk: "high",
            layer: "integration",
            scenario: `Add an integration test for flow ${flow.name}.`,
            testGen: true,
          }),
        );
      }
    }

    if (!hasRuntimeCoverage && analysis.entities.length > 0) {
      gaps.push({
        id: `gap:coverage-unavailable:${analysis.id}`,
        gapType: "runtime-coverage-unavailable",
        risk: "low",
        evidence: [],
        recommendedTestLayer: "unit",
        proposedScenarioSummary:
          "Runtime coverage artifact was not provided; gap detection is based on static mappings only.",
        testGenerationRecommended: false,
        verificationStatus: "unverified",
      });
    }
    return gaps;
  }
}

export class QaRiskAssessmentService {
  assess(
    analysis: ImpactAnalysis,
    gaps: CoverageGap[],
    changeSet: ChangeSet,
  ): {
    overallLevel: "low" | "medium" | "high" | "critical";
    score: number;
    factors: Array<{ id: string; description: string; weight: number; contribution: number }>;
  } {
    const factors: Array<{
      id: string;
      description: string;
      weight: number;
      contribution: number;
    }> = [];
    let score = 0;

    const changed = analysis.entities.filter(
      (e) =>
        e.category === "changed-directly" ||
        changeSet.symbols.some((s) => s.symbolId === e.entityId),
    ).length;
    const fc = factor(
      "changed-production-symbols",
      `${changed} changed production symbol(s)`,
      Math.min(1, changed / 20),
      0.2,
    );
    factors.push(fc);
    score += fc.contribution;

    const contracts = analysis.entities.filter((e) => e.isPublicContract).length;
    const fcont = factor(
      "public-contract-changes",
      `${contracts} public-contract change(s)`,
      Math.min(1, contracts / 5),
      0.25,
    );
    factors.push(fcont);
    score += fcont.contribution;

    const criticalFlows = analysis.flows.filter(
      (f) => f.riskCategory === "critical" || f.riskCategory === "high",
    ).length;
    const fflow = factor(
      "critical-flow-involvement",
      `${criticalFlows} affected critical/high flow(s)`,
      Math.min(1, criticalFlows / 5),
      0.2,
    );
    factors.push(fflow);
    score += fflow.contribution;

    const persistence = analysis.entities.some(
      (e) =>
        e.kind.toLowerCase().includes("persistence") ||
        e.category === "data-writer" ||
        e.category === "data-reader",
    );
    const fpers = factor(
      "persistence-changes",
      persistence ? "persistence changes present" : "no persistence changes",
      persistence ? 1 : 0,
      0.1,
    );
    factors.push(fpers);
    score += fpers.contribution;

    const lowConf = analysis.entities.filter((e) => e.confidence < 0.4).length;
    const flo = factor(
      "low-confidence-impact",
      `${lowConf} low-confidence impacted entit(ies)`,
      Math.min(1, lowConf / 30),
      0.1,
    );
    factors.push(flo);
    score += flo.contribution;

    const unmapped = gaps.filter(
      (g) =>
        g.testGenerationRecommended ||
        g.gapType === "changed-symbol-no-test" ||
        g.gapType === "public-contract-no-test",
    ).length;
    const fgap = factor(
      "unmapped-tests",
      `${unmapped} unmapped/required-test gap(s)`,
      Math.min(1, unmapped / 15),
      0.15,
    );
    factors.push(fgap);
    score += fgap.contribution;

    score = Math.min(1, score);
    const overallLevel =
      score >= 0.75 ? "critical" : score >= 0.5 ? "high" : score >= 0.25 ? "medium" : "low";
    return { overallLevel, score, factors };
  }
}

function factor(
  id: string,
  description: string,
  normalized: number,
  weight: number,
): { id: string; description: string; weight: number; contribution: number } {
  return { id, description, weight, contribution: normalized * weight };
}

function gap(p: {
  affectedEntityId?: string;
  affectedFlowId?: string;
  gapType: CoverageGap["gapType"];
  risk: CoverageGap["risk"];
  layer: CoverageGap["recommendedTestLayer"];
  scenario: string;
  testGen: boolean;
}): CoverageGap {
  return {
    id: `gap:${p.gapType}:${p.affectedEntityId ?? p.affectedFlowId ?? crypto.randomUUID()}`,
    affectedEntityId: p.affectedEntityId,
    affectedFlowId: p.affectedFlowId,
    gapType: p.gapType,
    risk: p.risk,
    evidence: [],
    recommendedTestLayer: p.layer,
    proposedScenarioSummary: p.scenario,
    testGenerationRecommended: p.testGen,
    verificationStatus: "unmapped",
  };
}
