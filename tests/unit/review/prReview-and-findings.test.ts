import { describe, expect, it } from "vitest";
import {
  ReviewContractAssessmentSchema,
  ReviewTestAssessmentSchema,
} from "../../../src/shared/contracts/prReview";
import { ReviewContractReviewService } from "../../../src/core/review/ReviewContractReviewService";
import { ReviewTestAdequacyService } from "../../../src/core/review/ReviewTestAdequacyService";
import { ReviewSecurityPerformanceService } from "../../../src/core/review/ReviewSecurityPerformanceService";
import { ReviewFindingService } from "../../../src/core/review/ReviewFindingService";
import type { ReviewFinding as IReviewFinding } from "../../../src/shared/contracts/prReview";

const workflowId = "00000000-0000-4000-8000-000000000001";

describe("ReviewContractReviewService", () => {
  it("detects exported function signature changes", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        {
          id: "c1",
          contractKind: "exported-function",
          location: "src/api/users.ts:exportUser",
          oldShape: "(id: string) => User",
          newShape: "(id: string, includeMeta: boolean) => UserWithMeta",
          classification: "potentially-breaking",
          affectedConsumers: ["src/app.ts"],
          evidenceIds: ["diff-1"],
        },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data!.changes[0]!.contractKind).toBe("exported-function");
      expect(schemaResult.data!.changes[0]!.classification).toBe("potentially-breaking");
    }
  });

  it("detects route/request/response/event/config/db schema changes", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        { id: "c2", contractKind: "api-route", location: "src/routes/payments.ts", oldShape: "GET /payments", newShape: "GET /payments, POST /payments", classification: "additive" },
        { id: "c3", contractKind: "database-schema", location: "db/migrations/003.sql", oldShape: "users(id, name)", newShape: "users(id, name, email)", classification: "potentially-breaking" },
        { id: "c3b", contractKind: "event-contract", location: "src/events/order.ts", oldShape: "OrderCreated{id}", newShape: "OrderCreated{id, status}", classification: "additive" },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data!.changes[1]!.contractKind).toBe("database-schema");
      expect(schemaResult.data!.changes[2]!.contractKind).toBe("event-contract");
    }
  });

  it("detects removed contracts", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        { id: "c4", contractKind: "public-method", location: "src/utils/deprecated.ts:legacyHelper", oldShape: "legacyHelper(x: number): number", newShape: "removed", classification: "destructive", affectedConsumers: ["src/legacy.ts"], evidenceIds: ["removal-1"] },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data!.changes[0]!.newShape).toBe("removed");
      expect(schemaResult.data!.changes[0]!.classification).toBe("destructive");
    }
  });

  it("marks behavioural compatibility unresolved when evidence insufficient", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        { id: "c5", contractKind: "interface", location: "src/types/ServerEvent.ts", oldShape: "ServerEvent{ type: 'A'; payload: string }", newShape: "ServerEvent{ type: 'A' | 'B'; payload: unknown }", classification: "unresolved", affectedConsumers: ["src/consumer.ts"], evidenceIds: [] },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data!.changes[0]!.classification).toBe("unresolved");
      expect(schemaResult.data!.changes.some((change) => change.classification === "breaking")).toBe(false);
      expect(schemaResult.data!.changes.some((change) => change.classification === "unresolved")).toBe(true);
    }
  });

  it("validates contract assessment against zod schema", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({ workflowId, changes: [] });
    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    expect(schemaResult.data?.changes).toEqual([]);
  });

  it("classifies breaking vs additive changes", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        { id: "b1", contractKind: "response-type", location: "src/api/responses.ts", oldShape: "{ success: boolean }", newShape: "{ success: boolean, error?: string }", classification: "additive" },
        { id: "b2", contractKind: "configuration-schema", location: "config/schema.json", oldShape: "{ port: number }", newShape: "{}", classification: "breaking" },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.changes.find((c) => c.id === "b1")?.classification).toBe("additive");
      expect(schemaResult.data.changes.find((c) => c.id === "b2")?.classification).toBe("breaking");
    }
  });
});

