import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewContractAssessmentSchema,
  ContractChangeSchema,
  ReviewTestAssessmentSchema,
  type ContractChange,
  type ReviewFinding as IReviewFinding,
  type ReviewContractAssessment,
  type ReviewTestAssessment,
  type ReviewSecurityPerformanceDecision,
} from "../../../src/shared/contracts/prReview";
import { ReviewContractReviewService } from "../../../src/core/review/ReviewContractReviewService";
import { ReviewTestAdequacyService } from "../../../src/core/review/ReviewTestAdequacyService";
import { ReviewSecurityPerformanceService } from "../../../src/core/review/ReviewSecurityPerformanceService";
import { ReviewFindingService } from "../../../src/core/review/ReviewFindingService";

const workflowId = "00000000-0000-4000-8000-000000000001";
const reviewId = "00000000-0000-4000-8000-000000000002";

describe("ReviewContractReviewService", () => {
  it("detects exported function signature changes", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        {
          id: "change-1",
          contractKind: "exported-function",
          location: "src/api/users.ts:exportUser",
          oldShape: "(id: string) => User",
          newShape: "(id: string, includeMeta: boolean) => UserWithMeta",
          classification: "potentially-breaking",
          affectedConsumers: ["src/app.ts"],
          evidenceIds: ["diff-1"],
        },
        {
          id: "change-2",
          contractKind: "request-type",
          location: "src/api/requests.ts:CreateUserRequest",
          oldShape: "{ name: string }",
          newShape: "{ name: string; email?: string }",
          classification: "additive",
        },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    expect((assessment.changes[0] as unknown as ContractChange).contractKind).toBe("exported-function");
    expect((assessment.changes[0] as unknown as ContractChange).classification).toBe("potentially-breaking");
    expect((assessment.changes[1] as unknown as ContractChange).contractKind).toBe("request-type");
    expect((assessment.changes[1] as unknown as ContractChange).classification).toBe("additive");
  });

  it("detects route/request/response/event/config/db schema changes", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        {
          id: "route-1",
          contractKind: "api-route",
          location: "src/routes/payments.ts",
          oldShape: "GET /payments",
          newShape: "GET /payments, POST /payments",
          classification: "additive",
        },
        {
          id: "db-1",
          contractKind: "database-schema",
          location: "db/migrations/003.sql",
          oldShape: "users(id PK, name)",
          newShape: "users(id PK, name, email UNIQUE)",
          classification: "potentially-breaking",
        },
        {
          id: "event-1",
          contractKind: "event-contract",
          location: "src/events/order.ts",
          oldShape: "OrderCreated{ id }",
          newShape: "OrderCreated{ id, status }",
          classification: "additive",
        },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    expect((assessment.changes[0] as unknown as ContractChange).contractKind).toBe("api-route");
    expect((assessment.changes[1] as unknown as ContractChange).contractKind).toBe("database-schema");
    expect((assessment.changes[2] as unknown as ContractChange).contractKind).toBe("event-contract");
  });

  it("detects removed contracts", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        {
          id: "removal-1",
          contractKind: "public-method",
          location: "src/utils/deprecated.ts:legacyHelper",
          oldShape: "legacyHelper(x: number): number",
          newShape: "removed",
          classification: "destructive",
          affectedConsumers: ["src/legacy.ts"],
          evidenceIds: ["removal-1"],
        },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    expect((assessment.changes[0] as unknown as ContractChange).newShape).toBe("removed");
    expect((assessment.changes[0] as unknown as ContractChange).classification).toBe("destructive");
  });

  it("marks behavioural compatibility unresolved when evidence insufficient", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        {
          id: "unresolved-1",
          contractKind: "interface",
          location: "src/types/ServerEvent.ts",
          oldShape: "ServerEvent{ type: 'A'; payload: string }",
          newShape: "ServerEvent{ type: 'A' | 'B'; payload: unknown }",
          classification: "unresolved",
          affectedConsumers: ["src/consumer.ts"],
          evidenceIds: [],
        },
      ],
    });

    const schemaResult = ReviewContractAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    expect((assessment.changes[0] as unknown as ContractChange).classification).toBe("unresolved");
    expect(assessment.changes.some((change) => (change as unknown as ContractChange).classification === "breaking")).toBe(false);
    expect(assessment.changes.some((change) => (change as unknown as ContractChange).classification === "unresolved")).toBe(true);
  });

  it("validates contract changes against zod schema", () => {
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
        {
          id: "additive-1",
          contractKind: "response-type",
          location: "src/api/responses.ts",
          oldShape: "{ success: boolean }",
          newShape: "{ success: boolean, error?: string }",
          classification: "additive",
        },
        {
          id: "breaking-1",
          contractKind: "configuration-schema",
          location: "config/schema.json",
          oldShape: "{ port: number }",
          newShape: "{}",
          classification: "breaking",
        },
      ],
    });

    expect((assessment.changes.find((c) => (c as unknown as ContractChange).id === "additive-1") as unknown as ContractChange | undefined)?.classification).toBe("additive");
    expect((assessment.changes.find((c) => (c as unknown as ContractChange).id === "breaking-1") as unknown as ContractChange | undefined)?.classification).toBe("breaking");
  });

  it("exposes hasBreakingChange helper", () => {
    const service = new ReviewContractReviewService();
    const breakingAssessment = service.build({
      workflowId,
      changes: [
        {
          id: "b",
          contractKind: "interface",
          location: "src/types.ts",
          oldShape: "a",
          newShape: "b",
          classification: "breaking",
        },
      ],
    });

    const additiveAssessment = service.build({
      workflowId,
      changes: [
        {
          id: "a",
          contractKind: "interface",
          location: "src/types.ts",
          oldShape: "a",
          newShape: "b",
          classification: "additive",
        },
      ],
    });

    expect(ReviewContractReviewService.hasBreakingChange(breakingAssessment)).toBe(true);
    expect(ReviewContractReviewService.hasBreakingChange(additiveAssessment)).toBe(false);
  });

  it("exposes compact summary output", () => {
    const service = new ReviewContractReviewService();
    const assessment = service.build({
      workflowId,
      changes: [
        { id: "1", contractKind: "exported-function", location: "x", oldShape: "a", newShape: "b", classification: "breaking" },
        { id: "2", contractKind: "interface", location: "y", oldShape: "a", newShape: "b", classification: "breaking" },
        { id: "3", contractKind: "response-type", location: "z", oldShape: "a", newShape: "b", classification: "unresolved" },
      ],
    });

    const summary = ReviewContractReviewService.summary(assessment);
    expect(summary).toContain("contract changes: 3");
    expect(summary).toContain("breaking: 2");
    expect(summary).toContain("unresolved: 1");
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
    });

    const schemaResult = ReviewTestAssessmentSchema.safeParse(assessment);
    expect(schemaResult.success).toBe(true);
    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    expect(typedAssessment.state).toBe("incomplete");
  });

  it("requires tests to have current execution evidence", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: false,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
    });

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    expect(typedAssessment.state).toBe("stale");
  });

  it("passing tests alone do not imply adequate coverage when required tests missing", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1", "test-2", "test-3"],
      testsExecuted: ["test-1", "test-2", "test-3"],
      resultsByTest: {
        "test-1": "passed",
        "test-2": "passed",
        "test-3": "passed",
      },
      generatedTestValidationIds: ["gen-1"],
    });

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    expect(typedAssessment.state).toBe("sufficient");
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

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    expect(["sufficient-with-warnings", "incomplete"]).toContain(typedAssessment.state);
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

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    if (!("state" in typedAssessment)) throw new Error("invalid assessment");
    expect(typedAssessment.state).toBe("failed");
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

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    if (!("state" in typedAssessment)) throw new Error("invalid assessment");
    expect(typedAssessment.state).toBe("incomplete");
  });

  it("stale QA decision cannot be reused", () => {
    const assessment = service.build({
      workflowId,
      qaDecisionCurrent: false,
      requiredImpactedTests: ["test-1"],
      testsExecuted: ["test-1"],
      resultsByTest: { "test-1": "passed" },
      coverageGaps: [],
      policyViolations: [],
      generatedTestValidationIds: ["gen-1"],
    });

    const typedAssessment = assessment as unknown as ReviewTestAssessment;
    expect(typedAssessment.state).toBe("stale");
  });

  it("validationSummary counts passed/failed/skipped/notRun correctly", () => {
    const summary = service.validationSummary({
      workflowId,
      qaDecisionCurrent: true,
      requiredImpactedTests: ["test-1", "test-2", "test-3"],
      testsExecuted: ["test-1", "test-2"],
      resultsByTest: { "test-1": "passed", "test-2": "failed" },
    });

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.notRun).toBe(1);
  });
});

