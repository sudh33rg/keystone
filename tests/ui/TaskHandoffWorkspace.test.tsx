// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskHandoffWorkspace } from "../../src/ui/components/workbench/TaskHandoffWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";
import type { TaskHandoff, HandoffPrivacyReport } from "../../src/shared/contracts/handoff";

afterEach(cleanup);

const workflowId = "11111111-0000-4000-8000-000000000001";
const handoffId = "22222222-0000-4000-8000-000000000002";

const draft: TaskHandoff = {
  schemaVersion: 1,
  id: handoffId,
  workflowId,
  direction: "outgoing",
  status: "draft",
  progressSummary: "Implemented backoff.",
  completedWork: [],
  unresolvedWork: [],
  blockers: [],
  assumptions: [],
  nextAction: null,
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

const privacyReport: HandoffPrivacyReport = {
  scanPassed: true,
  findings: [],
  scannedSections: ["progress", "nextAction", "blockers", "unresolved", "development"],
  scannedAt: "2026-07-23T00:00:00.000Z",
};

const eligibility = { eligible: true };
const history: TaskHandoff[] = [draft];

describe("TaskHandoffWorkspace", () => {
  it("checks eligibility, creates a draft, and saves progress", async () => {
    const request = vi.fn(async (type: string, payload: Record<string, unknown>) => {
      if (type === "taskHandoff/checkEligibility") return eligibility;
      if (type === "taskHandoff/listHistory") return history;
      if (type === "taskHandoff/createDraft") return draft;
      if (type === "taskHandoff/updateDraft")
        return { ...draft, progressSummary: (payload.progressSummary as string) ?? draft.progressSummary };
      if (type === "taskHandoff/runPrivacyScan") return privacyReport;
      return undefined;
    });
    render(<TaskHandoffWorkspace bridge={{ request } as unknown as HostBridge} workflowId={workflowId} onClose={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Create Handoff Draft" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Handoff Draft" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("taskHandoff/createDraft", { workflowId }));
    fireEvent.change(screen.getByLabelText(/Progress summary/), { target: { value: "Done with backoff." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("taskHandoff/updateDraft", expect.objectContaining({ workflowId, handoffId, progressSummary: "Done with backoff." })));
  });

  it("blocks export when privacy scan has open findings", async () => {
    const blockedReport: HandoffPrivacyReport = {
      scanPassed: false,
      findings: [{ id: "33333333-0000-4000-8000-000000000003", category: "connection-string", location: "evidence", severity: "critical", confidence: "high", recommendedAction: "redact", maskedPreview: "post*********", status: "open" }],
      scannedSections: ["progress"],
      scannedAt: "2026-07-23T00:00:00.000Z",
    };
    const request = vi.fn(async (type: string) => {
      if (type === "taskHandoff/checkEligibility") return eligibility;
      if (type === "taskHandoff/listHistory") return history;
      if (type === "taskHandoff/createDraft") return draft;
      if (type === "taskHandoff/updateDraft") return draft;
      if (type === "taskHandoff/runPrivacyScan") return blockedReport;
      return undefined;
    });
    render(<TaskHandoffWorkspace bridge={{ request } as unknown as HostBridge} workflowId={workflowId} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Handoff Draft" }));
    // Saving the draft triggers the privacy scan.
    fireEvent.click(await screen.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(screen.getByText(/connection-string/)).toBeTruthy());
    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toHaveProperty("disabled", true);
  });
});
