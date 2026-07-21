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
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
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
  const unified = vi.fn(() => Promise.resolve({ data: { items: [] }, evidence: [] }));
  const queries = { unified } as unknown as IntelligenceQueryService;
  const persistence = new DelegationPersistenceStore(root);
  const service = new DevelopmentWorkflowService(persistence, snapshots, queries);
  await service.initialize();
  return { root, snapshot, persistence, service, unified };
}

describe("spec-driven development workflow", () => {
  it("runs the explicit Workbench draft-to-Build lifecycle without automatic specification, tasks, or delegation", async () => {
    const { root, service, snapshot } = await fixture();
    let workflow = await service.createWorkbenchDraft({
      intent: "Add a bounded repository summary with authorization checks",
      workType: "feature",
      repositoryScope: { kind: "paths", paths: ["src/index.ts"] },
      constraints: [{ kind: "compatibility", value: "Preserve existing public behavior" }],
      expectedRepositoryId: snapshot.repository.id,
      expectedIntelligenceGeneration: snapshot.manifest.generation,
    });

    expect(workflow.specification).toBeUndefined();
    expect(workflow.tasks).toEqual([]);
    expect(workflow.repositoryState?.intelligenceGeneration).toBe(7);
    expect(service.getWorkbenchState(workflow.id).summary.currentStage).toBe("define");
    workflow = await service.generateSpecification(workflow.id);
    await expect(service.approve(workflow.id, workflow.specification!.revision)).rejects.toThrow(
      "specification question",
    );
    for (const clarification of workflow.clarifications) {
      workflow = await service.setClarificationStatus(workflow.id, clarification.id, "deferred");
    }
    workflow = await service.generateSpecification(workflow.id);
    expect(workflow.specification?.sections?.currentBehavior).toContain("Unknown");
    workflow = await service.approve(
      workflow.id,
      workflow.specification!.revision,
      "Reviewed explicit unknowns",
    );
    expect(service.getWorkbenchState(workflow.id).summary.currentStage).toBe("plan");

    workflow = await service.generateTaskPlan(workflow.id);
    expect(workflow.taskGraph).toMatchObject({ status: "draft", ready: false });
    expect(workflow.tasks.every((task) => task.assignedAgentId === undefined)).toBe(true);
    expect(service.validateTaskPlan(workflow.id).valid).toBe(true);
    workflow = await service.approveTaskPlan(workflow.id, workflow.taskGraph!.revision);
    expect(service.getWorkbenchState(workflow.id).summary.currentStage).toBe("build");
    expect(workflow.tasks.some((task) => task.status === "ready")).toBe(true);

    const persisted = JSON.parse(
      await readFile(join(root, "workflow", "delegation-state.json"), "utf8"),
    ) as { workflows: Array<{ id: string; taskGraph?: { status?: string } }> };
    expect(persisted.workflows.find((item) => item.id === workflow.id)?.taskGraph?.status).toBe(
      "approved",
    );
  });

  it("invalidates approval after plan edits and blocks dependency cycles", async () => {
    const { service, snapshot } = await fixture();
    let workflow = await service.createWorkbenchDraft({
      intent: "Add query performance validation",
      workType: "feature",
      repositoryScope: { kind: "repository", paths: [] },
      constraints: [],
      expectedRepositoryId: snapshot.repository.id,
      expectedIntelligenceGeneration: 7,
    });
    for (const clarification of workflow.clarifications)
      workflow = await service.setClarificationStatus(
        workflow.id,
        clarification.id,
        "not-applicable",
      );
    workflow = await service.generateSpecification(workflow.id);
    workflow = await service.approve(workflow.id, workflow.specification!.revision);
    workflow = await service.generateTaskPlan(workflow.id);
    expect(workflow.tasks.length).toBeGreaterThan(1);
    const first = workflow.tasks[0]!;
    const second = workflow.tasks[1]!;
    workflow = await service.updateDependency(
      workflow.id,
      second.id,
      first.id,
      "add",
      workflow.taskGraph!.revision,
    );
    workflow = await service.updateDependency(
      workflow.id,
      first.id,
      second.id,
      "add",
      workflow.taskGraph!.revision,
    );
    expect(service.validateTaskPlan(workflow.id).diagnostics.map((item) => item.code)).toContain(
      "DEPENDENCY_CYCLE",
    );
    await expect(
      service.approveTaskPlan(workflow.id, workflow.taskGraph!.revision),
    ).rejects.toThrow("dependency cycle");
    expect(workflow.taskGraph).toMatchObject({ status: "draft", ready: false });
    expect(workflow.taskGraphHistory.length).toBeGreaterThan(0);
  });

  it("creates one workflow draft with its intent, specification, and repository scope attached", async () => {
    const { service } = await fixture();
    const workflow = await service.capture(
      "Repair the selected authentication paths",
      "guided",
      undefined,
      undefined,
      {
        workType: "bug",
        repositoryScope: { kind: "paths", paths: ["src/auth", "tests/auth.test.ts"] },
      },
    );

    expect(workflow.intent).toMatchObject({
      workflowId: workflow.id,
      workType: "bug",
      category: "bug-fix",
      repositoryScope: { kind: "paths", paths: ["src/auth", "tests/auth.test.ts"] },
    });
    expect(workflow.specification).toMatchObject({ workflowId: workflow.id, status: "draft" });
    expect(workflow.specification?.scope.expectedFiles).toEqual(
      expect.arrayContaining(["src/auth", "tests/auth.test.ts"]),
    );
    const approved = await service.approve(workflow.id, workflow.specification!.revision);
    const planned = await service.generateTasks(approved.id);
    expect(planned.tasks.length).toBeGreaterThan(0);
    expect(planned.tasks.every((task) => task.workflowId === workflow.id)).toBe(true);
  });

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
    expect(workflow.intent.constraints.map((item) => item.description)).toContain(
      "Do not introduce new dependencies.",
    );
    expect(workflow.specification).toMatchObject({
      title: "Context preview",
      status: "draft",
      branch: "main",
      intelligenceGeneration: 7,
    });
    expect(workflow.specification?.scope.expectedFiles).toEqual(["src/index.ts"]);
    expect(workflow.specification?.acceptanceCriteria[0]).toMatchObject({
      requirementIds: ["REQ-1"],
      coveringTaskIds: [],
    });
    expect(workflow.specification?.testStrategy).toBeDefined();
  });

  it("does not silently add ambiguous search candidates to intent scope", async () => {
    const { service, unified } = await fixture();
    unified.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "one",
            name: "Keystone",
            type: "keystone.core.Class",
            score: 900,
            confidence: 1,
            classification: "exact",
            rankingReasons: ["exact name"],
          },
          {
            id: "two",
            name: "Keystone",
            type: "keystone.core.Module",
            score: 900,
            confidence: 1,
            classification: "exact",
            rankingReasons: ["exact name"],
          },
        ],
      },
      resolvedSeeds: [
        {
          selector: { value: "Keystone", kind: "name" },
          candidates: [],
          ambiguous: true,
          requiresSelection: true,
          reasons: ["top candidates have similar deterministic scores"],
        },
      ],
      evidence: [],
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
    await expect(service.generateTasks(workflow.id)).rejects.toThrow("approved specification");
    workflow = await service.submitForReview(workflow.id);
    workflow = await service.approve(workflow.id, workflow.specification!.revision);
    workflow = await service.generateTasks(workflow.id);
    expect(workflow.taskGraph?.topologicalOrder).toEqual(workflow.tasks.map((item) => item.id));
    expect(workflow.tasks[0]).toMatchObject({
      status: "ready",
      requirementIds: ["REQ-1"],
      acceptanceCriterionIds: ["AC-1"],
      expectedFiles: ["src/index.ts"],
    });
    expect(workflow.specification?.acceptanceCriteria[0]?.coveringTaskIds).toEqual([
      workflow.tasks[0]?.id,
    ]);
  });

  it("marks generated work stale after a material spec revision and branch reconciliation", async () => {
    const { service, snapshot } = await fixture();
    let workflow = await service.capture("Implement context preview", "spec-driven");
    workflow = await service.approve(workflow.id, workflow.specification!.revision);
    workflow = await service.generateTasks(workflow.id);
    workflow = await service.revise(
      workflow.id,
      {
        constraints: [...workflow.specification!.constraints, "Keep payloads bounded."],
      },
      "Bound payloads",
    );
    expect(workflow.tasks.every((item) => item.status === "stale")).toBe(true);
    expect(workflow.specificationHistory).toHaveLength(1);
    snapshot.repository.branch = "feature/delegation";
    workflow = await service.reconcileStaleness(workflow.id);
    expect(workflow.tasks[0]?.staleReasons.join(" ")).toContain("Repository branch changed");
  });

  it("persists approved workflow state atomically and restores it after restart", async () => {
    const { root, snapshot, service } = await fixture();
    let workflow = await service.capture("Implement context preview", "quick");
    workflow = await service.approve(workflow.id, workflow.specification!.revision);
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
    let workflow = await service.capture("Implement context preview", "spec-driven");
    workflow = await service.approve(workflow.id, workflow.specification!.revision);
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
    expect(workflow.taskGraph?.diagnostics.join(" ")).toContain("Focused repair task");
  });
});
