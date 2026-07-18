// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentWorkspace } from "../../src/ui/components/delegation/DevelopmentWorkspace";
import type { DevelopmentWorkflowSnapshot } from "../../src/shared/contracts/delegation";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("DevelopmentWorkspace", () => {
  it("captures intent through the typed workflow request and renders repository resolution", async () => {
    const workflow = workflowFixture(false);
    const request = vi.fn((type: string) => {
      if (type === "workflow/list") return Promise.resolve([]);
      if (type === "copilot/capabilities") return Promise.resolve(capabilities(false));
      if (type === "copilot/agents") return Promise.resolve([]);
      if (type === "workflow/capture") return Promise.resolve(workflow);
      return Promise.resolve(undefined);
    });
    render(<DevelopmentWorkspace bridge={{ request } as unknown as HostBridge} section="intent"/>);
    await waitFor(() => expect(request).toHaveBeenCalledWith("workflow/list", {}));
    fireEvent.change(screen.getByLabelText("Development intent"), { target: { value: "Implement safe delegation" } });
    fireEvent.change(screen.getByLabelText("Development mode"), { target: { value: "guided" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture intent" }));
    expect(await screen.findByText("ResolvedSymbol")).toBeTruthy();
    expect(screen.getByText((_content, element) => element?.tagName === "P" && element.textContent === "ResolvedSymbol — Exact intelligence result.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("workflow/capture", { text: "Implement safe delegation", mode: "guided" });
  });

  it("shows unavailable capability state and never renders a fabricated default agent", async () => {
    const workflow = workflowFixture(true);
    const request = vi.fn((type: string) => {
      if (type === "workflow/list") return Promise.resolve([workflow]);
      if (type === "copilot/capabilities") return Promise.resolve(capabilities(false));
      if (type === "copilot/agents") return Promise.resolve([]);
      if (type === "context/get" || type === "delegation/getPrompt") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    render(<DevelopmentWorkspace bridge={{ request } as unknown as HostBridge} section="tasks"/>);
    expect(await screen.findByText(/Copilot absent/)).toBeTruthy();
    expect(screen.getByText(/discovery unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /default agent/i })).toBeNull();
  });
});

function capabilities(extensionDetected: boolean) {
  return { schemaVersion: 1 as const, detectedAt: "2026-07-16T10:00:00.000Z", extensionDetected, extensionVersions: {}, chatAvailable: false, agentModeAvailable: false, agentDiscoveryAvailable: false, directInvocationAvailable: false, promptInsertionAvailable: false, completionEventsAvailable: false, resultCaptureAvailable: false, supportedInvocationMethods: [], diagnostics: [], fingerprint: "sha256:none", discoveryDurationMs: 1 };
}

function workflowFixture(withTask: boolean): DevelopmentWorkflowSnapshot {
  const id = "10000000-0000-4000-8000-000000000001"; const specId = "10000000-0000-4000-8000-000000000002"; const taskId = "10000000-0000-4000-8000-000000000003"; const now = "2026-07-16T10:00:00.000Z";
  return {
    schemaVersion: 1, id, revision: 1, repositoryId: "repo", branch: "main", headCommit: "head", intelligenceGeneration: 4,
    intent: { id: "10000000-0000-4000-8000-000000000004", workflowId: id, revision: 1, originalText: "Implement safe delegation", normalizedObjective: "Implement safe delegation", mode: "guided", category: "feature", expectedOutcome: "Safe delegation", risk: "medium", constraints: [], ambiguities: [], requiredDecisions: [], affectedEntities: [{ entityId: "symbol", name: "ResolvedSymbol", type: "keystone.core.Function", reason: "Exact intelligence result.", confidence: 1, evidenceIds: ["evidence"] }], intelligenceGeneration: 4, branch: "main", createdAt: now },
    specification: { id: specId, workflowId: id, revision: 1, status: "approved", title: "Safe delegation", repositoryId: "repo", branch: "main", baseCommit: "head", intelligenceGeneration: 4, objective: "Implement safe delegation", scope: { included: ["delegation"], excluded: [], expectedFiles: ["src/index.ts"], entityIds: ["symbol"] }, requirements: [{ id: "REQ-1", description: "Safe delegation" }], constraints: [], acceptanceCriteria: [{ id: "AC-1", description: "Safe", required: true, requirementIds: ["REQ-1"], validationMethod: "test", expectedEvidence: "output", coveringTaskIds: withTask ? [taskId] : [] }], testStrategy: { existingTests: [], requiredTests: [], validationCommands: [], manualScenarios: [], risks: [] }, decisions: [], evidence: [], approval: { approvedAt: now, approvedBy: "user", revision: 1 }, createdAt: now, updatedAt: now },
    intentHistory: [], clarifications: [], decisions: [], specificationHistory: [], taskGraphHistory: [],
    tasks: withTask ? [{ id: taskId, workflowId: id, specificationId: specId, specificationRevision: 1, title: "Implement AC-1", objective: "Safe", description: "Safe", category: "feature", status: "ready", dependencies: [], requirementIds: ["REQ-1"], acceptanceCriterionIds: ["AC-1"], expectedFiles: ["src/index.ts"], expectedEntityIds: ["symbol"], validationSteps: [{ command: "npm test" }], requiredCapabilities: ["implementation"], staleReasons: [], baseEntityFingerprints: {}, createdAt: now, updatedAt: now }] : [],
    status: "planned", createdAt: now, updatedAt: now
  };
}