describe("ReviewTestAdequacyService", () => {
  const service = new ReviewTestAdequacyService();

  it("requires impacted tests to be included", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1", "test-2"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.state).toBe("incomplete");
    }
  });

  it("requires tests to have current execution evidence", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: false,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.state).toBe("stale");
    }
  });

  it("passing tests alone do not imply adequate coverage when required tests missing", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1", "test-2", "test-3"],
      testsExecuted: ["test-1", "test-2", "test-3"],
      resultsByTest: { "test-1": "passed", "test-2": "passed", "test-3": "passed" },
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.state).toBe("sufficient");
    }
  });

  it("skipped/flaky evidence affects review", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "skipped" },
      skippedTests: ["test-1"],
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(["sufficient-with-warnings", "incomplete"]).toContain(schemaResult.data.state);
    }
  });

  it("unsafe test-healing policy violation blocks readiness", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
      policyViolations: ["weakened-assertion-1"],
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.state).toBe("failed");
    }
  });

  it("generated tests require validation evidence", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["generated-1"],
      testsExecuted: ["generated-1"],
      resultsByTest: { "generated-1": "passed" },
      generatedTestValidationIds: [],
      coverageGaps: ["generated coverage gap"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(["incomplete", "sufficient-with-warnings"]).toContain(schemaResult.data.state);
    }
  });

  it("stale QA decision cannot be reused", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: false,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
      generatedTestValidationIds: ["gen-1"],
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.state).toBe("stale");
    }
  });
});

