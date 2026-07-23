import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OperationContextFactory,
  RepositoryStateService,
  StalenessService,
  StartupStateService,
} from "../../../src/core/integration/ProductIntegrationService";
import { intelligenceSnapshot } from "../intelligence/fixtures";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("product integration contracts", () => {
  it("creates stable repository identity and explains each changed boundary", () => {
    const snapshot = intelligenceSnapshot(7);
    const service = new RepositoryStateService();
    const before = service.fromIntelligence(snapshot, {
      stagedPaths: ["src/a.ts"],
      workingTreePaths: ["src/b.ts"],
    });
    const after = service.fromIntelligence(
      {
        ...snapshot,
        manifest: { ...snapshot.manifest, generation: 8 },
        repository: { ...snapshot.repository, branch: "feature", headCommit: "b".repeat(40) },
      },
      { stagedPaths: ["src/c.ts"], workingTreePaths: ["src/d.ts"] },
    );
    expect(after.rootPathIdentity).toBe(before.rootPathIdentity);
    expect(
      new StalenessService()
        .compare(before, after, "workflow", crypto.randomUUID())
        .map((record) => record.reason),
    ).toEqual([
      "branch-changed",
      "head-changed",
      "intelligence-generation-changed",
      "relevant-files-changed",
      "delivery-change-set-changed",
    ]);
  });

  it("preserves correlation across child operations", () => {
    const factory = new OperationContextFactory();
    const parent = factory.create({ repositoryId: "repository:fixture" });
    const child = factory.child(parent, { taskId: crypto.randomUUID() });
    expect(child.correlationId).toBe(parent.correlationId);
    expect(child.operationId).not.toBe(parent.operationId);
  });

  it("reports staged startup and preserves degraded diagnostics", () => {
    const startup = new StartupStateService();
    expect(
      startup.transition("persistence-restoring", "running", "Restoring local state.").stage,
    ).toBe("persistence-restoring");
    const degraded = startup.diagnose({
      category: "persistence",
      message: "One optional projection was unavailable.",
      dataPreserved: true,
      retrySafe: true,
      suggestedRecovery: "Retry projection generation.",
    });
    expect(degraded).toMatchObject({ stage: "degraded", status: "degraded" });
    expect(degraded.diagnostics).toHaveLength(1);
  });
});
