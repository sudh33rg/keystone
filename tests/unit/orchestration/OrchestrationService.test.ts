import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DevelopmentWorkflowSnapshotSchema,
  type DevelopmentWorkflowSnapshot,
} from "../../../src/shared/contracts/delegation";
import {
  WorkflowStateMachine,
  WorkflowDefinitionRegistry,
  WorkflowPolicyService,
  TaskConflictService,
  OrchestrationService,
} from "../../../src/core/orchestration/OrchestrationService";
import { OrchestrationPersistenceStore } from "../../../src/core/persistence/OrchestrationPersistenceStore";
import { ExecutionRoutingService } from "../../../src/core/workflows/ExecutionRoutingService";
import type { DevelopmentWorkflowService } from "../../../src/core/workflows/DevelopmentWorkflowService";
import type { WorkflowInstance } from "../../../src/shared/contracts/orchestration";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AI-driven SDLC orchestration", () => {
  it("defines the six bounded workflows and only non-autonomous policy modes", () => {
    expect(new WorkflowDefinitionRegistry().list().map((item) => item.id)).toEqual([
      "quick-fix",
      "feature-development",
      "bug-fix",
      "refactoring",
      "modernization",
      "security-remediation",
    ]);
    expect(new WorkflowPolicyService().list().map((item) => item.executionMode)).toEqual([
      "manual",
      "guided",
      "approval-gated",
    ]);
  });

  it("rejects invalid workflow transitions", () => {
    expect(() => new WorkflowStateMachine().transition("draft", "running")).toThrow(
      "Invalid orchestration transition",
    );
    expect(() => new WorkflowStateMachine().transition("completed", "running")).toThrow();
  });

  it("creates, plans, explicitly approves, starts, and pauses a durable workflow", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID, "guided");
    expect(created.status).toBe("draft");
    expect(created.taskStates[0]?.route).toBe("github-copilot");
    const planned = await service.plan(created.id);
    expect(planned.status).toBe("awaiting-approval");
    expect(planned.plan?.approved).toBe(false);
    expect(planned.approvalGates.length).toBeGreaterThan(3);
    let current = planned;
    for (const gate of planned.approvalGates)
      current = await service.decide(
        created.id,
        gate.id,
        "approved",
        "Reviewed evidence and approved.",
      );
    expect(current.status).toBe("ready");
    expect(current.plan?.approved).toBe(true);
    expect((await service.start(created.id)).status).toBe("running");
    const paused = await service.pause(created.id);
    expect(paused.status).toBe("paused");
    expect(paused.audit.some((item) => item.action === "status-paused")).toBe(true);
  });

  it("blocks readiness on dependencies, stale tasks, unsupported routes, and missing agent capability", async () => {
    const source = buildSource({ assigned: false, second: true });
    const { service } = await fixture(source);
    const created = await service.create(SOURCE_ID);
    const first = service.taskReadiness(created.id, source.tasks[0]!.id);
    const second = service.taskReadiness(created.id, source.tasks[1]!.id);
    expect(first.ready).toBe(false);
    expect(first.blockers).toContain("No supported execution route is available.");
    expect(second.blockers.some((item) => item.startsWith("Dependency"))).toBe(true);
  });

  it("allows parallel reads but fails closed for unknown and overlapping writes", () => {
    const conflicts = new TaskConflictService();
    const left = taskState({ readOnly: true });
    const right = taskState({ readOnly: true });
    expect(conflicts.classify(left, right).classification).toBe("safe-read-only");
    expect(
      conflicts.classify(
        taskState({ expectedFiles: ["src/a.ts"] }),
        taskState({ expectedFiles: ["src/a.ts"] }),
      ).classification,
    ).toBe("shared-file");
    expect(
      conflicts.classify(
        taskState({ expectedFiles: [] }),
        taskState({ expectedFiles: ["src/b.ts"] }),
      ).classification,
    ).toBe("unknown");
  });

  it("keeps Git mutations outside workflow-definition approval gates", () => {
    const gates = new WorkflowDefinitionRegistry()
      .list()
      .flatMap((definition) => definition.requiredGates);
    expect(gates).not.toContain("git-staging");
    expect(gates).not.toContain("commit");
    expect(gates).not.toContain("push");
    expect(gates).not.toContain("pr-creation");
  });

  it("recovers interrupted running work as paused without fabricated completion", async () => {
    const root = await temporary();
    const source = buildSource();
    const workflow = fakeWorkflow(source);
    const store = new OrchestrationPersistenceStore(root);
    const service = new OrchestrationService(store, workflow, new ExecutionRoutingService());
    await service.initialize();
    const created = await service.create(SOURCE_ID);
    const planned = await service.plan(created.id);
    for (const gate of planned.approvalGates)
      await service.decide(created.id, gate.id, "approved", "Approved");
    await service.start(created.id);
    const restored = new OrchestrationService(
      new OrchestrationPersistenceStore(root),
      workflow,
      new ExecutionRoutingService(),
    );
    await restored.initialize();
    expect(restored.get(created.id)?.status).toBe("paused");
    expect(
      restored.get(created.id)?.diagnostics.some((item) => item.code === "INTERRUPTED_RELOAD"),
    ).toBe(true);
  });

  it("marks resume stale when repository, branch, HEAD, or Intelligence changed", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID);
    const planned = await service.plan(created.id);
    for (const gate of planned.approvalGates)
      await service.decide(created.id, gate.id, "approved", "Approved");
    await service.start(created.id);
    await service.pause(created.id);
    const resumed = await service.resume(created.id, {
      repositoryId: "repo",
      branch: "other",
      headCommit: "head-2",
      intelligenceGeneration: 8,
    });
    expect(resumed.status).toBe("stale");
  });

  it("preserves evidence and user changes when cancellation completes", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID);
    const cancelled = await service.cancel(created.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.audit.map((item) => item.action)).toContain("status-cancelled");
    expect(cancelled.taskStates).toEqual(created.taskStates);
  });

  it("exposes deterministic, Copilot, manual, and unsupported routes only", () => {
    const routing = new ExecutionRoutingService();
    expect(routing.decide({ operation: "query-execution", copilotAvailable: false }).route).toBe(
      "deterministic",
    );
    expect(
      routing.decide({
        operation: "code-implementation",
        copilotAvailable: true,
        copilotAgentId: "copilot",
      }).route,
    ).toBe("github-copilot");
    expect(routing.decide({ operation: "git-operation", copilotAvailable: false }).route).toBe(
      "manual",
    );
    expect(routing.decide({ operation: "unsupported", copilotAvailable: false }).route).toBe(
      "unsupported",
    );
  });

  it("triggers QA, security, performance, documentation, and validation reviews deterministically", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID);
    expect(service.reviewPlan(created.id, "qa").triggered).toBe(true);
    expect(service.reviewPlan(created.id, "security").triggered).toBe(true);
    expect(service.reviewPlan(created.id, "performance").triggered).toBe(true);
    expect(service.reviewPlan(created.id, "documentation").triggered).toBe(false);
    expect(service.reviewPlan(created.id, "validation").requiredChecks).toContain("tests");
  });

  it("requires validation evidence for completion and preserves failed attempts for bounded retry", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID);
    const taskId = created.taskStates[0]!.taskId;
    await expect(
      service.recordTaskCompletion(created.id, taskId, [], "No evidence"),
    ).rejects.toThrow("validation");
    const failed = await service.recordTaskFailure(created.id, taskId, "Unit validation failed", [
      crypto.randomUUID(),
    ]);
    expect(failed.taskStates[0]?.status).toBe("failed");
    const retried = await service.retryTask(created.id, taskId, "Focused repair", "copilot-repair");
    expect(retried.taskStates[0]?.retryCount).toBe(1);
    expect(retried.audit.some((item) => item.action === "task-retry-planned")).toBe(true);
  });

  it("does not project task completion before the authoritative task records it", async () => {
    const { service } = await fixture();
    const created = await service.create(SOURCE_ID);
    const taskId = created.taskStates[0]!.taskId;
    const projected = await service.recordTaskCompletion(
      created.id,
      taskId,
      [crypto.randomUUID()],
      "Validation reference recorded.",
    );
    expect(projected.taskStates[0]?.status).toBe("ready");
    expect(
      projected.taskStates[0]?.readinessBlockers.some(
        (item) => item.code === "AUTHORITATIVE_COMPLETION_MISSING",
      ),
    ).toBe(true);
  });
});

