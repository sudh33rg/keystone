import { describe, expect, it, vi } from "vitest";
import { ManualHandoffService } from "../../../src/core/development/ManualHandoffService";

describe("ManualHandoffService", () => {
  it("copies as prepared, requires explicit confirmation, and persists handoff time", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const service = new ManualHandoffService({ writeText }, () => "2026-07-22T12:00:00.000Z", () => crypto.randomUUID());
    const handoff = await service.copy({ workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), promptPreparationId: crypto.randomUUID(), content: "actual prompt" });
    expect(writeText).toHaveBeenCalledWith("actual prompt");
    expect(handoff.status).toBe("prepared");
    expect(handoff.handedOffAt).toBeUndefined();
    const confirmed = service.confirm(handoff);
    expect(confirmed.status).toBe("handed-off");
    expect(confirmed.handedOffAt).toBe("2026-07-22T12:00:00.000Z");
  });

  it("returns a structured clipboard error without claiming execution", async () => {
    const service = new ManualHandoffService({ writeText: async () => { throw new Error("clipboard unavailable"); } });
    await expect(service.copy({ workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), promptPreparationId: crypto.randomUUID(), content: "prompt" })).rejects.toMatchObject({ code: "clipboard-unavailable", handoff: { status: "failed", error: { code: "clipboard-unavailable" } } });
  });
});
