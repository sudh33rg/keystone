import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChangeAttributionService,
  ExecutionStateMachine,
  ResultCaptureService,
  TaskExecutionService,
} from "../../../src/core/execution/TaskExecutionService";
import {
  AcceptanceCriteriaValidator,
  CommandExecutionService,
  ValidationOrchestrator,
} from "../../../src/core/validation/TaskValidationService";
import { CompletionDecisionService } from "../../../src/core/execution/CompletionService";
import { ExecutionPersistenceStore } from "../../../src/core/persistence/ExecutionPersistenceStore";
import type { WorkspaceAdapter } from "../../../src/extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../../src/extension/adapters/GitAdapter";
import type { DevelopmentWorkflowService } from "../../../src/core/workflows/DevelopmentWorkflowService";
import type { DevelopmentWorkflowSnapshot } from "../../../src/shared/contracts/delegation";
import {
  CommandDescriptorSchema,
  TaskExecutionSessionSchema,
  ValidationEvidenceSchema,
  ValidationPlanSchema,
  ValidationRunSchemaV2,
  ValidationStepResultSchema,
  type TaskExecutionStatus,
} from "../../../src/shared/contracts/execution";
import { CopilotAgentDescriptorSchema } from "../../../src/shared/contracts/delegation";
import { intelligenceSnapshot } from "../intelligence/fixtures";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);
const NOW = "2026-07-16T10:00:00.000Z";
const TASK = "10000000-0000-4000-8000-000000000001";
const WORKFLOW = "10000000-0000-4000-8000-000000000002";
const SPEC = "10000000-0000-4000-8000-000000000003";
const DELEGATION = "10000000-0000-4000-8000-000000000004";
const SESSION = "10000000-0000-4000-8000-000000000005";

function session(status: TaskExecutionStatus = "executing") {
  const agent = CopilotAgentDescriptorSchema.parse({
    id: "agent",
    displayName: "Agent",
    source: "copilot-discovered",
    availability: "available",
    capabilities: ["implementation"],
    taskCategories: ["feature"],
    invocationMethod: "direct",
    restrictions: [],
    confidence: 1,
    evidence: [
      {
        kind: "runtime",
        source: "test",
        statement: "Supported test contract.",
      },
    ],
  });
  return TaskExecutionSessionSchema.parse({
    schemaVersion: 1,
    id: SESSION,
    taskId: TASK,
    workflowId: WORKFLOW,
    specificationId: SPEC,
    specificationRevision: 1,
    delegationSessionId: DELEGATION,
    agentId: agent.id,
    agentSnapshot: agent,
    delegationMode: "assisted",
    status,
    repositoryBaseline: {
      branch: "main",
      headCommit: "head",
      dirtyFiles: ["src/pre.ts"],
      stagedFiles: [],
      untrackedFiles: [],
      expectedFiles: ["src/index.ts"],
      entityFingerprints: {},
      capturedAt: NOW,
    },
    expectedFiles: ["src/index.ts", "src/feature/expected.ts"],
    expectedEntityIds: [],
    observedChanges: [],
    validationRunIds: [],
    retryAttempt: 0,
    updatedAt: NOW,
    diagnostics: [],
  });
}

