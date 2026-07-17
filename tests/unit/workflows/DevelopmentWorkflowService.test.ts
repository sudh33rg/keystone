import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentWorkflowService } from "../../../src/core/workflows/DevelopmentWorkflowService";
import { DelegationPersistenceStore } from "../../../src/core/persistence/DelegationPersistenceStore";
import type { IntelligenceSnapshotReader } from "../../../src/core/persistence/IntelligenceStore";
import type { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import { intelligenceSnapshot } from "../intelligence/fixtures";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keystone-workflow-"));
  temporaryDirectories.push(root);
  const snapshot = intelligenceSnapshot(7);
  const snapshots: IntelligenceSnapshotReader = {
    getSnapshot: () => snapshot,
    isStorageAvailable: () => true,
    getLoadError: () => undefined,
  };
  const unified = vi.fn(() =>
    Promise.resolve({ data: { items: [] }, evidence: [] }),
  );
  const queries = { unified } as unknown as IntelligenceQueryService;
  const persistence = new DelegationPersistenceStore(root);
  const service = new DevelopmentWorkflowService(
    persistence,
    snapshots,
    queries,
  );
  await service.initialize();
  return { root, snapshot, persistence, service, unified };
}

describe("spec-driven development workflow", () => {
  it("captures a repository-bound intent and complete reviewable specification", async () => {
    const { service } = await fixture();
    const workflow = await service.capture(
      "Implement a bounded context preview without new dependencies",
      "guided",
      "Context preview",
    );
    expect(workflow.intent).toMatchObject({
      mode: "guided",
      category: "feature",
      intelligenceGeneration: 7,
    });
    expect(
      workflow.intent.constraints.map((item) => item.description),
    ).toContain("Do not introduce new dependencies.");
    expect(workflow.specification).toMatchObject({
      title: "Context preview",
      status: "draft",
      branch: "main",
      intelligenceGeneration: 7,
    });
    expect(workflow.specification?.scope.expectedFiles).toEqual([
      "src/index.ts",
    ]);
    expect(workflow.specification?.acceptanceCriteria[0]).toMatchObject({
      requirementIds: ["REQ-1"],
      coveringTaskIds: [],
    });
    expect(workflow.specification?.testStrategy).toBeDefined();
  });

  it("does not silently add ambiguous search candidates to intent scope", async () => {
    const { service, unified } = await fixture();
    unified.mockResolvedValueOnce({
      data: { items: [{ id: "one", name: "Keystone", type: "keystone.core.Class", score: 900, confidence: 1, classification: "exact", rankingReasons: ["exact name"] }, { id: "two", name: "Keystone", type: "keystone.core.Module", score: 900, confidence: 1, classification: "exact", rankingReasons: ["exact name"] }] },
      resolvedSeeds: [{ selector: { value: "Keystone", kind: "name" }, candidates: [], ambiguous: true, requiresSelection: true, reasons: ["top candidates have similar deterministic scores"] }],
      evidence: []
    } as never);
    const workflow = await service.capture("Verify Keystone", "spec-driven");
    expect(workflow.intent.affectedEntities).toEqual([]);
    expect(workflow.specification?.scope.entityIds).toEqual([]);
  });

  it("requires explicit resolution of blocking high-risk decisions before approval", async () => {
    const { service } = await fixture();
    let workflow = await service.capture(
      "Change production credentials and permissions",
      "spec-driven",
    );
    await expect(service.approve(workflow.id, 1)).rejects.toThrow(
      "blocking specification decision",
    );
    const decision = workflow.specification?.decisions[0];
    expect(decision).toBeDefined();
    workflow = await service.resolveDecision(
      workflow.id,
      decision!.id,
      "Limit changes to the local credential-name parser and retain rollback compatibility.",
    );
    workflow = await service.submitForReview(workflow.id);
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
      "Reviewed high-risk boundary.",
    );
    expect(workflow.specification?.approval).toMatchObject({
      approvedBy: "user",
      revision: 2,
    });
  });

  it("generates a dependency-ordered and criterion-traceable task graph only after approval", async () => {
    const { service } = await fixture();
    let workflow = await service.capture(
      "Implement context preview without new dependencies",
      "spec-driven",
    );
    await expect(service.generateTasks(workflow.id)).rejects.toThrow(
      "approved specification",
    );
    workflow = await service.submitForReview(workflow.id);
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
    );
    workflow = await service.generateTasks(workflow.id);
    expect(workflow.taskGraph?.topologicalOrder).toEqual(
      workflow.tasks.map((item) => item.id),
    );
    expect(workflow.tasks[0]).toMatchObject({
      status: "ready",
      requirementIds: ["REQ-1"],
      acceptanceCriterionIds: ["AC-1"],
      expectedFiles: ["src/index.ts"],
    });
    expect(
      workflow.specification?.acceptanceCriteria[0]?.coveringTaskIds,
    ).toEqual([workflow.tasks[0]?.id]);
  });

  it("marks generated work stale after a material spec revision and branch reconciliation", async () => {
    const { service, snapshot } = await fixture();
    let workflow = await service.capture(
      "Implement context preview",
      "spec-driven",
    );
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
    );
    workflow = await service.generateTasks(workflow.id);
    workflow = await service.revise(
      workflow.id,
      {
        constraints: [
          ...workflow.specification!.constraints,
          "Keep payloads bounded.",
        ],
      },
      "Bound payloads",
    );
    expect(workflow.tasks.every((item) => item.status === "stale")).toBe(true);
    expect(workflow.specificationHistory).toHaveLength(1);
    snapshot.repository.branch = "feature/delegation";
    workflow = await service.reconcileStaleness(workflow.id);
    expect(workflow.tasks[0]?.staleReasons.join(" ")).toContain(
      "Repository branch changed",
    );
  });

  it("persists approved workflow state atomically and restores it after restart", async () => {
    const { root, snapshot, service } = await fixture();
    let workflow = await service.capture("Implement context preview", "quick");
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
    );
    const raw = JSON.parse(
      await readFile(join(root, "workflow", "delegation-state.json"), "utf8"),
    ) as { workflows: unknown[] };
    expect(raw.workflows).toHaveLength(1);
    const restarted = new DevelopmentWorkflowService(
      new DelegationPersistenceStore(root),
      {
        getSnapshot: () => snapshot,
        isStorageAvailable: () => true,
        getLoadError: () => undefined,
      },
      { unified: vi.fn() } as unknown as IntelligenceQueryService,
    );
    await restarted.initialize();
    expect(restarted.get(workflow.id)?.specification?.status).toBe("approved");
  });

  it("creates a separate focused partial-repair task without changing the approved specification", async () => {
    const { service } = await fixture();
    let workflow = await service.capture(
      "Implement context preview",
      "spec-driven",
    );
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
    );
    workflow = await service.generateTasks(workflow.id);
    const source = workflow.tasks[0]!;
    const revision = workflow.specification!.revision;
    workflow = await service.createRepairTask(
      workflow.id,
      source.id,
      ["AC-1"],
      ["src/index.ts"],
      "Repair only the failed validation evidence.",
    );
    const repair = workflow.tasks.at(-1)!;
    expect(repair.id).not.toBe(source.id);
    expect(repair).toMatchObject({
      status: "ready",
      acceptanceCriterionIds: ["AC-1"],
      expectedFiles: ["src/index.ts"],
    });
    expect(repair.assignedAgentId).toBeUndefined();
    expect(workflow.specification!.revision).toBe(revision);
    expect(workflow.taskGraph?.taskIds).toContain(repair.id);
    expect(workflow.taskGraph?.diagnostics.join(" ")).toContain(
      "Focused repair task",
    );
  });
});
