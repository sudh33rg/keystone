/**
 * Phase 8 Security & Performance Intelligence tests (spec §54).
 *
 * Covers: attack-surface discovery + exposure classification, trust boundaries, auth/authorization
 * paths, deterministic sensitive-data classification, proven/inferred data-flow distinction,
 * source-to-sink traversal with validator recognition, secret redaction, security impact scoring,
 * finding severity, security gate evaluation, critical-path discovery, DB-call / N+1 rules, external
 * fan-out, blocking classification, baseline compatibility, comparison calculation, performance gate,
 * and safety tests (raw-secret prevention, incompatible-baseline warning, accepted-risk audit).
 */
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../../src/core/context/compressionUtils";
import {
  AttackSurfaceDiscoveryService,
  TrustBoundaryService,
  AuthenticationPathService,
  AuthorizationPathService,
  SensitiveDataClassificationService,
  SensitiveDataFlowService,
  SecurityValidatorRegistry,
  SecurityPathAnalysisService,
  SecurityImpactService,
  SecurityFindingService,
  SecurityGateService,
  SecurityAnalysisAssembler,
  type EntityInput,
} from "../../../../src/core/intelligence/security/SecurityIntelligenceServices";
import {
  CriticalPathDiscoveryService,
  DatabaseInteractionAnalysisService,
  ExternalCallAnalysisService,
  LoopFanoutAnalysisService,
  BlockingOperationAnalysisService,
  PerformanceBaselineService,
  PerformanceComparisonService,
  PerformanceFindingService,
  PerformanceGateService,
  PerformanceAnalysisAssembler,
  RiskAcceptanceService,
  FindingRemediationRouter,
  AnalysisFreshnessService,
} from "../../../../src/core/intelligence/security/PerformanceIntelligenceServices";
import {
  SecurityFindingSchema,
  PerformanceFindingSchema,
  PerformanceRuntimeEvidenceSchema,
  SecurityPathCategorySchema,
  type SecurityFinding,
} from "../../../../src/shared/contracts/qaSecurity";
import { InMemoryQaStore } from "../../../../src/core/intelligence/qa/QaStore";

const ent = (
  o: Partial<EntityInput> & Pick<EntityInput, "entityId" | "displayName" | "roles">,
): EntityInput => o;

describe("AttackSurfaceDiscoveryService + ExposureClassificationService", () => {
  it("classifies a declared public route as public-external and discovers it as an attack surface", () => {
    const svc = new AttackSurfaceDiscoveryService();
    const surface = svc.discover([
      ent({
        entityId: "route:1",
        displayName: "GET /users",
        roles: ["route", "public"],
        frameworkRegistration: "express GET /users",
      }),
      ent({ entityId: "svc:internal", displayName: "helper", roles: ["function"] }),
    ]);
    const entry = surface.entries.find((e) => e.entityId === "route:1")!;
    expect(entry).toBeDefined();
    expect(entry.exposure).toBe("public-external");
    expect(entry.authenticationRequired).toBe(false);
    // Internal-only helper is NOT treated as an external attack surface.
    expect(surface.entries.find((e) => e.entityId === "svc:internal")).toBeUndefined();
  });

  it("classifies an authenticated route with authorization requirement", () => {
    const svc = new AttackSurfaceDiscoveryService();
    const surface = svc.discover([
      ent({
        entityId: "route:2",
        displayName: "POST /admin",
        roles: ["route", "auth", "authz", "admin"],
        frameworkRegistration: "express POST /admin",
      }),
    ]);
    const entry = surface.entries[0]!;
    expect(entry.exposure).toBe("administrative");
    expect(entry.authenticationRequired).toBe(true);
    expect(entry.authorizationRequired).toBe(true);
  });

  it("does not treat every exported function as external attack surface", () => {
    const svc = new AttackSurfaceDiscoveryService();
    const surface = svc.discover([
      ent({ entityId: "util:1", displayName: "formatDate", roles: ["function"] }),
    ]);
    expect(surface.entries.length).toBe(0);
  });
});

describe("TrustBoundaryService", () => {
  it("builds a trust boundary with crossing entities and evidence", () => {
    const svc = new TrustBoundaryService();
    const tb = svc.build(
      [
        { id: "browser", name: "Browser" },
        { id: "api", name: "API" },
      ],
      [
        {
          sourceZone: "browser",
          destinationZone: "api",
          entityIds: ["route:1"],
          dataTypes: ["user-input"],
          evidence: ["entry route:1"],
        },
      ],
    );
    expect(tb[0]!.sourceZone).toBe("browser");
    expect(tb[0]!.destinationZone).toBe("api");
    expect(tb[0]!.crossingEntityIds).toContain("route:1");
  });
});

