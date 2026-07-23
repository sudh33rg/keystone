import { describe, expect, it } from "vitest";
import { PrReviewPersistenceStore } from "../../../src/core/persistence/PrReviewPersistenceStore";
import { ReviewPrPackageService } from "../../../src/core/review/ReviewPrPackageService";

const workflowId = "00000000-0000-4000-8000-000000000001";
const reviewId = "00000000-0000-4000-8000-000000000002";

describe("ReviewPrPackageService", () => {
  it("generates a package from current evidence without claiming all tests passed when only targeted tests ran", async () => {
    const store = new PrReviewPersistenceStore();
    await store.initialize();
    const service = new ReviewPrPackageService(store);
    const package_ = await service.generate({
      workflowId,
      reviewId,
      intent: "Add retry with backoff.",
      outcome: "Resilient PaymentGateway.",
      sections: {
        summary: "Added exponential backoff for payment failures.",
        problem: "Intermittent payment outages.",
        solution: "Retry with capped backoff.",
        mainChanges: "PaymentGateway.retry",
        requirementCoverage: "REQ-1",
        affectedAreas: "payments",
        contractChanges: "none",
        configurationOrMigration: "none",
        testEvidence: "targeted tests ran",
        security: "reviewed by security",
        performance: "within budget",
        knownLimitations: "does not cover network partition",
        acceptedRisks: "none",
        reviewerGuidance: "verify backoff caps",
        checklist: "done",
      },
      testAssessment: {
        state: "sufficient-with-warnings",
        requiredImpactedTests: ["payment.retry"],
        testsExecuted: ["payment.retry"],
        resultsByTest: { "payment.retry": "passed" },
        skippedTests: [],
        coverageGaps: [],
        policyViolations: [],
        qaDecisionCurrent: true,
        generatedTestValidationIds: [],
        remediationValidationIds: [],
        unresolvedFailures: [],
        flakyStateIds: [],
      } as any,
      findings: [] as any,
    });

    expect(package_.title).toContain("Add retry with backoff");
    expect(package_.title).toContain("Resilient PaymentGateway");
    expect(package_.sections.testEvidence).toContain("targeted tests ran");
    expect(package_.sections.testEvidence).not.toContain("all tests passed");
  });

  it("persists user edits and does not silently overwrite on regeneration", async () => {
    const store = new PrReviewPersistenceStore();
    await store.initialize();
    const service = new ReviewPrPackageService(store);

    const first = await service.generate({
      workflowId,
      reviewId,
      intent: "Add retry with backoff.",
      outcome: "Resilient PaymentGateway.",
      sections: {
        summary: "Added exponential backoff for payment failures.",
        problem: "Intermittent payment outages.",
        solution: "Retry with capped backoff.",
        mainChanges: "PaymentGateway.retry",
        requirementCoverage: "REQ-1",
        affectedAreas: "payments",
        contractChanges: "none",
        configurationOrMigration: "none",
        testEvidence: "targeted tests ran",
        security: "reviewed by security",
        performance: "within budget",
        knownLimitations: "does not cover network partition",
        acceptedRisks: "none",
        reviewerGuidance: "verify backoff caps",
        checklist: "done",
      },
      testAssessment: {
        state: "sufficient-with-warnings",
        requiredImpactedTests: [],
        testsExecuted: [],
        resultsByTest: {},
        skippedTests: [],
        coverageGaps: [],
        policyViolations: [],
        qaDecisionCurrent: true,
        generatedTestValidationIds: [],
        remediationValidationIds: [],
        unresolvedFailures: [],
        flakyStateIds: [],
      } as any,
      findings: [] as any,
    });

    expect(first.userEdited).toBe(false);

    const updated = await service.updatePackage({
      workflowId,
      reviewId,
      title: "User edited PR title",
    });

    expect(updated.title).toBe("User edited PR title");
    expect(updated.userEdited).toBe(true);

    const regenerated = await service.generate({
      workflowId,
      reviewId,
      intent: "Add retry with backoff.",
      outcome: "Resilient PaymentGateway.",
      sections: {
        summary: "Added exponential backoff for payment failures.",
        problem: "Intermittent payment outages.",
        solution: "Retry with capped backoff.",
        mainChanges: "PaymentGateway.retry",
        requirementCoverage: "REQ-1",
        affectedAreas: "payments",
        contractChanges: "none",
        configurationOrMigration: "none",
        testEvidence: "targeted tests ran",
        security: "reviewed by security",
        performance: "within budget",
        knownLimitations: "does not cover network partition",
        acceptedRisks: "none",
        reviewerGuidance: "verify backoff caps",
        checklist: "done",
      },
      testAssessment: {
        state: "sufficient-with-warnings",
        requiredImpactedTests: [],
        testsExecuted: [],
        resultsByTest: {},
        skippedTests: [],
        coverageGaps: [],
        policyViolations: [],
        qaDecisionCurrent: true,
        generatedTestValidationIds: [],
        remediationValidationIds: [],
        unresolvedFailures: [],
        flakyStateIds: [],
      } as any,
      findings: [] as any,
    });

    expect(regenerated.title).toBe("User edited PR title");
    expect(regenerated.userEdited).toBe(true);
  });
});
