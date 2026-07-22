import { randomUUID } from "node:crypto";
import type { DevelopmentHandoff } from "../../shared/contracts/development";

export class ManualHandoffError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable = true, public readonly handoff?: DevelopmentHandoff) { super(message); this.name = "ManualHandoffError"; }
}
export interface ClipboardAdapter { writeText(value: string): Promise<void>; }

export class ManualHandoffService {
  constructor(private readonly clipboard: ClipboardAdapter, private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID) {}
  async copy(input: { workflowId: string; workItemId: string; promptPreparationId: string; content: string }): Promise<DevelopmentHandoff> {
    const id = this.createId();
    try { await this.clipboard.writeText(input.content); }
    catch { const handoff: DevelopmentHandoff = { id, workflowId: input.workflowId, workItemId: input.workItemId, promptPreparationId: input.promptPreparationId, mode: "clipboard", status: "failed", error: { code: "clipboard-unavailable", message: "Keystone could not copy the prompt because clipboard integration is unavailable." } }; throw new ManualHandoffError("clipboard-unavailable", handoff.error!.message, true, handoff); }
    return { id, workflowId: input.workflowId, workItemId: input.workItemId, promptPreparationId: input.promptPreparationId, mode: "clipboard", status: "prepared" };
  }
  confirm(handoff: DevelopmentHandoff): DevelopmentHandoff {
    if (handoff.status !== "prepared") throw new ManualHandoffError("handoff-not-confirmed", "Only a prepared handoff can be confirmed.");
    return { ...handoff, status: "handed-off", handedOffAt: this.now() };
  }
}