const SOURCE_ID = "00000000-0000-4000-8000-000000000010";
function buildSource(
  options: { assigned?: boolean; second?: boolean } = { assigned: true },
): DevelopmentWorkflowSnapshot {
  const now = new Date().toISOString();
  const specId = "00000000-0000-4000-8000-000000000011";
  const task1 = "00000000-0000-4000-8000-000000000012";
  const task2 = "00000000-0000-4000-8000-000000000013";
  const tasks = [
    {
      id: task1,
      workflowId: SOURCE_ID,
      specificationId: specId,
      specificationRevision: 1,
      title: "Implement feature",
      objective: "Implement approved behavior",
      description: "Implement and validate",
      category: "feature" as const,
      status: "ready" as const,
      dependencies: [],
      requirementIds: ["REQ-1"],
      acceptanceCriterionIds: ["AC-1"],
      expectedFiles: ["src/feature.ts"],
      expectedEntityIds: ["entity:feature"],
      validationSteps: [{ manualCheck: "Run tests" }],
      ...(options.assigned === false ? {} : { assignedAgentId: "copilot" }),
      requiredCapabilities: ["implementation" as const],
      staleReasons: [],
      baseEntityFingerprints: {},
      createdAt: now,
      updatedAt: now,
    },
    ...(options.second
      ? [
          {
            id: task2,
            workflowId: SOURCE_ID,
            specificationId: specId,
            specificationRevision: 1,
            title: "Validate feature",
            objective: "Validate",
            description: "Validate approved behavior",
            category: "testing" as const,
            status: "pending" as const,
            dependencies: [task1],
            requirementIds: ["REQ-1"],
            acceptanceCriterionIds: ["AC-1"],
            expectedFiles: ["tests/feature.test.ts"],
            expectedEntityIds: [],
            validationSteps: [{ manualCheck: "Run tests" }],
            assignedAgentId: "copilot",
            requiredCapabilities: ["testing" as const],
            staleReasons: [],
            baseEntityFingerprints: {},
            createdAt: now,
            updatedAt: now,
          },
        ]
      : []),
  ];
  return DevelopmentWorkflowSnapshotSchema.parse({
    schemaVersion: 1,
    id: SOURCE_ID,
    revision: 1,
    repositoryId: "repo",
    branch: "main",
    headCommit: "head-1",
    intelligenceGeneration: 7,
    intent: {
      id: "00000000-0000-4000-8000-000000000014",
      workflowId: SOURCE_ID,
      revision: 1,
      originalText: "Add a secure endpoint with performance validation",
      normalizedObjective: "Add endpoint",
      mode: "guided",
      category: "feature",
      expectedOutcome: "Feature works",
      risk: "high",
      constraints: [],
      ambiguities: [],
      requiredDecisions: [],
      affectedEntities: [],
      intelligenceGeneration: 7,
      branch: "main",
      createdAt: now,
    },
    specification: {
      id: specId,
      workflowId: SOURCE_ID,
      revision: 1,
      status: "approved",
      title: "Feature",
      repositoryId: "repo",
      branch: "main",
      baseCommit: "head-1",
      intelligenceGeneration: 7,
      objective: "Feature",
      scope: {
        included: ["feature"],
        excluded: [],
        expectedFiles: ["src/feature.ts"],
        entityIds: ["entity:feature"],
      },
      requirements: [{ id: "REQ-1", description: "Feature requirement" }],
      constraints: [],
      acceptanceCriteria: [
        {
          id: "AC-1",
          description: "Feature works",
          required: true,
          requirementIds: ["REQ-1"],
          validationMethod: "tests",
          expectedEvidence: "passing test",
          coveringTaskIds: tasks.map((task) => task.id),
        },
      ],
      testStrategy: {
        existingTests: [],
        requiredTests: ["unit"],
        validationCommands: ["npm test"],
        manualScenarios: [],
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
      id: "00000000-0000-4000-8000-000000000015",
      workflowId: SOURCE_ID,
      specificationId: specId,
      specificationRevision: 1,
      revision: 1,
      taskIds: tasks.map((task) => task.id),
      topologicalOrder: tasks.map((task) => task.id),
      ready: true,
      diagnostics: [],
      createdAt: now,
    },
    tasks,
    status: "planned",
    createdAt: now,
    updatedAt: now,
  });
}
function fakeWorkflow(source: DevelopmentWorkflowSnapshot): DevelopmentWorkflowService {
  return {
    get: (id: string) => (id === source.id ? source : undefined),
    list: () => [source],
  } as unknown as DevelopmentWorkflowService;
}
async function fixture(source = buildSource()): Promise<{ service: OrchestrationService }> {
  const root = await temporary();
  const service = new OrchestrationService(
    new OrchestrationPersistenceStore(root),
    fakeWorkflow(source),
    new ExecutionRoutingService(),
  );
  await service.initialize();
  return { service };
}
async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "keystone-orchestration-"));
  roots.push(root);
  return root;
}
function taskState(
  patch: Partial<WorkflowInstance["taskStates"][number]> = {},
): WorkflowInstance["taskStates"][number] {
  return {
    taskId: crypto.randomUUID(),
    title: "Task",
    status: "pending",
    dependencies: [],
    priority: 50,
    risk: "low",
    readOnly: false,
    expectedFiles: ["src/default.ts"],
    expectedEntityIds: [],
    route: "deterministic",
    requiredCapabilities: [],
    readinessBlockers: [],
    warnings: [],
    validationRunIds: [],
    retryCount: 0,
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}
