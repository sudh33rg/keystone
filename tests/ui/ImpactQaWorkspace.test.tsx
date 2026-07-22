// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImpactAnalysisStage } from "../../src/ui/components/workbench/ImpactAnalysisStage";
import { QaStage } from "../../src/ui/components/workbench/QaStage";

const bridge = { request: vi.fn(async () => null), subscribe: vi.fn(() => () => undefined) } as never;
afterEach(() => document.body.replaceChildren());

describe("Phase 7 workspaces", () => {
  it("renders the real Impact Analysis change review without generation or healing controls", () => {
    render(<ImpactAnalysisStage bridge={bridge} workflowId="00000000-0000-4000-8000-000000000071" onWorkflowChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Impact Analysis" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detect Workspace Changes" })).toBeTruthy();
    expect(screen.queryByText(/Generate Test|Heal/i)).toBeNull();
  });

  it("renders QA plan groups, approval and cancellation controls", () => {
    render(<QaStage bridge={bridge} workflowId="00000000-0000-4000-8000-000000000071" onWorkflowChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "QA" })).toBeTruthy();
    expect(screen.getByText("Required Tests")).toBeTruthy();
    expect(screen.getByText("Recommended Tests")).toBeTruthy();
    expect(screen.getByText("Optional Regression")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve Exact Commands" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel Running Tests" })).toBeTruthy();
    expect(screen.queryByText(/Generate Test|Heal Failure/i)).toBeNull();
  });
});
