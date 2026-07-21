// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationWorkspace } from "../../src/ui/components/orchestration/OrchestrationWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("OrchestrationWorkspace", () => {
  it("renders the focused workspace without fabricating an active workflow", async () => {
    const request = vi.fn((type: string) =>
      Promise.resolve(
        type === "orchestration/definitions" ||
          type === "orchestration/policies" ||
          type === "orchestration/list" ||
          type === "workflow/list"
          ? []
          : undefined,
      ),
    );
    render(<OrchestrationWorkspace bridge={{ request } as unknown as HostBridge} />);
    expect(screen.getByRole("heading", { name: "SDLC Orchestration" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "No orchestration instance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create from approved workflow" })).toBeTruthy();
  });
});
