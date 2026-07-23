import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewPersistenceStore } from "../../../src/core/persistence/ReviewPersistenceStore";
import { ReviewCompletionService } from "../../../src/core/review/ReviewCompletionService";
import { DeliveryPersistenceStore } from "../../../src/core/persistence/DeliveryPersistenceStore";
import { DevelopmentWorkflowSnapshotSchema } from "../../../src/shared/contracts/delegation";
import { SCHEMA_VERSION } from "../../../src/shared/contracts/domain";
import { WebviewRequestSchema } from "../../../src/shared/contracts/messages";
import { ReviewDecisionSchema, ReviewNoteSchema } from "../../../src/shared/contracts/review";

const workflowId = "00000000-0000-4000-8000-000000000001";

describe("Review and optional completion contracts", () => {
  it("validates bounded workflow-aware Review and Complete requests", () => {
    const envelope = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };
    for (const type of [
      "review/getState",
      "review/getTraceability",
      "review/getChanges",
      "review/getQa",
      "review/getSecurity",
      "review/getPerformance",
      "review/getDocumentation",
      "review/getPrChecklist",
      "review/getReadiness",
      "complete/getState",
      "complete/getOptions",
      "complete/getReport",
    ] as const) {
      expect(
        WebviewRequestSchema.safeParse({
          ...envelope,
          type,
          payload: { workflowId },
        }).success,
        type,
      ).toBe(true);
    }
    for (const type of [
      "complete/getChangeSet",
      "complete/getPushReadiness",
      "complete/getPrCapabilities",
    ] as const) {
      expect(
        WebviewRequestSchema.safeParse({
          ...envelope,
          type,
          payload: { workflowId },
        }).success,
        type,
      ).toBe(false);
    }
    expect(
      WebviewRequestSchema.safeParse({
        ...envelope,
        type: "complete/completeLocally",
        payload: {
          workflowId,
          reason: "Reviewed local completion",
          confirm: false,
        },
      }).success,
    ).toBe(false);
    expect(
      WebviewRequestSchema.safeParse({
        ...envelope,
        type: "complete/completeLocally",
        payload: {
          workflowId,
          reason: "Reviewed local completion",
          confirm: true,
        },
      }).success,
    ).toBe(true);
    expect(
      WebviewRequestSchema.safeParse({
        ...envelope,
        type: "review/getDiff",
        payload: { workflowId, path: "src/index.ts", maxBytes: 100_001 },
      }).success,
    ).toBe(false);
  });

  it("restores durable notes and review decisions without credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-review-state-"));
    try {
      const first = new ReviewPersistenceStore(root);
      await first.initialize();
      const now = new Date().toISOString();
      const note = ReviewNoteSchema.parse({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        workflowId,
        targetType: "workflow",
        targetId: workflowId,
        type: "risk",
        text: "Review the migration rollback.",
        blocking: true,
        author: "user",
        createdAt: now,
        updatedAt: now,
      });
      const decision = ReviewDecisionSchema.parse({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        workflowId,
        specificationRevision: 2,
        repositoryFingerprint: "sha256:reviewed",
        branch: "feature/review",
        headCommit: "a".repeat(40),
        intelligenceGeneration: 4,
        status: "changes-requested",
        findings: [],
        warnings: [],
        noteIds: [note.id],
        reason: "Rollback evidence is missing.",
        decidedBy: "user",
        decidedAt: now,
      });
      await first.update((state) => ({
        ...state,
        notes: [note],
        decisions: [decision],
      }));
      const restored = new ReviewPersistenceStore(root);
      await restored.initialize();
      expect(restored.snapshot.notes[0]?.text).toContain("rollback");
      expect(restored.snapshot.decisions[0]?.status).toBe("changes-requested");
      expect(JSON.stringify(restored.snapshot)).not.toMatch(/credential|token|password/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks Review on required incomplete work and completes locally without Git mutation", async () => {
    const reviewStore = new ReviewPersistenceStore();
    await reviewStore.initialize();
    const deliveryStore = new DeliveryPersistenceStore();
    await deliveryStore.initialize();
    let workflow = workflowFixture(false, "ready");
    const gitMutation = () => {
      throw new Error("Git must not be called for local completion.");
    };
    const service = new ReviewCompletionService(
      reviewStore,
      {
        get: () => workflow,
        getCurrentSnapshot: () => ({
          repository: {
            id: "repository:test",
            displayName: "test",
            workspaceRoots: [],
            branch: "main",
            headCommit: "a".repeat(40),
            createdAt: new Date().toISOString(),
          },
          manifest: { generation: 3 },
        }),
        setTaskStatus: () => Promise.resolve(workflow),
      } as never,
      { snapshot: { sessions: [], runs: [] } } as never,
      {
        persistence: deliveryStore,
        adapter: { stage: gitMutation, commit: gitMutation, push: gitMutation },
      } as never,
    );
    expect(service.getState(workflowId).readinessBlockers).toEqual(
      expect.arrayContaining([expect.stringMatching(/incomplete/i)]),
    );
    await expect(service.approve(workflowId, "approve")).rejects.toThrow(/blocked/i);
    workflow = workflowFixture(true, "completed");
    const decision = await service.approve(workflowId, "Optional evidence reviewed.");
    expect(decision.status).toBe("approved");
    const completion = await service.complete(workflowId, "local", "No delivery requested.");
    expect(completion.mode).toBe("local");
    expect(completion.commitHashes).toEqual([]);
    // The completion record carries no remote-PR URL field: the type system
    // guarantees no push/PR artifact can exist. This is the read-only boundary.
    expect(completion.report).toContain(
      "repository changes are preserved locally; no Git mutation",
    );
  });
});

