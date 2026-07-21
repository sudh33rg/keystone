/**
 * TestScenarioDerivationService (spec §6, §7).
 *
 * Deterministic, LLM-free derivation of test scenarios from coverage gaps, acceptance criteria,
 * changed flows, and defect evidence. Each scenario records requirement mapping, expected
 * behaviour, test layer, risk, and evidence. Implementation code is NEVER generated here (per §6);
 * the user reviews scenarios before any delegation.
 *
 * Category selection is evidence-driven: only categories supported by the actual change/evidence
 * are emitted (per §7) — never a generic bucket of every category.
 */
import { createHash } from "node:crypto";
import {
  DerivedScenarioSchema,
  TestScenarioDerivationResultSchema,
  ScenarioCategorySchema,
  type DerivedScenario,
  type TestScenarioDerivationResult,
  type ScenarioCategory,
  type TestGenerationRequest,
} from "../../../shared/contracts/qaRemediation";
import type { CoverageGap, ImpactAnalysis } from "../../../shared/contracts/qaLifecycle";

export interface ScenarioDerivationInput {
  request: TestGenerationRequest;
  gaps: CoverageGap[];
  impact?: ImpactAnalysis;
  acceptanceCriteria: Array<{ id: string; description: string }>;
  defectEvidence?: Array<{ id: string; kind: string; statement: string }>;
}

const ALL_CATEGORIES = ScenarioCategorySchema.options;

export class TestScenarioDerivationService {
  derive(input: ScenarioDerivationInput): TestScenarioDerivationResult {
    const { request, gaps, impact, acceptanceCriteria, defectEvidence } = input;
    const scenarios: DerivedScenario[] = [];
    const categoriesConsidered = [...ALL_CATEGORIES];
    const categoriesSelected = new Set<ScenarioCategory>();

    const entityIds = request.targets.productionEntityIds;
    const flowIds = request.targets.flowIds;
    const changedEntityMap = new Map(
      (impact?.entities ?? [])
        .filter((e) => entityIds.includes(e.entityId))
        .map((e) => [e.entityId, e]),
    );

    // Happy path from each acceptance criterion (required behaviour).
    for (const ac of acceptanceCriteria) {
      scenarios.push(
        this.make({
          request,
          category: "happy-path",
          title: `Happy path: ${ac.id}`,
          relatedRequirementId: ac.id,
          preconditions: `System is in a valid initial state for ${ac.id}.`,
          action: `Exercise the behaviour described by ${ac.id}.`,
          expectedOutcome: ac.description,
          targetEntityIds: entityIds,
          evidence: [{ id: ac.id, kind: "acceptance-criterion", statement: ac.description }],
          risk: request.recommendation.priority,
          confidence: 0.9,
        }),
      );
      categoriesSelected.add("happy-path");
    }

    // Gap-driven scenarios: each gap implies concrete categories.
    for (const gap of gaps) {
      for (const cat of this.categoriesForGap(gap)) {
        scenarios.push(
          this.make({
            request,
            category: cat,
            title: `${cat} — ${gap.proposedScenarioSummary}`,
            relatedRequirementId: request.trigger.sourceId,
            preconditions: "Preconditions depend on the production symbol under test.",
            action: gap.proposedScenarioSummary,
            expectedOutcome: gap.proposedScenarioSummary,
            targetEntityIds: gap.affectedEntityId ? [gap.affectedEntityId] : entityIds,
            evidence: gap.evidence,
            risk: gap.risk,
            confidence: 0.7,
          }),
        );
        categoriesSelected.add(cat);
      }
    }

    // Changed public contract → backward-compatibility + validation-failure.
    for (const entity of changedEntityMap.values()) {
      if (entity.isPublicContract) {
        scenarios.push(
          this.make({
            request,
            category: "backward-compatibility",
            title: `Backward compatibility for changed contract ${entity.displayName}`,
            relatedRequirementId: request.trigger.sourceId,
            preconditions: "Existing consumers depend on the prior contract shape.",
            action: "Verify existing callers still function after the contract change.",
            expectedOutcome: "No breaking change for supported consumers, or explicit migration.",
            targetEntityIds: [entity.entityId],
            evidence: entity.evidence,
            risk: "high",
            confidence: 0.65,
          }),
        );
        categoriesSelected.add("backward-compatibility");
      }
    }

    // Changed branches / error paths → validation-failure + error-propagation.
    const branchEvidence = this.branchEvidence(impact);
    if (branchEvidence.length > 0) {
      scenarios.push(
        this.make({
          request,
          category: "validation-failure",
          title: "Reject invalid input on changed path",
          relatedRequirementId: request.trigger.sourceId,
          preconditions: "Input violates validation rules.",
          action: "Submit invalid input to the changed path.",
          expectedOutcome: "Validation error is returned without side effects.",
          targetEntityIds: entityIds,
          evidence: branchEvidence,
          risk: "medium",
          confidence: 0.6,
        }),
      );
      categoriesSelected.add("validation-failure");
      categoriesSelected.add("error-propagation");
    }

    // Affected flow → event-publication / persistence-effect when side effects exist.
    for (const flowId of flowIds) {
      const flow = impact?.flows.find((f) => f.id === flowId);
      for (const sideEffect of flow?.sideEffects ?? []) {
        const isEvent = /publish|emit|event/i.test(sideEffect);
        const cat: ScenarioCategory = isEvent ? "event-publication" : "persistence-effect";
        scenarios.push(
          this.make({
            request,
            category: cat,
            title: `${cat} for flow ${flow?.name ?? flowId}`,
            relatedRequirementId: request.trigger.sourceId,
            preconditions: "Flow has executed the mutating step.",
            action: `Assert the side effect: ${sideEffect}.`,
            expectedOutcome: `Side effect '${sideEffect}' is observable.`,
            targetEntityIds: entityIds,
            evidence: flow?.evidence ?? [],
            risk: "medium",
            confidence: 0.55,
          }),
        );
        categoriesSelected.add(cat);
      }
    }

    // Defect evidence → regression-reproduction.
    for (const defect of defectEvidence ?? []) {
      scenarios.push(
        this.make({
          request,
          category: "regression-reproduction",
          title: `Reproduce defect ${defect.id}`,
          relatedRequirementId: request.trigger.sourceId,
          preconditions: "System is in the state that triggers the defect.",
          action: "Reproduce the originally reported failure.",
          expectedOutcome: "The defect scenario is captured as a regression test.",
          targetEntityIds: entityIds,
          evidence: [defect],
          risk: "high",
          confidence: 0.6,
        }),
      );
      categoriesSelected.add("regression-reproduction");
    }

    const now = new Date().toISOString();
    const payload = JSON.stringify(scenarios);
    return TestScenarioDerivationResultSchema.parse({
      requestId: request.id,
      scenarios,
      categoriesConsidered,
      categoriesSelected: [...categoriesSelected],
      metadata: {
        createdAt: now,
        contentHash: createHash("sha256").update(payload).digest("hex").slice(0, 32),
      },
    });
  }

