// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("Active Work Phase 1 boundary", () => {
  it("shows a truthful empty state with no future controls", async () => {
    const request = vi.fn().mockResolvedValue(null);
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "No active workflow" })).toBeTruthy();
    for (const text of ["Development", "Manual result capture", "Capture result", "Cancel workflow", "Tasks", "Source scope", "coming soon"])
      expect(screen.queryByText(text, { exact: false })).toBeNull();
  });
});