describe("AuthenticationPathService + AuthorizationPathService", () => {
  it("traces an auth path and flags missing authentication evidence", () => {
    const svc = new AuthenticationPathService();
    const p = svc.analyze("route:1", [{ kind: "handler", entityId: "h1" }]);
    expect(p.hasAuthenticationEvidence).toBe(false);
    expect(p.entryPointEntityId).toBe("route:1");
  });

  it("flags authorization-after-data-access as a finding", () => {
    const svc = new AuthorizationPathService();
    const p = svc.analyze("op:1", undefined, "none-visible", {
      authorizationAfterDataAccess: true,
      hasAuthorizationEvidence: false,
    });
    expect(p.hasAuthorizationEvidence).toBe(false);
    expect(p.authorizationAfterDataAccess).toBe(true);
    expect(p.checkType).toBe("none-visible");
  });
});

describe("SensitiveDataClassificationService", () => {
  it("classifies credential-like field names deterministically with confidence", () => {
    const svc = new SensitiveDataClassificationService();
    expect(svc.classify("userPassword").category).toBe("authentication-credential");
    expect(svc.classify("apiKey").category).toBe("access-token");
    expect(svc.classify("firstName").category).toBe("unknown-sensitive-data");
  });

  it("does not claim a category from names alone with high confidence", () => {
    const svc = new SensitiveDataClassificationService();
    const r = svc.classify("notes");
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe("SensitiveDataFlowService", () => {
  it("distinguishes proven vs inferred vs unresolved relationships", () => {
    const svc = new SensitiveDataFlowService();
    const proven = svc.track("src:1", "log:1", ["secret"], "proven", {
      crossesTrustBoundary: true,
    });
    const inferred = svc.track("src:2", "ext:1", ["contact-information"], "inferred");
    expect(proven.relationship).toBe("proven");
    expect(proven.crossesTrustBoundary).toBe(true);
    expect(inferred.relationship).toBe("inferred");
  });
});

describe("SecurityPathAnalysisService + SecurityValidatorRegistry", () => {
  it("recognizes effective validators/sanitizers and lowers risk while remaining a candidate", () => {
    const reg = new SecurityValidatorRegistry();
    reg.register({
      entityId: "san:1",
      capability: "html-escape",
      supportedInputTypes: ["string"],
      confidence: 0.9,
      limitations: [],
      unsafeBypass: false,
    });
    const svc = new SecurityPathAnalysisService(reg);
    const path = svc.analyze({
      sourceEntityId: "in:1",
      sinkEntityId: "html:1",
      category: "cross-site-scripting-candidate",
      sanitizers: ["san:1"],
    });
    expect(SecurityPathCategorySchema.options).toContain(path.category);
    expect(reg.isEffectiveValidator("san:1")).toBe(true);
    expect(path.confidence).toBeLessThan(0.6); // candidate, not confirmed
  });

  it("flags unresolved transformations as higher-risk candidate", () => {
    const svc = new SecurityPathAnalysisService();
    const path = svc.analyze({
      sourceEntityId: "in:1",
      sinkEntityId: "db:1",
      category: "injection-candidate",
      unresolvedTransformations: ["unknown-transform"],
    });
    expect(path.confidence).toBeGreaterThan(0.5);
  });
});

// __APPEND_PERF__

describe("Secret redaction (acceptance §10)", () => {
  it("redacts high-confidence secret values from text and evidence", () => {
    const { redacted, redactedCount } = redactSecrets(
      "password = supersecret123\napi_key=xyz987654321",
    );
    expect(redacted).not.toContain("supersecret123");
    expect(redacted).not.toContain("xyz987654321");
    expect(redactedCount).toBeGreaterThan(0);
    expect(redacted).toContain("[REDACTED]");
  });

  it("never persists a raw secret in a SecurityFinding", () => {
    const svc = new SecurityFindingService();
    const f: SecurityFinding = svc.create({
      id: "sf:1",
      analysisId: "sa:1",
      category: "secret-exposure-candidate",
      title: "Secret in log",
      description: redactSecrets("apiKey = realkey123").redacted,
      severity: "high",
      confidence: 0.8,
      scope: { entityIds: ["log:1"], flowIds: [], pathIds: [], filePaths: [] },
      evidenceIds: [],
      recommendation: { action: "Redact the secret" },
    });
    expect(SecurityFindingSchema.safeParse(f).success).toBe(true);
    expect(f.description).not.toContain("realkey123");
  });
});

describe("SecurityImpactService + SecurityFindingService + SecurityGateService", () => {
  it("scores higher risk contribution when changed roots intersect security paths", () => {
    const svc = new SecurityImpactService();
    const c = svc.contribution(["route:1", "db:1"], ["route:1", "log:1"]);
    expect(c).toBeGreaterThan(0);
    const none = svc.contribution(["unrelated"], ["route:1"]);
    expect(none).toBe(0);
  });

  it("creates a finding with severity and open status", () => {
    const svc = new SecurityFindingService();
    const f = svc.create({
      id: "sf:2",
      analysisId: "sa:1",
      category: "injection-candidate",
      title: "SQLi",
      description: "x",
      severity: "high",
      confidence: 0.7,
      scope: { entityIds: ["db:1"], flowIds: [], pathIds: [], filePaths: [] },
      evidenceIds: [],
      recommendation: { action: "Parameterize query" },
    });
    expect(f.status).toBe("open");
    expect(svc.severityRank("critical")).toBeGreaterThan(svc.severityRank("low"));
  });

  it("evaluates a gate as blocking when it fails", () => {
    const svc = new SecurityGateService();
    const g = svc.evaluate("no-open-critical", false, {
      analysisId: "sa:1",
      evidence: ["critical finding open"],
      remediationAction: "Fix authz",
    });
    expect(g.passed).toBe(false);
    expect(g.blocking).toBe(true);
    expect(g.remediationAction).toBe("Fix authz");
  });
});

describe("CriticalPathDiscoveryService", () => {
  it("discovers critical paths with explicit marks", () => {
    const svc = new CriticalPathDiscoveryService();
    const paths = svc.discover([
      {
        entityId: "route:pay",
        kind: "request-response",
        mark: "configured-critical",
        confidence: 0.9,
      },
      { entityId: "evt:order", kind: "event-processing", mark: "inferred" },
    ]);
    expect(paths.find((p) => p.entryEntityId === "route:pay")!.mark).toBe("configured-critical");
    expect(paths.find((p) => p.entryEntityId === "evt:order")!.mark).toBe("inferred");
  });
});

describe("DatabaseInteractionAnalysisService + N+1 rules", () => {
  it("flags N+1 candidate only without batching/caching evidence", () => {
    const svc = new DatabaseInteractionAnalysisService();
    const bad = svc.analyze({
      entityId: "repo:1",
      operation: "read",
      inLoop: true,
      perItemQuery: true,
    });
    const finding = svc.nPlusOneCandidate(bad);
    expect(finding).not.toBeNull();
    expect(finding!.category).toBe("n-plus-one-candidate");

    const ok = svc.analyze({
      entityId: "repo:1",
      operation: "read",
      inLoop: true,
      perItemQuery: true,
      batchingEvidence: true,
    });
    expect(svc.nPlusOneCandidate(ok)).toBeNull();
  });
});

describe("ExternalCallAnalysisService + LoopFanoutAnalysisService", () => {
  it("detects a query inside a loop as a candidate, not a false positive without loop evidence", () => {
    const loop = new LoopFanoutAnalysisService();
    expect(loop.detectInLoop("handler", ["db.query"], true).found).toBe(true);
    expect(loop.detectInLoop("handler", ["db.query"], false).found).toBe(false);
  });

  it("records external-call fan-out breadth", () => {
    const svc = new ExternalCallAnalysisService();
    const call = svc.analyze({
      entityId: "svc:1",
      target: "https://api",
      inLoop: true,
      fanOutBreadth: 12,
      timeoutConfigured: false,
    });
    expect(call.fanOutBreadth).toBe(12);
    expect(call.timeoutConfigured).toBe(false);
  });
});

describe("BlockingOperationAnalysisService", () => {
  it("classifies definite synchronous operations as blocking", () => {
    const svc = new BlockingOperationAnalysisService();
    const r = svc.classify("fs.readFileSync(path)", false);
    expect(r.blocking).toBe(true);
    expect(r.certain).toBe(true);
  });

  it("does not treat ordinary async code as a defect", () => {
    const svc = new BlockingOperationAnalysisService();
    const r = svc.classify("await db.find()", false);
    expect(r.certain).toBe(false);
  });
});

describe("PerformanceBaselineService + PerformanceComparisonService", () => {
  it("selects an explicit baseline and never silently uses the most recent run", () => {
    const svc = new PerformanceBaselineService();
    const a = svc.create({
      benchmarkOrScenario: "api-latency",
      metric: "p95-ms",
      sampleCount: 30,
      aggregationMethod: "p95",
      value: 100,
      source: "previous-workflow",
      confidence: 0.8,
      revision: "r1",
    });
    const b = svc.create({
      benchmarkOrScenario: "api-latency",
      metric: "p95-ms",
      sampleCount: 30,
      aggregationMethod: "p95",
      value: 120,
      source: "previous-workflow",
      confidence: 0.8,
      revision: "r2",
    });
    expect(svc.select([a, b], "api-latency", "p95-ms")?.value).toBe(100);
  });

  it("warns on incompatible environment rather than misleading comparison", () => {
    const cmp = new PerformanceComparisonService();
    const current = PerformanceRuntimeEvidenceSchema.parse({
      id: "ev:1",
      tool: "bench",
      command: "npm run bench",
      scenario: "api-latency",
      metric: "p95-ms",
      unit: "ms",
      sampleCount: 10,
      baseline: 100,
      currentValue: 150,
      variance: 0.2,
      confidence: 0.7,
      environmentFingerprint: "env:A",
      repositoryRevision: "r2",
    });
    const baseline = new PerformanceBaselineService().create({
      benchmarkOrScenario: "api-latency",
      metric: "p95-ms",
      sampleCount: 30,
      aggregationMethod: "p95",
      value: 100,
      source: "previous-workflow",
      confidence: 0.8,
      environmentFingerprint: "env:B",
      revision: "r1",
    });
    const r = cmp.compare(current, baseline);
    expect(r.regression).toBe(true);
    expect(r.compatible).toBe(false);
    expect(r.warning).toContain("Environment");
  });

  it("flags insufficient samples as measurement-required", () => {
    const cmp = new PerformanceComparisonService();
    const current = PerformanceRuntimeEvidenceSchema.parse({
      id: "ev:2",
      tool: "bench",
      command: "npm run bench",
      scenario: "api-latency",
      metric: "p95-ms",
      unit: "ms",
      sampleCount: 1,
      baseline: 100,
      currentValue: 150,
      variance: 0.2,
      confidence: 0.4,
      environmentFingerprint: "env:A",
      repositoryRevision: "r1",
    });
    const baseline = new PerformanceBaselineService().create({
      benchmarkOrScenario: "api-latency",
      metric: "p95-ms",
      sampleCount: 30,
      aggregationMethod: "p95",
      value: 100,
      source: "previous-workflow",
      confidence: 0.8,
      environmentFingerprint: "env:A",
      revision: "r1",
    });
    const r = cmp.compare(current, baseline);
    expect(r.sufficient).toBe(false);
    expect(r.warning).toContain("Insufficient");
  });
});

describe("PerformanceFindingService + PerformanceGateService", () => {
  it("creates a performance finding and validates the schema", () => {
    const svc = new PerformanceFindingService();
    const f = svc.create({
      id: "pf:1",
      analysisId: "pa:1",
      category: "latency-regression",
      title: "Latency",
      description: "x",
      severity: "medium",
      confidence: 0.6,
      scope: { entityIds: ["route:1"], flowIds: [], filePaths: [] },
      staticEvidenceIds: [],
      runtimeEvidenceIds: [],
      recommendation: { action: "profile" },
    });
    expect(PerformanceFindingSchema.safeParse(f).success).toBe(true);
    expect(f.status).toBe("open");
  });

  it("evaluates a performance gate that requires a baseline when none exists", () => {
    const svc = new PerformanceGateService();
    const g = svc.evaluate("baseline-present", false, {
      analysisId: "pa:1",
      evidence: ["no compatible baseline"],
      remediationAction: "capture baseline",
    });
    expect(g.passed).toBe(false);
    expect(g.kind).toBe("performance");
  });
});

describe("Shared services (risk acceptance, remediation routing, freshness)", () => {
  it("requires reason + approver for accepted risk and records it", () => {
    const svc = new RiskAcceptanceService();
    const acc = svc.accept({
      findingId: "sf:1",
      reason: "Low-impact internal endpoint",
      approvedBy: "user",
      scope: "log:1",
    });
    expect(acc.reason).toBeTruthy();
    expect(acc.approvedBy).toBe("user");
  });

  it("routes a finding to a bounded remediation work item", () => {
    const router = new FindingRemediationRouter();
    const link = router.route(
      "sf:1",
      "security-validation",
      ["log:1"],
      "security-remediation-profile",
    );
    expect(link.targetStage).toBe("security-validation");
    expect(link.allowedScope).toContain("log:1");
  });

  it("marks an analysis stale when relevant triggers fire", () => {
    const svc = new AnalysisFreshnessService();
    const f = svc.evaluate("sa:1", ["validators changed", "intelligence revision changed"]);
    expect(f.fresh).toBe(false);
    expect(f.reasons.length).toBe(2);
  });
});

describe("Phase 8 QaStore persistence (acceptance §35 / §58)", () => {
  it("round-trips security analyses, findings, and gates", () => {
    const store = new InMemoryQaStore();
    const surface = new AttackSurfaceDiscoveryService().discover([
      ent({
        entityId: "route:1",
        displayName: "GET /users",
        roles: ["route", "public"],
        frameworkRegistration: "express GET /users",
      }),
    ]);
    const analysis = new SecurityAnalysisAssembler().build({
      id: "sa:1",
      changeSetId: "cs:1",
      rootEntityIds: ["route:1"],
      attackSurface: surface,
      intelligenceRevision: "int:1",
      specificationRevision: "spec:1",
      riskLevel: "high",
    });
    store.saveSecurityAnalysis(analysis);
    expect(store.getSecurityAnalysis("sa:1")!.id).toBe("sa:1");
    expect(store.listSecurityAnalyses("cs:1").length).toBe(1);

    const f = new SecurityFindingService().create({
      id: "sf:1",
      analysisId: "sa:1",
      category: "injection-candidate",
      title: "x",
      description: "d",
      severity: "high",
      confidence: 0.7,
      scope: { entityIds: ["db:1"], flowIds: [], pathIds: [], filePaths: [] },
      evidenceIds: [],
      recommendation: { action: "parameterize" },
    });
    store.saveSecurityFinding(f);
    expect(store.getSecurityFinding("sf:1")!.status).toBe("open");
    expect(store.listSecurityFindings("sa:1").length).toBe(1);

    const g = new SecurityGateService().evaluate("no-open-critical", false, { analysisId: "sa:1" });
    store.saveGateEvaluation(g);
    expect(store.getGateEvaluation(g.id)!.blocking).toBe(true);
  });

  it("round-trips performance analyses, runtimes, baselines, and freshness", () => {
    const store = new InMemoryQaStore();
    const criticalPaths = new CriticalPathDiscoveryService().discover([
      {
        entityId: "route:pay",
        kind: "request-response",
        mark: "configured-critical",
        confidence: 0.9,
      },
    ]);
    const analysis = new PerformanceAnalysisAssembler().build({
      id: "pa:1",
      changeSetId: "cs:1",
      rootEntityIds: ["route:pay"],
      criticalPaths,
      intelligenceRevision: "int:1",
      riskLevel: "medium",
    });
    store.savePerformanceAnalysis(analysis);
    expect(store.getPerformanceAnalysis("pa:1")!.id).toBe("pa:1");

    const ev = PerformanceRuntimeEvidenceSchema.parse({
      id: "ev:1",
      tool: "bench",
      command: "npm run bench",
      scenario: "api-latency",
      metric: "p95-ms",
      unit: "ms",
      sampleCount: 10,
      baseline: 100,
      currentValue: 150,
      variance: 0.2,
      confidence: 0.7,
      environmentFingerprint: "env:A",
      repositoryRevision: "r1",
    });
    store.savePerformanceRuntimeEvidence(ev);
    expect(store.getPerformanceRuntimeEvidence("ev:1")!.currentValue).toBe(150);

    const base = new PerformanceBaselineService().create({
      benchmarkOrScenario: "api-latency",
      metric: "p95-ms",
      sampleCount: 30,
      aggregationMethod: "p95",
      value: 100,
      source: "previous-workflow",
      confidence: 0.8,
      revision: "r1",
    });
    store.savePerformanceBaseline(base);
    expect(store.listPerformanceBaselines("api-latency").length).toBe(1);

    const fresh = new AnalysisFreshnessService().evaluate("pa:1", []);
    store.saveAnalysisFreshness(fresh);
    expect(store.getAnalysisFreshness("pa:1")!.fresh).toBe(true);
  });
});