describe("execution state and change attribution", () => {
  it("permits explicit transitions and rejects invalid completion jumps", () => {
    const machine = new ExecutionStateMachine();
    expect(() =>
      machine.transition("awaiting-start", "executing"),
    ).not.toThrow();
    expect(() => machine.transition("awaiting-start", "completed")).toThrow(
      "Invalid execution transition",
    );
  });
  it.each([
    ["src/pre.ts", "modified", "pre-existing"],
    ["src/index.ts", "modified", "expected"],
    ["src/feature/helper.ts", "modified", "related"],
    ["docs/readme.md", "modified", "unexpected"],
    ["new/unknown.ts", "added", "ambiguous"],
  ] as const)("classifies %s as %s evidence", (path, kind, expected) => {
    const result = new ChangeAttributionService().classify(
      { uri: path, kind },
      session().repositoryBaseline,
      session().expectedFiles,
      intelligenceSnapshot(1),
    );
    expect(result.classification).toBe(expected);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
  it("keeps user attribution as an auditable override", () => {
    const original = new ChangeAttributionService().classify(
      { uri: "docs/readme.md", kind: "modified" },
      session().repositoryBaseline,
      session().expectedFiles,
      intelligenceSnapshot(1),
    );
    const overridden = {
      ...original,
      classification: "concurrent" as const,
      userOverride: {
        classification: "concurrent" as const,
        reason: "I edited this concurrently.",
        at: NOW,
      },
    };
    expect(overridden.userOverride.reason).toContain("concurrently");
  });
});

describe("result capture honesty", () => {
  it("rejects unsupported direct result capture", () => {
    expect(() =>
      new ResultCaptureService().capture(session(), { mode: "direct" }),
    ).toThrow("supported integration");
  });
  it("records assisted claims separately and redacts secret-like text", () => {
    const result = new ResultCaptureService().capture(session(), {
      mode: "assisted",
      agentClaims: {
        summary: "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      },
    });
    expect(result.agentClaims?.summary).toContain("[REDACTED]");
    expect(result.diagnostics[0]).toContain("untrusted");
  });
  it("supports repository-only capture with explicit missing-agent diagnostics", () => {
    const result = new ResultCaptureService().capture(session(), {
      mode: "repository-only",
    });
    expect(result.agentClaims).toBeUndefined();
    expect(result.diagnostics.join(" ")).toContain("No Copilot result");
  });
});

describe("safe command execution", () => {
  it("runs an allowlisted executable without shell interpolation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-command-"));
    temporary.push(cwd);
    const result = await new CommandExecutionService().execute(
      "version",
      CommandDescriptorSchema.parse({
        executable: "npm",
        args: ["--version"],
        workingDirectory: cwd,
        safety: "safe-readonly",
        provenance: "keystone-static",
        approved: true,
        timeoutMs: 10_000,
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.outputTail.trim()).toMatch(/^\d+\./);
  });
  it("requires approval for potentially mutating commands", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-command-"));
    temporary.push(cwd);
    const command = CommandDescriptorSchema.parse({
      executable: "npm",
      args: ["--version"],
      workingDirectory: cwd,
      safety: "potentially-mutating",
      provenance: "repository-script",
      approved: false,
      timeoutMs: 10_000,
    });
    await expect(
      new CommandExecutionService().execute("blocked", command),
    ).rejects.toThrow("explicit approval");
  });
  it("bounds output and redacts secrets", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-command-"));
    temporary.push(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          noisy:
            "node -e \"console.log('token=ghp_abcdefghijklmnopqrstuvwxyz1234567890'); console.log('x'.repeat(50000))\"",
        },
      }),
    );
    const result = await new CommandExecutionService().execute(
      "noisy",
      CommandDescriptorSchema.parse({
        executable: "npm",
        args: ["run", "noisy"],
        workingDirectory: cwd,
        safety: "project-validation",
        provenance: "repository-script",
        approved: true,
        timeoutMs: 10_000,
      }),
    );
    expect(result.outputTruncated).toBe(true);
    expect(result.outputTail.length).toBeLessThanOrEqual(20_000);
    expect(result.outputTail).not.toContain("ghp_");
  });
  it("cancels a managed process tree through an abort signal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-command-"));
    temporary.push(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { slow: 'node -e "setTimeout(() => {}, 10000)"' },
      }),
    );
    const controller = new AbortController();
    const pending = new CommandExecutionService().execute(
      "slow",
      CommandDescriptorSchema.parse({
        executable: "npm",
        args: ["run", "slow"],
        workingDirectory: cwd,
        safety: "project-validation",
        provenance: "repository-script",
        approved: true,
        timeoutMs: 20_000,
      }),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(result.durationMs).toBeLessThan(5_000);
  });
});