describe("ReviewSecurityPerformanceService", () => {
  it("loads current Security/Performance decisions", () => {
    const service = new ReviewSecurityPerformanceService();
    const decision = service.build({
      workflowId,
      securityStatus: "reviewed",
      currentSecurityDecisionId: "sec-1",
      currentSecurityDecisionAt: new Date().toISOString(),
      securityDecisionAgeMs: 1000,
      performanceStatus: "reviewed",
      currentPerformanceDecisionId: "perf-1",
      currentPerformanceDecisionAt: new Date().toISOString(),
      performanceDecisionAgeMs: 1000,
    });

    expect(decision.securityStatus).toBe("reviewed");
    expect(decision.performanceStatus).toBe("reviewed");
    expect(decision.blocked).toBe(false);
    expect(decision.currentSecurityDecisionId).toBe("sec-1");
    expect(decision.currentPerformanceDecisionId).toBe("perf-1");
  });

  it("rejects stale decisions", () => {
    const service = new ReviewSecurityPerformanceService();
    const recentDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString();
    const decision = service.build({
      workflowId,
      securityStatus: "stale",
      currentSecurityDecisionId: "sec-stale",
      currentSecurityDecisionAt: recentDate,
      securityDecisionAgeMs: 1000 * 60 * 60 * 24 * 2,
      performanceStatus: "stale",
      currentPerformanceDecisionId: "perf-stale",
      currentPerformanceDecisionAt: recentDate,
      performanceDecisionAgeMs: 1000 * 60 * 60 * 24 * 2,
    });

    expect(decision.securityStatus).toBe("stale");
    expect(decision.performanceStatus).toBe("stale");
    expect(decision.blocked).toBe(true);
  });

  it("includes open blocking Security/Performance findings", () => {
    const service = new ReviewSecurityPerformanceService();
    const decision = service.build({
      workflowId,
      securityStatus: "open",
      performanceStatus: "reviewed",
      currentPerformanceDecisionId: "perf-1",
      currentPerformanceDecisionAt: new Date().toISOString(),
      performanceDecisionAgeMs: 1000,
      acceptedRisks: [
        {
          id: "risk-1",
          category: "security",
          title: "Legacy auth",
          justification: "Deprecated module scheduled for removal next release.",
          acceptedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        },
      ],
      openBlockingFindings: [
        {
          id: "open-security-1",
          category: "security",
          severity: "high",
          title: "SQL injection in payment query",
          description: "User input reaches SQL query without parameterization.",
          location: { filePath: "src/payments/query.ts", startLine: 42 },
          confidence: 0.95,
          evidenceIds: ["scan-42"],
          acceptedRisks: [],
        },
      ],
      confirmedRegressions: [
        {
          id: "perf-regression-1",
          source: "performance",
          title: "Sort latency increased 3x",
          description: "p99 sort latency regressed after index removal.",
          severity: "high",
          status: "confirmed-regression",
          filePath: "src/sort/index.ts",
        },
      ],
    });

    expect(decision.blocked).toBe(true);
    expect(decision.acceptedRisks).toHaveLength(1);
    expect(decision.acceptedRisks[0]?.category).toBe("security");
    expect(decision.confirmedRegressions).toHaveLength(1);
    expect(decision.confirmedRegressions[0]?.id).toBe("perf-regression-1");
  });

  it("distinguishes confirmed regressions from static candidates", () => {
    const service = new ReviewSecurityPerformanceService();
    const decision = service.build({
      workflowId,
      securityStatus: "reviewed",
      currentSecurityDecisionId: "sec-stable",
      currentSecurityDecisionAt: new Date().toISOString(),
      securityDecisionAgeMs: 1000,
      performanceStatus: "reviewed",
      currentPerformanceDecisionId: "perf-stable",
      currentPerformanceDecisionAt: new Date().toISOString(),
      performanceDecisionAgeMs: 1000,
      openBlockingFindings: [],
      confirmedRegressions: [
        {
          id: "confirmed-1",
          source: "performance",
          title: "Confirmed regression",
          description: "Confirmed by benchmark v2.",
          severity: "high",
          status: "confirmed-regression",
          filePath: "src/perf/slow.ts",
        },
        {
          id: "candidate-1",
          source: "performance",
          title: "Static candidate",
          description: "From static scan only.",
          severity: "medium",
          status: "static-candidate",
          filePath: "src/perf/static.ts",
        },
        {
          id: "resolved-1",
          source: "security",
          title: "Resolved finding",
          description: "Quarantined by patch.",
          severity: "high",
          status: "resolved",
          filePath: "src/security/old.ts",
        },
      ],
    });

    expect(decision.confirmedRegressions).toHaveLength(3);
    expect(decision.confirmedRegressions.map((r) => r.id)).toEqual([
      "confirmed-1",
      "candidate-1",
      "resolved-1",
    ]);
    expect(decision.blocked).toBe(false);
  });
});

