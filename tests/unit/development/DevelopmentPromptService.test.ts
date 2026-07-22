import { describe, expect, it } from "vitest";
import { DevelopmentPromptService } from "../../../src/core/development/DevelopmentPromptService";

describe("DevelopmentPromptService", () => {
  it("uses only real workflow, objective, specification, repository, file, and symbol inputs", () => {
    const service = new DevelopmentPromptService(() => "2026-07-22T12:00:00.000Z", () => "00000000-0000-4000-8000-000000000001");
    const input = { workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), intent: "Add refunds", workType: "feature" as const, specification: "Audit every refund.", objective: "Implement refund guard", objectiveRevision: 2, repositoryName: "payments", notes: "Preserve compatibility.", scope: [{ id: crypto.randomUUID(), kind: "file" as const, workspaceRelativePath: "src/refund.ts" }, { id: crypto.randomUUID(), kind: "symbol" as const, workspaceRelativePath: "src/order.ts", symbol: { entityId: "e1", name: "Order.refund", kind: "method" } }] };
    const prepared = service.prepare(input);
    expect(prepared.content).toContain("## Intent\nAdd refunds");
    expect(prepared.content).toContain("## Specification\nAudit every refund.");
    expect(prepared.content).toContain("src/refund.ts");
    expect(prepared.content).toContain("Order.refund (method) — src/order.ts");
    expect(prepared.content).not.toMatch(/agent identity|context compression|token optimization/i);
    expect(service.prepare(input).contentHash).toBe(prepared.contentHash);
    expect(service.prepare({ ...input, objective: "Different objective" }).contentHash).not.toBe(prepared.contentHash);
  });

  it("embeds the selected persisted execution profile, real skill, and actual instruction contents", () => {
    const service = new DevelopmentPromptService(); const workflowId = crypto.randomUUID(), workItemId = crypto.randomUUID(), profileId = crypto.randomUUID();
    const prepared = service.prepare({ workflowId, workItemId, intent: "Add refunds", workType: "feature", objective: "Guard refunds", objectiveRevision: 1, repositoryName: "payments", scope: [], execution: {
      profile: { id: profileId, workflowId, workItemId, executionCapabilityId: "clipboard-handoff", skillId: "keystone-development", instructionIds: ["instruction:a"], status: "valid", validation: { capabilityAvailable: true, skillAvailable: true, instructionsAvailable: true, conflictsResolved: true }, instructionHashes: { "instruction:a": "a".repeat(64) }, instructionPaths: { "instruction:a": ".github/copilot-instructions.md" }, skillHash: "b".repeat(64), contentHash: "c".repeat(64), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      capability: { id: "clipboard-handoff", kind: "clipboard-handoff", displayName: "Clipboard Handoff", availability: "available", source: "vscode-api" },
      skill: { id: "keystone-development", name: "Development", description: "Bounded implementation", applicableStageTypes: ["development"], promptFragment: "List files changed and tests actually run.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in", contentHash: "b".repeat(64), version: 1 },
      instructions: [{ id: "instruction:a", name: "copilot-instructions.md", workspaceRelativePath: ".github/copilot-instructions.md", uri: "file:///repo/.github/copilot-instructions.md", sourceType: "copilot", contentHash: "a".repeat(64), sizeBytes: 20, availability: "available", content: "Always run focused tests." }],
    } });
    expect(prepared).toMatchObject({ executionProfileId: profileId, executionProfileHash: "c".repeat(64) });
    expect(prepared.content).toContain("## Development skill\nDevelopment\nList files changed and tests actually run.");
    expect(prepared.content).toContain("Path: .github/copilot-instructions.md\nAlways run focused tests.");
    expect(prepared.content).toContain("clipboard handoff");
  });
});