describe("acceptance criteria mapping", () => {
  function plan() {
    const first = "10000000-0000-4000-8000-000000000011";
    const second = "10000000-0000-4000-8000-000000000012";
    return ValidationPlanSchema.parse({
      schemaVersion: 1,
      id: "10000000-0000-4000-8000-000000000010",
      taskId: TASK,
      executionSessionId: SESSION,
      steps: [
        {
          id: first,
          type: "type-check",
          description: "typecheck",
          provider: "test",
          dependencies: [],
          required: true,
          expectedEvidence: "output",
          acceptanceCriterionIds: ["AC-1"],
          status: "approved",
        },
        {
          id: second,
          type: "manual-review",
          description: "review",
          provider: "test",
          dependencies: [],
          required: true,
          expectedEvidence: "manual",
          acceptanceCriterionIds: ["AC-2"],
          status: "approved",
        },
      ],
      acceptanceCriteriaMappings: [
        { criterionId: "AC-1", stepIds: [first] },
        { criterionId: "AC-2", stepIds: [second] },
      ],
      repositoryGeneration: 1,
      repositoryFingerprint: "fingerprint",
      createdAt: NOW,
      diagnostics: [],
    });
  }
  it("passes observed criteria and preserves manual-review requirements", () => {
    const value = plan();
    const evidence = [
      ValidationEvidenceSchema.parse({
        id: "10000000-0000-4000-8000-000000000020",
        kind: "build-output",
        source: `validation-step:${value.steps[0]!.id}:AC-1`,
        reliability: "observed",
        summary: "passed",
        createdAt: NOW,
      }),
    ];
    const results = [
      ValidationStepResultSchema.parse({
        stepId: value.steps[0]!.id,
        status: "passed",
        startedAt: NOW,
        completedAt: NOW,
        durationMs: 1,
        outputTail: "",
        errorTail: "",
        outputTruncated: false,
        evidenceIds: [evidence[0]!.id],
        baselineClassification: "unknown",
      }),
      ValidationStepResultSchema.parse({
        stepId: value.steps[1]!.id,
        status: "skipped",
        startedAt: NOW,
        completedAt: NOW,
        durationMs: 1,
        outputTail: "",
        errorTail: "",
        outputTruncated: false,
        evidenceIds: [],
        baselineClassification: "unknown",
      }),
    ];
    const criteria = new AcceptanceCriteriaValidator().evaluate(
      value,
      results,
      evidence,
    );
    expect(criteria.map((item) => item.status)).toEqual([
      "passed",
      "requires-manual-review",
    ]);
  });
  it("fails a criterion when a mapped required step fails", () => {
    const value = plan();
    const results = [
      ValidationStepResultSchema.parse({
        stepId: value.steps[0]!.id,
        status: "failed",
        startedAt: NOW,
        completedAt: NOW,
        durationMs: 1,
        outputTail: "",
        errorTail: "failed",
        outputTruncated: false,
        evidenceIds: [],
        baselineClassification: "new",
      }),
    ];
    expect(
      new AcceptanceCriteriaValidator().evaluate(value, results, [])[0]?.status,
    ).toBe("failed");
  });
});