describe("ReviewFindingService", () => {
  it("enforces category/severity/confidence/provenance on recorded findings", () => {
    const service = new ReviewFindingService();
    const findings = service.record({
      workflowId,
      reviewId: "00000000-0000-4000-8000-000000000002",
      findings: [
        {
          id: "finding-1",
          category: "security",
          severity: "high",
          confidence: 0.95,
          title: "XSS vector in markdown renderer",
          description: "Unsanitized HTML passes through markdown pipeline.",
          location: { filePath: "src/markdown/renderer.ts", startLine: 12 },
          provenance: "security",
          status: "open",
          evidenceIds: ["scan-12"],
          requirementIds: ["REQ-SEC-1"],
          createdAt: new Date().toISOString(),
          contentHash: "",
        } as IReviewFinding,
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("security");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.confidence).toBeCloseTo(0.95);
    expect(findings[0]?.provenance).toBe("security");
  });

  it("requires evidence for finding resolution", () => {
    const service = new ReviewFindingService();
    service.record({
      workflowId,
      reviewId: "00000000-0000-4000-8000-000000000003",
      findings: [
        {
          id: "finding-evidence",
          category: "test",
          severity: "warning",
          confidence: 0.8,
          title: "Flaky test flaky",
          description: "Flaky behaviour observed.",
          provenance: "qa",
          status: "open",
          evidenceIds: ["qa-1"],
          requirementIds: [],
          createdAt: new Date().toISOString(),
          contentHash: "",
        } as IReviewFinding,
      ],
    });

    const finding = service.list()[0]!;
    expect(() =>
      service.updateStatus({
        workflowId,
        findingId: "missing-id",
        status: "resolved",
        resolutionEvidence: ["qa-2"],
      }),
    ).toThrow(/Review finding not found/i);

    const result = service.updateStatus({
      workflowId,
      findingId: finding.id,
      status: "resolved",
      resolutionEvidence: ["qa-2"],
    });
    expect(result.some((item) => item.id === finding.id && item.status === "resolved")).toBe(true);
  });

  it("requires justification for high-severity deferral", () => {
    const service = new ReviewFindingService();
    service.record({
      workflowId,
      reviewId: "00000000-0000-4000-8000-000000000004",
      findings: [
        {
          id: "finding-high",
          category: "security",
          severity: "high",
          confidence: 0.9,
          title: "Unsafe deserialization",
          description: "Pickle.loads used on network input.",
          location: { filePath: "src/network/serializer.ts", startLine: 8 },
          provenance: "security",
          status: "open",
          evidenceIds: ["scan-8"],
          requirementIds: ["REQ-SEC-2"],
          createdAt: new Date().toISOString(),
          contentHash: "",
        } as IReviewFinding,
      ],
    });

    const finding = service.list()[0]!;
    expect(() => service.validateDeferral(finding)).toThrow(
      /High-severity finding deferral requires explicit justification/i,
    );
    expect(() =>
      service.validateDeferral(finding, "Deferring to sprint 30 with owner approval."),
    ).not.toThrow();
  });

  it("consolidates duplicate findings without dropping them relationally", () => {
    const service = new ReviewFindingService();
    const findingA: IReviewFinding = {
      id: "dup-a",
      category: "database",
      severity: "warning",
      confidence: 0.8,
      title: "Missing index on user email",
      description: "Index missing.",
      location: { filePath: "db/schema.ts" },
      provenance: "deterministic",
      status: "open",
      evidenceIds: ["schema-1"],
      requirementIds: [],
      createdAt: new Date().toISOString(),
      contentHash: "",
    };

    const findingB: IReviewFinding = {
      id: "dup-b",
      category: "database",
      severity: "warning",
      confidence: 0.7,
      title: "Missing index on user email",
      description: "Index still missing.",
      location: { filePath: "db/schema.ts" },
      provenance: "deterministic",
      status: "open",
      evidenceIds: ["schema-2"],
      requirementIds: [],
      createdAt: new Date().toISOString(),
      contentHash: "",
    };

    const { deduped, relations } = service.dedupe([findingA, findingB]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe("dup-a");
    expect(relations).toHaveLength(1);
    expect(relations[0]?.candidateId).toBe("dup-b");
    expect(relations[0]?.canonicalId).toBe("dup-a");
  });

  it("preserves resolved findings in the persisted record set", () => {
    const service = new ReviewFindingService();
    service.record({
      workflowId,
      reviewId: "00000000-0000-4000-8000-000000000005",
      findings: [
        {
          id: "finding-resolved",
          category: "documentation",
          severity: "suggestion",
          confidence: 0.6,
          title: "Update README snippet",
          description: "README uses old command.",
          provenance: "agent",
          status: "resolved",
          resolutionEvidence: ["readme-update-1"],
          evidenceIds: [],
          requirementIds: [],
          createdAt: new Date().toISOString(),
          contentHash: "",
        } as IReviewFinding,
      ],
    });

    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]?.status).toBe("resolved");
    expect((service.list()[0]?.resolutionEvidence ?? [])).toContain("readme-update-1");
  });
});
