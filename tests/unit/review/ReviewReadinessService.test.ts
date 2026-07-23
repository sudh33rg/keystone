import { describe, expect, it } from "vitest";
import { PrReviewPersistenceStore } from "../../../src/core/persistence/PrReviewPersistenceStore";
import { ReviewReadinessService } from "../../../src/core/review/ReviewReadinessService";
import type {
  ContractChange,
  ReviewContractAssessment,
  ReviewFinding,
  ReviewTestAssessment,
  ReviewTraceabilityAssessment,
  ReviewTraceabilityLink,
} from "../../../src/shared/contracts/prReview";

const workflowId = "00000000-0000-4000-8000-000000000001";
const reviewId = "00000000-0000-4000-8000-000000000002";

function traceability(links: ReviewTraceabilityLink[] = []): ReviewTraceabilityAssessment {
  return {
    id: "trace-1",
    workflowId,
    links,
    unlinkedChangePaths: [],
    ambiguousLinkIds: [],
    createdAt: new Date().toISOString(),
    contentHash: "sha256:trace",
  } as unknown as ReviewTraceabilityAssessment;
}

function contract(changes: ContractChange[] = []): ReviewContractAssessment {
  return {
    id: "contract-1",
    workflowId,
    changes,
    createdAt: new Date().toISOString(),
    contentHash: "sha256:contract",
  } as unknown as ReviewContractAssessment;
}

function testAssessment(overrides: Partial<ReviewTestAssessment> = {}): ReviewTestAssessment {
  return {
    id: "test-1",
    workflowId,
    state: "sufficient",
    requiredImpactedTests: [],
    testsExecuted: [],
    resultsByTest: {},
    generatedTestValidationIds: [],
    remediationValidationIds: [],
    unresolvedFailures: [],
    flakyStateIds: [],
    skippedTests: [],
    coverageGaps: [],
    policyViolations: [],
    qaDecisionCurrent: true,
    createdAt: new Date().toISOString(),
    contentHash: "sha256:test",
    ...overrides,
  } as unknown as ReviewTestAssessment;
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: `finding-${Math.random()}`,
    reviewId,
    category: "test",
    severity: "info",
    confidence: 1,
    title: "finding",
    description: "desc",
    provenance: "deterministic",
    status: "open",
    createdAt: new Date().toISOString(),
    contentHash: "sha256:finding",
    ...overrides,
  } as unknown as ReviewFinding;
}

describe("ReviewReadinessService", () => {
  it("blocks readiness on unresolved breaking contracts", async () => {
    const store = new PrReviewPersistenceStore();
    await store.initialize();
    const service = new ReviewReadinessService(store);
    const result = service.evaluate({
      workflowId,
      reviewId,
      traceability: traceability([
        { id: "ac-1", kind: "acceptance-criterion", state: "satisfied", description: "", confidence: 1, explanation: "", evidence: [], implementationRefs: [], validationRefs: [] } as unknown as ReviewTraceabilityLink,
      ]),
      contractAssessment: contract([{ id: "c-1", contractKind: "exported-function", classification: "breaking", confidence: 1, location: "", affectedConsumers: [], behaviouralNote: "", evidenceIds: [] } as unknown as ContractChange]),
      testAssessment: testAssessment(),
      findings: [finding()],
      qaCurrent: true,
      securityCurrent: true,
      performanceCurrent: true,
      reviewCurrent: true,
      traceabilityCurrent: true,
      approvedByUser: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.blockedBy.some((m) => m.includes("breaking contract"))).toBe(true);
  });

  it("requires user approval before final readiness", async () => {
    const store = new PrReviewPersistenceStore();
    await store.initialize();
    const service = new ReviewReadinessService(store);
    const result = service.evaluate({
      workflowId,
      reviewId,
      traceability: traceability([
        { id: "ac-1", kind: "acceptance-criterion", state: "satisfied", description: "", confidence: 1, explanation: "", evidence: [], implementationRefs: [], validationRefs: [] } as unknown as ReviewTraceabilityLink,
      ]),
      contractAssessment: contract(),
      testAssessment: testAssessment(),
      findings: [finding()],
      qaCurrent: true,
      securityCurrent: true,
      performanceCurrent: true,
      reviewCurrent: true,
      traceabilityCurrent: true,
      approvedByUser: false,
    });

    expect(result.decision).toBe("incomplete");
  });
});