describe("validation and completion integration", () => {
  it("preserves the failed attempt and creates a retry with a fresh baseline", async () => {
    const runId = "10000000-0000-4000-8000-000000000041";
    const original = TaskExecutionSessionSchema.parse({
      ...session("validation-failed"),
      validationRunIds: [runId],
    });
    const store = new ExecutionPersistenceStore();
    await store.initialize();
    await store.update((state) => ({
      ...state,
      sessions: [original],
      runs: [
        ValidationRunSchemaV2.parse({
          schemaVersion: 1,
          id: runId,
          executionSessionId: original.id,
          taskId: original.taskId,
          status: "failed",
          startedAt: NOW,
          completedAt: NOW,
          stepResults: [],
          acceptanceCriteriaResults: [
            {
              criterionId: "AC-1",
              status: "failed",
              stepIds: [],
              evidenceIds: [],
              explanation: "The required check failed.",
            },
          ],
          findings: [],
          evidence: [],
          summary: {
            requiredStepsPassed: 0,
            requiredStepsFailed: 1,
            criteriaPassed: 0,
            criteriaFailed: 1,
            criteriaRequiringReview: 0,
            newRegressions: 1,
            preExistingFailures: 0,
            unexpectedChanges: 0,
            blockingFindings: 0,
          },
          repositoryGeneration: 7,
          repositoryFingerprint: "failed-attempt",
          diagnostics: [],
        }),
      ],
    }));
    const workspace = {
      getRoots: () => [{ name: "fixture", uri: "file:///workspace" }],
      resolveFile: (value: string) => ({
        relativePath: value.replace("file:///workspace/", ""),
      }),
    } as unknown as WorkspaceAdapter;
    const git = {
      getMetadata: () =>
        Promise.resolve({ branch: "main", headCommit: "retry-head" }),
      getChangedFiles: () =>
        Promise.resolve(["file:///workspace/src/index.ts"]),
      getStagedFiles: () => Promise.resolve([]),
      getUntrackedFiles: () => Promise.resolve([]),
    } as unknown as GitAdapter;
    const service = new TaskExecutionService(
      store,
      {} as never,
      {} as never,
      git,
      workspace,
      { getSnapshot: () => intelligenceSnapshot(7) } as never,
    );

    const plan = await service.planRetry(
      original.id,
      "same-agent",
      "Repair AC-1 only.",
    );
    const retry = await service.startRetry(original.id);

    expect(plan.failedCriterionIds).toEqual(["AC-1"]);
    expect(service.get(original.id)?.status).toBe("retrying");
    expect(retry.parentExecutionSessionId).toBe(original.id);
    expect(retry.status).toBe("awaiting-start");
    expect(retry.repositoryBaseline.headCommit).toBe("retry-head");
    expect(retry.repositoryBaseline.dirtyFiles).toEqual(["src/index.ts"]);
    expect(retry.validationRunIds).toEqual([]);
    expect(store.snapshot.sessions).toHaveLength(2);
  });

  it("runs repository-discovered validation and unlocks dependencies only after explicit completion", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-validation-"));
    temporary.push(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "node -e \"console.log('typecheck passed')\"",
          test: "node -e \"console.log('tests passed')\"",
        },
      }),
    );
    const workspace = {
      getRoots: () => [{ name: "fixture", uri: `file://${cwd}` }],
      fileReference: (_root: unknown, path: string) => ({
        uri: `file://${join(cwd, path)}`,
      }),
      readTextFile: (uri: string) => readFile(new URL(uri), "utf8"),
      resolveFile: (uri: string) => ({
        relativePath: uri.startsWith("file:")
          ? new URL(uri).pathname.slice(cwd.length + 1)
          : uri,
      }),
    } as unknown as WorkspaceAdapter;
    const snapshot = intelligenceSnapshot(7);
    snapshot.repository.branch = "main";
    snapshot.repository.headCommit = "head";
    let current = TaskExecutionSessionSchema.parse({
      ...session("result-captured"),
      observedChanges: [
        {
          relativePath: "src/index.ts",
          kind: "modified",
          classification: "expected",
          confidence: 1,
          reasons: ["expected"],
          relatedEntityIds: [],
          evidenceIds: [],
        },
      ],
      changedEntities: [
        {
          entityId: snapshot.files[0]!.id,
          entityType: "keystone.core.File",
          qualifiedName: "src/index.ts",
          relativePath: "src/index.ts",
          changeKind: "file-modified",
          confidence: 1,
          evidenceIds: snapshot.files[0]!.evidenceIds,
          limitations: [],
        },
      ],
      resultCapture: {
        mode: "repository-only",
        attributedChanges: [
          {
            relativePath: "src/index.ts",
            kind: "modified",
            classification: "expected",
            confidence: 1,
            reasons: ["expected"],
            relatedEntityIds: [],
            evidenceIds: [],
          },
        ],
        capturedAt: NOW,
        diagnostics: [],
      },
    });
    const execution = {
      get: () => current,
      sessions: {
        transition: (
          _id: string,
          status: TaskExecutionStatus,
          patch: Partial<typeof current> = {},
        ) => {
          current = TaskExecutionSessionSchema.parse({
            ...current,
            ...patch,
            status,
            updatedAt: new Date().toISOString(),
          });
          return Promise.resolve(current);
        },
        replace: (_id: string, patch: Partial<typeof current>) => {
          current = TaskExecutionSessionSchema.parse({
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
          });
          return Promise.resolve(current);
        },
      },
    } as unknown as TaskExecutionService;
    let workflow = workflowFixture();
    const workflows = {
      get: () => workflow,
      setTaskStatus: (_workflowId: string, taskId: string, status: string) => {
        workflow = {
          ...workflow,
          tasks: workflow.tasks.map((item) =>
            item.id === taskId
              ? { ...item, status: status as typeof item.status }
              : item,
          ),
        };
        return Promise.resolve(workflow);
      },
    } as unknown as DevelopmentWorkflowService;
    const store = new ExecutionPersistenceStore();
    await store.initialize();
    await store.update((state) => ({ ...state, sessions: [current] }));
    const snapshots = {
      getSnapshot: () => snapshot,
      isStorageAvailable: () => true,
      getLoadError: () => undefined,
    };
    const validation = new ValidationOrchestrator(
      store,
      execution,
      workspace,
      snapshots,
      workflows,
    );
    const plan = await validation.plan(current.id);
    expect(
      plan.steps.some(
        (step) =>
          step.type === "type-check" && step.command?.executable === "npm",
      ),
    ).toBe(true);
    expect(plan.steps.filter((step) => step.type === "unit-test")).toHaveLength(
      1,
    );
    expect(plan.steps.some((step) => step.type === "impacted-test")).toBe(
      false,
    );
    expect(plan.diagnostics.join(" ")).toContain("conservative fallback");
    const run = await validation.run(plan.id);
    expect(run.status).toBe("passed");
    expect(run.acceptanceCriteriaResults[0]?.status).toBe("passed");
    expect(workflow.tasks[0]?.status).not.toBe("completed");
    const completion = new CompletionDecisionService(
      store,
      execution,
      workflows,
      snapshots,
    );
    expect(completion.evaluate(current.id).status).toBe("ready");
    const result = await completion.complete(current.id, true);
    expect(result.unlockedTaskIds).toEqual([workflow.tasks[1]?.id]);
    expect(workflow.tasks[0]?.status).toBe("completed");
    expect(workflow.tasks[1]?.status).toBe("ready");
  });
});