  private categoriesForGap(gap: CoverageGap): ScenarioCategory[] {
    switch (gap.gapType) {
      case "changed-symbol-no-test":
      case "public-contract-no-test":
        return ["happy-path", "boundary-value"];
      case "impacted-branch-no-test":
        return ["validation-failure", "error-propagation"];
      case "affected-flow-no-integration-test":
        return ["event-publication", "persistence-effect"];
      case "persistence-change-no-data-test":
        return ["persistence-effect", "missing-data"];
      case "event-change-no-pubsub-test":
        return ["event-publication"];
      case "configuration-change-no-validation-test":
        return ["validation-failure"];
      case "deleted-behaviour-stale-test":
        return ["regression-reproduction"];
      case "low-confidence-mapping":
        return ["happy-path"];
      default:
        return [];
    }
  }

  private branchEvidence(
    impact?: ImpactAnalysis,
  ): Array<{ id: string; kind: string; statement: string }> {
    const out: Array<{ id: string; kind: string; statement: string }> = [];
    for (const e of impact?.entities ?? []) {
      if (/branch|error|guard|validation/i.test(e.kind) || e.category === "changed-directly") {
        out.push(...e.evidence);
      }
    }
    return out;
  }

  private make(p: {
    request: TestGenerationRequest;
    category: ScenarioCategory;
    title: string;
    relatedRequirementId: string;
    preconditions: string;
    action: string;
    expectedOutcome: string;
    targetEntityIds: string[];
    evidence: Array<{ id: string; kind: string; statement: string }>;
    risk: "low" | "medium" | "high" | "critical";
    confidence: number;
  }): DerivedScenario {
    const id = createHash("sha256")
      .update(`${p.request.id}:${p.category}:${p.title}`)
      .digest("hex")
      .slice(0, 12);
    return DerivedScenarioSchema.parse({
      id,
      title: p.title,
      category: p.category,
      relatedRequirementId: p.relatedRequirementId,
      preconditions: p.preconditions,
      action: p.action,
      expectedOutcome: p.expectedOutcome,
      testLayer: p.request.recommendation.testLayer,
      targetEntityIds: p.targetEntityIds,
      requiredFixtures: [],
      requiredMocks: [],
      sideEffectsToVerify: [],
      priority: p.request.recommendation.priority,
      risk: p.risk,
      evidence: p.evidence,
      derivationConfidence: p.confidence,
    });
  }
}
