// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryWorkspace } from "../../src/ui/components/delivery/DeliveryWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("DeliveryWorkspace", () => {
  it("shows unavailable provider capability honestly and keeps mutations explicit", async () => {
    const request = vi.fn((type: string) => {
      if (type === "workflow/list") return Promise.resolve([]);
      if (type === "git/capabilities") return Promise.resolve({ commitAvailable: true });
      if (type === "git/repositoryState") return Promise.resolve({ branch: "main", headCommit: "a".repeat(40), dirty: false, ahead: 0, behind: 0, conflictedFiles: [], remotes: [] });
      if (type === "pullRequest/capabilities") return Promise.resolve({ provider: "unknown", detected: false, directCreationAvailable: false });
      return Promise.resolve(undefined);
    });
    render(<DeliveryWorkspace bridge={{ request } as unknown as HostBridge}/>);
    expect(await screen.findByText("No supported provider detected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create and switch branch/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Push to remote/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/never commits, pushes, or creates a PR without the action you confirm/i)).toBeTruthy();
  });
});
