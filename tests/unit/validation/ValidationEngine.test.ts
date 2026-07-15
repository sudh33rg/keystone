import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceAdapter } from "../../../src/extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../../src/extension/adapters/GitAdapter";
import { ValidationEngine } from "../../../src/core/validation/ValidationEngine";

describe("ValidationEngine", () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    const workspace = {
      getRoots: () => [{ name: "test", uri: "file:///test" }],
      readTextFile: vi.fn(),
      readFile: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      onDidRename: vi.fn(),
      onDidChange: vi.fn(),
      getConfiguration: vi.fn()
    } as unknown as WorkspaceAdapter;

    const git = {
      getCurrentBranch: () => "main",
      getHeadCommit: () => "abc123",
      getRemoteUrl: () => "https://github.com/test/repo.git",
      getRemoteIdentityHash: () => "hash",
      getChangedFiles: () => [],
      getStagedFiles: () => [],
      getUntrackedFiles: () => [],
      onDidCommit: vi.fn(),
      onDidChangeState: vi.fn()
    } as unknown as GitAdapter;

    engine = new ValidationEngine(workspace, git);
  });

  it("should plan validation commands", async () => {
    const plan = await engine.plan("workflow-1", 1, ["task-1"]);

    expect(plan.commands.length).toBeGreaterThanOrEqual(0);
    expect(plan.checks).toBeDefined();
  });

  it("should create an override record", () => {
    const override = engine.createOverride("wf-1", "criterion-1", "Reason", "Acknowledged", "passed");

    expect(override.criterionId).toBe("criterion-1");
    expect(override.resultingStatus).toBe("overridden");
  });
});