function workflowFixture(optional: boolean, status: "ready" | "completed") {
  const now = new Date().toISOString();
  const specificationId = "00000000-0000-4000-8000-000000000002";
  const taskId = "00000000-0000-4000-8000-000000000003";
  return DevelopmentWorkflowSnapshotSchema.parse({
    schemaVersion: 1,
    id: workflowId,
    revision: 1,
    repositoryId: "repository:test",
    branch: "main",
    headCommit: "a".repeat(40),
    intelligenceGeneration: 3,
    intent: {
      id: "00000000-0000-4000-8000-000000000004",
      workflowId,
      revision: 1,
      originalText: "Review local completion",
      normalizedObjective: "Review local completion",
      mode: "guided",
      category: "feature",
      workType: "feature",
      expectedOutcome: "Reviewed local state",
      risk: "low",
      constraints: [],
      ambiguities: [],
      requiredDecisions: [],
      affectedEntities: [],
      intelligenceGeneration: 3,
      branch: "main",
      createdAt: now,
    },
    specification: {
      id: specificationId,
      workflowId,
      revision: 1,
      status: "approved",
      title: "Local completion",
      repositoryId: "repository:test",
      branch: "main",
      baseCommit: "a".repeat(40),
      intelligenceGeneration: 3,
      objective: "Review local completion",
      scope: {
        included: ["local"],
        excluded: [],
        expectedFiles: [],
        entityIds: [],
      },
      requirements: [{ id: "REQ-1", description: "Complete reviewed work locally" }],
      constraints: [],
      acceptanceCriteria: [
        {
          id: "AC-1",
          description: "Optional manual review",
          required: !optional,
          blocking: !optional,
          requirementIds: ["REQ-1"],
          validationMethod: "manual",
          expectedEvidence: "review decision",
          coveringTaskIds: [taskId],
        },
      ],
      testStrategy: {
        existingTests: [],
        requiredTests: [],
        validationCommands: [],
        manualScenarios: ["Review state"],
        risks: [],
      },
      decisions: [],
      evidence: [],
      approval: { approvedAt: now, approvedBy: "user", revision: 1 },
      createdAt: now,
      updatedAt: now,
    },
    specificationHistory: [],
    taskGraph: {
      id: "00000000-0000-4000-8000-000000000005",
      workflowId,
      specificationId,
      specificationRevision: 1,
      revision: 1,
      taskIds: [taskId],
      topologicalOrder: [taskId],
      ready: true,
      status: "approved",
      diagnostics: [],
      approval: { approvedAt: now, approvedBy: "user", revision: 1 },
      createdAt: now,
    },
    taskGraphHistory: [],
    tasks: [
      {
        id: taskId,
        workflowId,
        specificationId,
        specificationRevision: 1,
        title: "Review task",
        objective: "Review",
        description: "Review local evidence",
        category: "manual",
        status,
        dependencies: [],
        requirementIds: ["REQ-1"],
        acceptanceCriterionIds: ["AC-1"],
        expectedFiles: [],
        expectedEntityIds: [],
        validationSteps: [{ manualCheck: "Review" }],
        requiredCapabilities: ["code-review"],
        optional,
        staleReasons: [],
        baseEntityFingerprints: {},
        createdAt: now,
        updatedAt: now,
      },
    ],
    status: "planned",
    createdAt: now,
    updatedAt: now,
  });
}
