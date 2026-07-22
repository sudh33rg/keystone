import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  QaTestIntelligenceAggregateSchema,
  TEST_INTELLIGENCE_REQUESTS,
  type TestIntelligenceRequestType,
} from "../../../src/shared/contracts/phase8TestIntelligence";
import { TestIntelligenceService } from "../../../src/core/impactQa/TestIntelligenceService";
import { QaTestIntelligencePersistence } from "../../../src/core/impactQa/QaTestIntelligencePersistence";
import type { ImpactQaAggregate } from "../../../src/shared/contracts/impactQa";

const workflowId = "00000000-0000-4000-8000-000000000081";

class StubQa {
  state: ImpactQaAggregate;
  constructor() {
    this.state = {
      workflowId,
      impactAnalysis: {
        id: "impact-1", workflowId, changeSetId: "cs", intelligenceRevision: "r", changedEntityIds: ["svc"],
        impacts: [], affectedFlowIds: [], affectedContractIds: [], mappedTests: [], risk: { level: "low", factors: [] },
        coverageGaps: [{ id: "gap-1", entityId: "svc", flowId: undefined, reason: "untested", confidence: 1, recommendedTestLayer: "e2e", blocking: false }],
        graph: { rootEntityIds: [], nodes: [], edges: [], request: { mode: "calls", direction: "both", depth: 1, relationshipTypes: [], maxNodes: 50, maxEdges: 100, minimumConfidence: 0 }, truncation: { truncated: false, nodeLimitReached: false, edgeLimitReached: false, expandableEntityIds: [] }, intelligenceRevision: "r" },
        status: "accepted", createdAt: new Date().toISOString(), contentHash: "h", summary: "Stub impact analysis",
      },
      qaPlan: { id: "plan-1", workflowId, impactAnalysisId: "impact-1", impactHash: "h", changeSetHash: "h", requiredItems: [], recommendedItems: [], optionalItems: [], coverageGapIds: ["gap-1"], status: "approved", createdAt: new Date().toISOString(), contentHash: "h" },
      capabilities: [{ id: "vitest", framework: "vitest", sourceFiles: ["package.json"], availability: "available", commands: [{ id: "c", frameworkId: "vitest", displayName: "t", executable: "npm", arguments: ["t"], workingDirectory: ".", scope: "test-file", source: "package-script", timeoutMs: 1 }] }],
      decision: { id: "d", workflowId, qaPlanId: "plan-1", decision: "passed", gates: [], unresolvedFailureIds: [], coverageGapIds: [], createdAt: new Date().toISOString(), contentHash: "h" },
      changedEntities: [],
    };
  }
  async load(): Promise<ImpactQaAggregate> { return this.state; }
}

class StubHost {
  async workspaceFiles(): Promise<Set<string>> { return new Set(); }
  async readSource(): Promise<string> { throw new Error("no source"); }
}

const cid = "corr-000000000000000000000001";
const base = { correlationId: cid, workflowId };

const samples: Record<TestIntelligenceRequestType, unknown> = {
  "testIntelligence.load": base,
  "testIntelligence.createGenerationRequest": { ...base, coverageGapId: "gap-1" },
  "testIntelligence.deriveScenarios": { ...base, generationRequestId: "g" },
  "testIntelligence.updateScenario": { ...base, scenarioId: "s", selected: true },
  "testIntelligence.approveScenarios": { ...base, generationRequestId: "g" },
  "testIntelligence.buildGenerationContext": { ...base, generationRequestId: "g", budgetTokens: 1000 },
  "testIntelligence.approveGenerationContext": { ...base, generationRequestId: "g", packageId: "11111111-1111-4111-8111-111111111111", revision: 1, fingerprint: "a".repeat(64) },
  "testIntelligence.recordProposal": { ...base, generationRequestId: "g", proposal: { summary: "s", scenarioMappings: [], fileChanges: [{ id: "f", proposalId: "p1", filePath: "x.test.ts", changeType: "create", diff: "y", classification: "test", selected: true }], assumptions: [], testsToRun: [], unresolvedIssues: [] } },
  "testIntelligence.validateProposalPolicy": { ...base, proposalId: "p" },
  "testIntelligence.applyProposal": { ...base, proposalId: "p", selectedChangeIds: ["f"] },
  "testIntelligence.revertApplied": { ...base, appliedChangeId: "a" },
  "testIntelligence.createFailureAnalysis": { ...base, testFailureId: "t" },
  "testIntelligence.acceptFailureClassification": { ...base, analysisId: "a", category: "unknown" },
  "testIntelligence.requestRepeatedRuns": { ...base, testId: "t", count: 1, mode: "default" },
  "testIntelligence.loadFlakyHistory": { ...base, testId: "t" },
  "testIntelligence.createRemediationProposal": { ...base, analysisId: "a", proposal: { summary: "s", scenarioMappings: [], fileChanges: [], assumptions: [], testsToRun: [], unresolvedIssues: [] } },
  "testIntelligence.validateRemediationPolicy": { ...base, proposalId: "p" },
  "testIntelligence.applyRemediation": { ...base, proposalId: "p", selectedChangeIds: ["f"] },
  "testIntelligence.runValidationSequence": { ...base, source: "test-generation", sourceRecordId: "r" },
  "testIntelligence.loadValidationState": { ...base, source: "test-generation", sourceRecordId: "r" },
  "testIntelligence.refreshQaDecision": base,
};

describe("Phase 8 — protocol contract", () => {
  it("defines exactly the 21 testIntelligence request types", () => {
    expect(Object.keys(TEST_INTELLIGENCE_REQUESTS)).toHaveLength(21);
  });

  it("every request type validates against its own schema", () => {
    const types = Object.keys(TEST_INTELLIGENCE_REQUESTS) as TestIntelligenceRequestType[];
    for (const type of types) {
      const result = TEST_INTELLIGENCE_REQUESTS[type].safeParse(samples[type]);
      expect(result.success, `request ${type} should validate: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it("rejects a request with an unknown extra field under .strict()", () => {
    const result = TEST_INTELLIGENCE_REQUESTS["testIntelligence.load"].safeParse({ ...base, bogus: 1 });
    expect(result.success).toBe(false);
  });
});

describe("Phase 8 — aggregate contract round-trip", () => {
  let root: string;
  let service: TestIntelligenceService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keystone-p8-proto-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1.0.0" } }));
    service = new TestIntelligenceService(root, new QaTestIntelligencePersistence(root), new StubQa() as never, {} as never, new StubHost());
    await service.initialize();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("aggregate produced by the orchestrator validates against QaTestIntelligenceAggregateSchema", async () => {
    const created = await service.createGenerationRequest(workflowId, "gap-1");
    const result = QaTestIntelligenceAggregateSchema.safeParse(created);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) {
      expect(result.data.generationRequests[0]?.coverageGapId).toBe("gap-1");
    }
  });
});
