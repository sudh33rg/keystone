import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

const envelope = (type: string, payload: unknown) => ({ requestId: crypto.randomUUID(), type, timestamp: new Date().toISOString(), schemaVersion: 1, payload });
const base = { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID() };

describe("Phase 7 protocol", () => {
  it("accepts typed impact and QA lifecycle requests", () => {
    expect(WebviewRequestSchema.safeParse(envelope("impact.detect", { ...base, manualSelection: false })).success).toBe(true);
    expect(WebviewRequestSchema.safeParse(envelope("impact.acceptChangeSet", { ...base, expectedHash: "sha256:change" })).success).toBe(true);
    expect(WebviewRequestSchema.safeParse(envelope("qa.execute", { ...base, qaPlanId: "plan-1" })).success).toBe(true);
    expect(WebviewRequestSchema.safeParse(envelope("qa.cancel", { ...base, commandId: "command-1" })).success).toBe(true);
  });

  it("does not let the webview submit arbitrary executable, arguments, cwd, or timeout", () => {
    const unsafe = { ...base, qaPlanId: "plan-1", executable: "sh", arguments: ["-c", "rm -rf /"], workingDirectory: "/", timeoutMs: 1 };
    expect(WebviewRequestSchema.safeParse(envelope("qa.execute", unsafe)).success).toBe(false);
  });
});