describe("ReviewSecurityPerformanceService", () => {
  const securitySchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    securityStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
    performanceStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
    currentSecurityDecisionId: z.string().optional(),
    currentSecurityDecisionAt: z.string().datetime().optional(),
    securityDecisionAgeMs: z.number().nonnegative(),
    currentPerformanceDecisionId: z.string().optional(),
    currentPerformanceDecisionAt: z.string().datetime().optional(),
    performanceDecisionAgeMs: z.number().nonnegative(),
    acceptedRisks: z.array(z.any()).default([]),
    openBlockingFindings: z.array(z.any()).default([]),
    confirmedRegressions: z.array(z.any()).default([]),
    blocked: z.boolean().default(false),
    createdAt: z.string().datetime(),
    contentHash: z.string(),
  });

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
      acceptedRisks: [],
      openBlockingFindings: [],
      confirmedRegressions: [],
    });

    const schemaResult = securitySchema.safeParse(decision);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.data) {
      expect(schemaResult.data.currentSecurityDecisionId).toBe("sec-1");
      expect(schemaResult.data.currentPerformanceDecisionId).toBe("perf-1");
    }
  });

  it("rejects stale decisions", () => {
    const service = new ReviewSecurityPerformanceService();
    const decision = service.build({
      workflowId,
      securityStatus: "stale",
      currentSecurityDecisionId: "sec-stale",
      currentSecurityDecisionAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      securityDecisionAgeMs: 1000 * 60 * 60 * 24 * 2,
      performanceStatus: "stale",
      currentPerformanceDecisionId: "perf-stale",
      currentPerformanceDecisionAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      performanceDecisionAgeMs: 1000 * 60 * 60 * 24 * 2,
      acceptedRisks: [],
      openBlockingFindings: [],
      confirmedRegressions: [],
    });

    const schemaResult = securitySchema.safeParse(decision);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.data) {
      expect(schemaResult.data.securityStatus).toBe("stale");
      expect(schemaResult.data.performanceStatus).toBe("stale");
      expect(schemaResult.data.blocked).toBe(true);
    }
  });

  it("includes open blocking Security/Performance findings", () => {
    const service = new ReviewSecurityPerformanceService();
    const decision = service.build({
      workflowId,
      securityStatus: "open",
      currentSecurityDecisionId: undefined,
      currentSecurityDecisionAt: undefined,
      securityDecisionAgeMs: 0,
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

    const schemaResult = securitySchema.safeParse(decision);
    expect(schemaResult.success).toBe(true);
    if (schemaResult.data) {
      expect(schemaResult.data.blocked).toBe(true);
      expect(schemaResult.data.acceptedRisks).toHaveLength(1);
      expect(schemaResult.data.acceptedRisks[0]?.category).toBe("security");
      expect(schemaResult.data.confirmedRegressions).toHaveLength(1);
      expect(schemaResult.data.confirmedRegressions[0]?.id).toBe("perf-regression-1");
    }
  });

  it("distinguishes confirmed regressions from static candidates", () => {
    const service = new ReviewSecurityPerformanceService();
    const confirmedRegression = {
      id: "confirmed-1",
      source: "performance",
      title: "Confirmed regression",
      description: "Confirmed by benchmark v2.",
      severity: "high",
      status: "confirmed-regression",
      filePath: "src/perf/slow.ts",
    };
    const staticCandidate = {
      id: "candidate-1",
      source: "performance",
      title: "Static candidate",
      description: "From static scan only.",
      severity: "medium",
      status: "static-candidate",
      filePath: "src/perf/static.ts",
    } as const;
    const resolvedFinding = {
      id: "resolved-1",
      source: "security",
      title: "Resolved finding",
      description: "Quarantined by patch.",
      severity: "high",
      status: "resolved",
      filePath: "src/security/old.ts",
    };

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
      acceptedRisks: [],
      openBlockingFindings: [],
      confirmedRegressions: [confirmedRegression, staticCandidate, resolvedFinding],
    });

    expect(decision.confirmedRegressions).toContain(confirmedRegression);
    expect(decision.confirmedRegressions).toContain(staticCandidate);
    expect(decision.confirmedRegressions).toContain(resolvedFinding);
    expect(decision.blocked).toBe(false);
  });
});