function workflowFixture(): DevelopmentWorkflowSnapshot {
  const second = "10000000-0000-4000-8000-000000000099";
  const intent = {
    id: "10000000-0000-4000-8000-000000000090",
    workflowId: WORKFLOW,
    revision: 1,
    originalText: "change",
    normalizedObjective: "change",
    mode: "spec-driven" as const,
    category: "feature" as const,
    expectedOutcome: "change",
    risk: "medium" as const,
    constraints: [],
    ambiguities: [],
    requiredDecisions: [],
    affectedEntities: [],
    intelligenceGeneration: 7,
    branch: "main",
    createdAt: NOW,
  };
  const specification = {
    id: SPEC,
    workflowId: WORKFLOW,
    revision: 1,
    status: "approved" as const,
    title: "change",
    repositoryId: "repository:fixture",
    branch: "main",
    baseCommit: "head",
    intelligenceGeneration: 7,
    objective: "change",
    scope: {
      included: ["src/index.ts"],
      excluded: [],
      expectedFiles: ["src/index.ts"],
      entityIds: [],
    },
    requirements: [{ id: "REQ-1", description: "change" }],
    constraints: [],
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "validated",
        required: true,
        requirementIds: ["REQ-1"],
        validationMethod: "typecheck",
        expectedEvidence: "output",
        coveringTaskIds: [TASK],
      },
    ],
    testStrategy: {
      existingTests: [],
      requiredTests: [],
      validationCommands: ["npm run typecheck"],
      manualScenarios: [],
      risks: [],
    },
    decisions: [],
    evidence: [],
    approval: { approvedAt: NOW, approvedBy: "user" as const, revision: 1 },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const base = {
    workflowId: WORKFLOW,
    specificationId: SPEC,
    specificationRevision: 1,
    category: "feature" as const,
    dependencies: [],
    requirementIds: ["REQ-1"],
    acceptanceCriterionIds: ["AC-1"],
    expectedFiles: ["src/index.ts"],
    expectedEntityIds: [],
    validationSteps: [{ command: "npm run typecheck" }],
    requiredCapabilities: ["implementation" as const],
    staleReasons: [],
    baseEntityFingerprints: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    schemaVersion: 1,
    id: WORKFLOW,
    revision: 1,
    repositoryId: "repository:fixture",
    branch: "main",
    headCommit: "head",
    intelligenceGeneration: 7,
    intent,
    specification,
    specificationHistory: [],
    tasks: [
      {
        ...base,
        id: TASK,
        title: "first",
        objective: "first",
        description: "first",
        status: "blocked",
      },
      {
        ...base,
        id: second,
        title: "second",
        objective: "second",
        description: "second",
        status: "pending",
        dependencies: [TASK],
      },
    ],
    status: "planned",
    createdAt: NOW,
    updatedAt: NOW,
  };
}
