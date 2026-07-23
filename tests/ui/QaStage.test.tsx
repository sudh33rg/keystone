// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaStage } from "../../src/ui/components/workbench/QaStage";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

const workflowId = "00000000-0000-4000-8000-000000000081";

const qaAggregate = {
  workflowId,
  impactAnalysis: {
    id: "impact-1",
    workflowId,
    changeSetId: "cs-1",
    intelligenceRevision: "rev-1",
    changedEntityIds: ["svc"],
    impacts: [],
    affectedFlowIds: [],
    affectedContractIds: [],
    mappedTests: [],
    coverageGaps: [{ id: "gap-1", entityId: "svc", flowId: undefined, reason: "No test exercises the success path.", confidence: 1, recommendedTestLayer: "e2e", blocking: false }],
    graph: { rootEntityIds: [], nodes: [], edges: [], request: { mode: "calls", direction: "both", depth: 1, relationshipTypes: [], maxNodes: 50, maxEdges: 100, minimumConfidence: 0 }, truncation: { truncated: false, nodeLimitReached: false, edgeLimitReached: false, expandableEntityIds: [] }, intelligenceRevision: "rev-1" },
    risk: { level: "low", factors: [] },
    status: "accepted",
    createdAt: new Date().toISOString(),
    contentHash: "sha256:impact",
    summary: "Impact analysis for svc",
  },
  qaPlan: {
    id: "plan-1",
    workflowId,
    impactAnalysisId: "impact-1",
    impactHash: "sha256:impact",
    changeSetHash: "sha256:change",
    requiredItems: [],
    recommendedItems: [],
    optionalItems: [],
    coverageGapIds: ["gap-1"],
    status: "approved",
    createdAt: new Date().toISOString(),
    contentHash: "sha256:plan",
  },
  capabilities: [],
  decision: {
    id: "dec-1",
    workflowId,
    qaPlanId: "plan-1",
    decision: "passed",
    gates: [],
    unresolvedFailureIds: [],
    coverageGapIds: [],
    createdAt: new Date().toISOString(),
    contentHash: "sha256:dec",
  },
  changedEntities: [],
};

function tiReply(type: string): unknown {
  if (type === "testIntelligence.load")
    return { workflowId, generationRequests: [], scenarios: [], generationProposals: [], failureAnalyses: [], failureRecords: [], flakyRuns: [], flakyClassifications: [], remediationProposals: [], policyAssessments: [], validations: [], appliedChanges: [], updatedAt: new Date().toISOString() };
  return qaAggregate;
}

describe("QaStage — QA Test Intelligence sections", () => {
  beforeEach(() => {});

  afterEach(() => vi.restoreAllMocks());

  it("renders the QA sections and dispatches coverage-gap test generation", async () => {
    const request = vi.fn(async (type: string) => tiReply(type));
    render(<QaStage bridge={{ request, subscribe: () => () => {} } as unknown as HostBridge} workflowId={workflowId} onWorkflowChange={() => {}} />);

    // QA sections are present.
    expect(await screen.findByRole("heading", { name: "Coverage Gaps" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Test Generation Proposals" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Failure Analysis" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Flaky-Test Analysis" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Policy Assessments" })).toBeTruthy();

    // The coverage gap offers a generation request button.
    const generate = await screen.findByRole("button", { name: /Generate tests for this gap/i });
    fireEvent.click(generate);

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "testIntelligence.createGenerationRequest",
        expect.objectContaining({ workflowId, coverageGapId: "gap-1" }),
      ),
    );
  });

  it("dispatches failure analysis from the Analyze failure form", async () => {
    const request = vi.fn(async (type: string) => tiReply(type));
    render(<QaStage bridge={{ request, subscribe: () => () => {} } as unknown as HostBridge} workflowId={workflowId} onWorkflowChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Test failure id/i), { target: { value: "svc.test.ts::renders" } });
    fireEvent.change(screen.getByLabelText(/File path/i), { target: { value: "svc.test.ts" } });
    fireEvent.change(screen.getByLabelText(/Failure message/i), { target: { value: "TypeError: cannot read property" } });
    fireEvent.click(screen.getByRole("button", { name: /Analyze failure/i }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "testIntelligence.createFailureAnalysis",
        expect.objectContaining({ workflowId, testFailureId: "svc.test.ts::renders", testFilePath: "svc.test.ts", message: "TypeError: cannot read property" }),
      ),
    );
  });

  it("requests repeated runs from the flaky section", async () => {
    const request = vi.fn(async (type: string) => tiReply(type));
    render(<QaStage bridge={{ request, subscribe: () => () => {} } as unknown as HostBridge} workflowId={workflowId} onWorkflowChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Test id/i), { target: { value: "svc.test.ts::renders" } });
    fireEvent.click(screen.getByRole("button", { name: /Request repeated runs/i }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "testIntelligence.requestRepeatedRuns",
        expect.objectContaining({ workflowId, testId: "svc.test.ts::renders", count: 3, mode: "default" }),
      ),
    );
  });
});