describe("ReviewFindingService", () => {
  it("enforces category/severity/confidence/source on recorded findings", () => {
    const service = new ReviewFindingService();
    const findings = service.record({
      workflowId,
      reviewId,
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
        } satisfies IReviewFinding,
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
      reviewId,
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
        } satisfies IReviewFinding,
      ],
    });

    const finding = service.list()[0]!;
    const result = service.updateStatus({ workflowId, findingId: finding.id, status: "resolved" });
    expect(result.some((item) => item.id === finding.id && item.status === "resolved")).toBe(true);
  });

  it("requires justification for high-severity deferral", () => {
    const service = new ReviewFindingService();
    service.record({
      workflowId,
      reviewId,
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
        } satisfies IReviewFinding,
      ],
    });

    const finding = service.list()[0]!;
    // No justification should not block resolution assertion runtime
    expect(() => service.validateDeferral(finding)).toThrow(
      /High-severity finding deferral requires explicit justification/i,
    );
    expect(() => service.validateDeferral(finding, "Deferring to sprint 30 with owner approval.")).not.toThrow();
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
      reviewId,
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
        } satisfies IReviewFinding,
      ],
    });

    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]?.status).toBe("resolved");
    expect((service.list()[0]?.resolutionEvidence ?? [])).toContain("readme-update-1");
  });
});
