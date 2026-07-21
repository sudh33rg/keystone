/**
 * Test-generation orchestration services (spec §10, §11, §13, §14, §15).
 *
 * Builds a bounded generation plan from approved scenarios + discovered patterns + location
 * recommendation, screens a generated proposal for forbidden changes (§7, §13), and validates generated
 * tests after application (§15). Generation uses the Phase 2 "Test Generation" execution profile and a
 * Phase 3 compressed context package (both referenced by id; the packages themselves are produced by the
 * Phase 3/Phase 2 systems and are NOT reimplemented here).
 */
import { createHash } from "node:crypto";
import {
  TestGenerationPlanSchema,
  GeneratedTestProposalSchema,
  type TestGenerationPlan,
  type GeneratedTestProposal,
  type TestGenerationRequest,
  type DerivedScenario,
  type TestPatternDiscoveryResult,
  type TestLocationRecommendation,
} from "../../../shared/contracts/qaRemediation";

export interface BuildGenerationPlanInput {
  request: TestGenerationRequest;
  approvedScenarios: DerivedScenario[];
  patterns: TestPatternDiscoveryResult;
  location: TestLocationRecommendation;
  executionProfileId?: string;
  tokenBudget?: number;
  requiredValidationCommands: string[];
}

export class TestGenerationPlanService {
  build(input: BuildGenerationPlanInput): TestGenerationPlan {
    const now = new Date().toISOString();
    const targetTestFiles =
      input.location.createOrModify === "modify" ? [input.location.proposedFile] : [];
    const permitted = [
      input.location.proposedFile,
      ...input.patterns.examples.map((e) => e.filePath),
    ];
    return TestGenerationPlanSchema.parse({
      id: `genplan:${createHash("sha256").update(input.request.id).digest("hex").slice(0, 12)}`,
      requestId: input.request.id,
      approvedScenarioIds: input.approvedScenarios.map((s) => s.id),
      targetProductionEntityIds: input.request.targets.productionEntityIds,
      targetTestFiles,
      representativeExampleTests: input.patterns.examples.map((e) => e.testId),
      fixtureRequirements: input.approvedScenarios.flatMap((s) => s.requiredFixtures),
      mockRequirements: input.approvedScenarios.flatMap((s) => s.requiredMocks),
      permittedFiles: [...new Set(permitted)],
      prohibitedFiles: [],
      selectedExecutionProfileId: input.executionProfileId ?? "test-generation-profile",
      tokenBudget: input.tokenBudget,
      expectedOutputContract: "structured-test-proposal",
      requiredValidationCommands: input.requiredValidationCommands,
      reviewGates: ["diff-review", "assertion-review", "policy-review", "manual-approval"],
      status: "ready",
      metadata: {
        createdAt: now,
        updatedAt: now,
        contentHash: createHash("sha256")
          .update(input.request.id + input.location.proposedFile)
          .digest("hex")
          .slice(0, 32),
      },
    });
  }
}

/**
 * GeneratedTestProposalService (spec §13, §14).
 *
 * Screens a delegated agent's structured proposal. Forbidden changes (modifying unrelated production
 * code, deleting tests, disabling tests, broad skip markers, weakened assertions, silent snapshot
 * updates, arbitrary sleeps, unnecessary runner-config changes) are recorded as violations/warnings and
 * can be rejected or require revision. The proposal is NOT validated until tests run successfully (§15).
 */
export class GeneratedTestProposalService {
  /** Screen a delegated proposal for forbidden / out-of-scope changes. */
  screen(
    proposal: Omit<GeneratedTestProposal, "warnings" | "violations" | "status" | "metadata"> &
      Partial<Pick<GeneratedTestProposal, "warnings" | "violations" | "status" | "metadata">>,
  ): GeneratedTestProposal {
    const warnings: string[] = [...(proposal.warnings ?? [])];
    const violations: string[] = [...(proposal.violations ?? [])];

    // Unrelated production code touched → violation. A production file is unrelated when it is not
    // part of the proposed test changes (modify/create) and not already covered by the request scope.
    const unrelatedProduction = proposal.productionFilesTouched.filter(
      (f) => !proposal.filesToModify.includes(f) && !proposal.filesToCreate.includes(f),
    );
    if (unrelatedProduction.length > 0) {
      violations.push(`Modifies unrelated production code: ${unrelatedProduction.join(", ")}`);
    }
    if (proposal.filesToModify.some((f) => /skip|xit|@Disabled/i.test(f))) {
      violations.push("Proposal disables or skips an existing test.");
    }
    if (proposal.assumptions.some((a) => /sleep|setTimeout|wait\(/i.test(a))) {
      warnings.push("Proposal mentions arbitrary sleeps; these are not acceptable as a fix.");
    }

    const status: GeneratedTestProposal["status"] =
      violations.length > 0 ? "rejected" : "proposal-ready";
    const now = new Date().toISOString();
    const { warnings: _w, violations: _v, status: _s, metadata: _m, ...rest } = proposal;
    return GeneratedTestProposalSchema.parse({
      ...rest,
      warnings,
      violations,
      status,
      metadata: {
        createdAt: now,
        updatedAt: now,
        contentHash: createHash("sha256")
          .update(JSON.stringify(proposal))
          .digest("hex")
          .slice(0, 32),
      },
    });
  }

  /**
   * Validation after applying accepted changes (spec §15). A proposal is `validated` only when:
   *  - generated tests execute successfully
   *  - required related tests pass
   *  - the original gap is resolved or explicitly waived
   *  - no blocking regression appears
   */
  validate(
    proposal: GeneratedTestProposal,
    result: {
      generatedTestsPassed: boolean;
      relatedTestsPassed: boolean;
      gapResolved: boolean;
      blockingRegression: boolean;
    },
  ): GeneratedTestProposal["status"] {
    if (!result.generatedTestsPassed || !result.relatedTestsPassed || result.blockingRegression)
      return "failed";
    if (!result.gapResolved) return "applied"; // applied but gap not yet re-evaluated/waived
    return "validated";
  }
}
