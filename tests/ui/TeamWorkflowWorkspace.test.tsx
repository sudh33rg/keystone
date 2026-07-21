// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamWorkflowWorkspace } from "../../src/ui/components/team/TeamWorkflowWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";
import { TEAM_SCHEMA_VERSION, type TeamParticipant } from "../../src/shared/contracts/team";

describe("TeamWorkflowWorkspace", () => {
  it("shows local identity limitations and adds a participant through the typed host boundary", async () => {
    const participants: TeamParticipant[] = [];
    const request = vi.fn((type: string, payload: unknown) => {
      if (type === "team/participants") return Promise.resolve([...participants]);
      if (type === "workflow/list" || type === "assignment/list" || type === "progress/audit")
        return Promise.resolve([]);
      if (type === "team/addParticipant") {
        const input = payload as {
          displayName: string;
          role: TeamParticipant["role"];
          source: TeamParticipant["source"];
          capabilities: TeamParticipant["capabilities"];
        };
        const now = new Date().toISOString();
        const participant: TeamParticipant = {
          schemaVersion: TEAM_SCHEMA_VERSION,
          id: crypto.randomUUID(),
          ...input,
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        participants.push(participant);
        return Promise.resolve(participant);
      }
      return Promise.resolve(undefined);
    });
    render(<TeamWorkflowWorkspace bridge={{ request } as unknown as HostBridge} />);
    expect(await screen.findByText(/No authentication, cloud sync/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "team/addParticipant",
        expect.objectContaining({ displayName: "Ada", source: "local" }),
      ),
    );
    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getAllByText(/self-asserted local/).length).toBeGreaterThan(0);
  });
});
