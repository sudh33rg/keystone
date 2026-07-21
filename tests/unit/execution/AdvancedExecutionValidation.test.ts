import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChangedEntityResolver,
  RepositoryBaselineService,
  intelligenceDiagnosticFingerprint,
} from "../../../src/core/execution/ExecutionAnalysisServices";
import { TaskExecutionService } from "../../../src/core/execution/TaskExecutionService";
import { ExecutionPersistenceStore } from "../../../src/core/persistence/ExecutionPersistenceStore";
import {
  CommandExecutionService,
  ValidationOrchestrator,
} from "../../../src/core/validation/TaskValidationService";
import {
  PerformanceValidationProvider,
  SecurityValidationProvider,
  StaticValidationProvider,
  TestImpactService,
} from "../../../src/core/validation/ValidationProviders";
import type { GitAdapter } from "../../../src/extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../../src/extension/adapters/WorkspaceAdapter";
import {
  CommandDescriptorSchema,
  TaskExecutionSessionSchema,
  ValidationPlanPayloadSchema,
  ValidationRunSchemaV2,
  ValidationStepSchema,
  type TaskExecutionSession,
} from "../../../src/shared/contracts/execution";
import { CopilotAgentDescriptorSchema } from "../../../src/shared/contracts/delegation";
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../../src/shared/contracts/intelligence";
import { intelligenceSnapshot } from "../intelligence/fixtures";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const IDS = {
  session: "20000000-0000-4000-8000-000000000001",
  task: "20000000-0000-4000-8000-000000000002",
  workflow: "20000000-0000-4000-8000-000000000003",
  specification: "20000000-0000-4000-8000-000000000004",
  delegation: "20000000-0000-4000-8000-000000000005",
  step: "20000000-0000-4000-8000-000000000006",
} as const;

function executionSession(patch: Partial<TaskExecutionSession> = {}): TaskExecutionSession {
  const agent = CopilotAgentDescriptorSchema.parse({
    id: "fixture-agent",
    displayName: "Fixture agent",
    source: "copilot-discovered",
    availability: "available",
    capabilities: ["implementation"],
    taskCategories: ["feature"],
    invocationMethod: "direct",
    restrictions: [],
    confidence: 1,
    evidence: [{ kind: "runtime", source: "fixture", statement: "Observed agent." }],
  });
  return TaskExecutionSessionSchema.parse({
    schemaVersion: 1,
    id: IDS.session,
    taskId: IDS.task,
    workflowId: IDS.workflow,
    specificationId: IDS.specification,
    specificationRevision: 1,
    delegationSessionId: IDS.delegation,
    agentId: agent.id,
    agentSnapshot: agent,
    delegationMode: "assisted",
    status: "result-captured",
    repositoryBaseline: {
      repositoryId: "repository:fixture",
      intelligenceGeneration: 1,
      branch: "main",
      headCommit: "head",
      dirtyFiles: [],
      stagedFiles: [],
      untrackedFiles: [],
      expectedFiles: ["src/index.ts"],
      fileHashes: { "src/index.ts": "before" },
      entityFingerprints: {},
      diagnosticFingerprints: [],
      knownValidationOutcomes: [],
      capturedAt: "2026-07-16T00:00:00.000Z",
    },
    expectedFiles: ["src/index.ts"],
    expectedEntityIds: [],
    observedChanges: [
      {
        relativePath: "src/index.ts",
        kind: "modified",
        classification: "expected",
        confidence: 1,
        reasons: ["Expected file."],
        relatedEntityIds: [],
        evidenceIds: ["evidence:file"],
      },
    ],
    changedEntities: [],
    validationRunIds: [],
    retryAttempt: 0,
    updatedAt: "2026-07-16T00:00:00.000Z",
    diagnostics: [],
    ...patch,
  });
}

function validationStep(type: "static-analysis" | "security-check" | "performance-check") {
  return ValidationStepSchema.parse({
    id: IDS.step,
    type,
    description: `Run ${type}.`,
    provider: "fixture",
    dependencies: [],
    required: true,
    expectedEvidence: "Bounded evidence.",
    acceptanceCriterionIds: ["AC-1"],
    scopePaths: ["src/index.ts"],
    inputFingerprint: "fixture",
    status: "approved",
  });
}

function symbol(
  snapshot: IntelligenceSnapshot,
  patch: Partial<IntelligenceSymbolRecord> = {},
): IntelligenceSymbolRecord {
  return {
    id: "symbol:production",
    repositoryId: snapshot.repository.id,
    fileId: snapshot.files[0]!.id,
    type: "keystone.code.Function",
    name: "handle",
    qualifiedName: "src/index.handle",
    language: "typescript",
    signature: "handle(value: string): void",
    range: { startLine: 1, startColumn: 0, endLine: 4, endColumn: 1 },
    visibility: "public",
    exported: true,
    evidenceIds: ["evidence:file"],
    confidence: 1,
    generation: snapshot.manifest.generation,
    ...patch,
  };
}

describe("baseline and semantic change analysis", () => {
  it("captures repository identity, generation, hashes, diagnostics, and Git state", async () => {
    const snapshot = intelligenceSnapshot(7);
    snapshot.diagnostics.push({
      code: "existing",
      severity: "error",
      message: "Existing diagnostic.",
      relativePath: "src/index.ts",
    });
    const git = {
      getMetadata: () => Promise.resolve({ branch: "main", headCommit: "abc" }),
      getChangedFiles: () => Promise.resolve(["file:///repo/src/index.ts"]),
      getStagedFiles: () => Promise.resolve(["file:///repo/src/staged.ts"]),
      getUntrackedFiles: () => Promise.resolve(["file:///repo/src/new.ts"]),
    } as unknown as GitAdapter;
    const workspace = {
      getRoots: () => [{ name: "fixture", uri: "file:///repo" }],
      resolveFile: (value: string) => ({
        relativePath: value.replace("file:///repo/", ""),
      }),
    } as unknown as WorkspaceAdapter;
    const baseline = await new RepositoryBaselineService(git, workspace, {
      getSnapshot: () => snapshot,
    } as never).capture(["src/index.ts"], {
      "symbol:production": "fingerprint",
    });
    expect(baseline).toMatchObject({
      repositoryId: "repository:fixture",
      intelligenceGeneration: 7,
      branch: "main",
      headCommit: "abc",
      dirtyFiles: ["src/index.ts"],
      stagedFiles: ["src/staged.ts"],
      untrackedFiles: ["src/new.ts"],
      fileHashes: { "src/index.ts": "abc123" },
    });
    expect(baseline.diagnosticFingerprints).toHaveLength(1);
  });

  it("detects signature, route, and schema changes from retained generations", async () => {
    const previous = intelligenceSnapshot(1);
    const current = intelligenceSnapshot(2);
    previous.files[0]!.contentHash = "before";
    current.files[0]!.contentHash = "after";
    previous.symbols = [
      symbol(previous),
      symbol(previous, {
        id: "symbol:route",
        name: "route",
        qualifiedName: "GET /items",
        type: "keystone.api.Route",
        properties: { path: "/items" },
      }),
      symbol(previous, {
        id: "symbol:schema",
        name: "users",
        qualifiedName: "public.users",
        type: "keystone.data.Table",
        properties: { columns: ["id"] },
      }),
    ];
    current.symbols = [
      symbol(current, { signature: "handle(value: number): void" }),
      symbol(current, {
        id: "symbol:route",
        name: "route",
        qualifiedName: "GET /items",
        type: "keystone.api.Route",
        properties: { path: "/items/:id" },
      }),
      symbol(current, {
        id: "symbol:schema",
        name: "users",
        qualifiedName: "public.users",
        type: "keystone.data.Table",
        properties: { columns: ["id", "email"] },
      }),
    ];
    const changes = await new ChangedEntityResolver({
      getSnapshot: () => current,
      getRetainedSnapshots: () => Promise.resolve([previous]),
    } as never).resolve(executionSession());
    expect(changes.map((item) => item.changeKind)).toEqual(
      expect.arrayContaining(["signature-change", "route-change", "schema-change"]),
    );
  });
});

describe("safe command hardening", () => {
  it("enforces time budgets", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-timeout-"));
    temporary.push(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { slow: 'node -e "setTimeout(() => {}, 10000)"' },
      }),
    );
    const result = await new CommandExecutionService([cwd]).execute(
      "timeout",
      CommandDescriptorSchema.parse({
        executable: "npm",
        args: ["run", "slow"],
        workingDirectory: cwd,
        safety: "project-validation",
        provenance: "repository-script",
        approved: true,
        timeoutMs: 1000,
      }),
    );
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it.each([
    ["remote push", ["run", "push"]],
    ["deployment", ["run", "deploy"]],
    ["production migration", ["run", "migrate", "deploy"]],
  ])("rejects prohibited %s commands", async (_label, args) => {
    const cwd = await mkdtemp(join(tmpdir(), "keystone-prohibited-"));
    temporary.push(cwd);
    const command = CommandDescriptorSchema.parse({
      executable: "npm",
      args,
      workingDirectory: cwd,
      safety: "project-validation",
      provenance: "repository-script",
      approved: true,
      timeoutMs: 1000,
    });
    await expect(new CommandExecutionService([cwd]).execute("prohibited", command)).rejects.toThrow(
      "prohibited",
    );
  });

  it("rejects a working directory outside the workspace boundary", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "keystone-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "keystone-outside-"));
    temporary.push(workspace, outside);
    await expect(
      new CommandExecutionService([workspace]).execute(
        "outside",
        CommandDescriptorSchema.parse({
          executable: "npm",
          args: ["--version"],
          workingDirectory: outside,
          safety: "safe-readonly",
          provenance: "keystone-static",
          approved: true,
          timeoutMs: 1000,
        }),
      ),
    ).rejects.toThrow("outside the workspace");
  });
});

describe("evidence-backed validation providers", () => {
  it("ranks exact test mappings above naming candidates and does not auto-select naming", () => {
    const snapshot = intelligenceSnapshot(3);
    const testFile = {
      ...snapshot.files[0]!,
      id: "file:test",
      relativePath: "tests/index.test.ts",
      category: "test" as const,
      isTest: true,
    };
    snapshot.files.push(testFile);
    const production = symbol(snapshot);
    const exact = symbol(snapshot, {
      id: "symbol:test:exact",
      fileId: testFile.id,
      type: "keystone.test.TestCase",
      name: "handles values",
      qualifiedName: "handles values",
    });
    const candidate = symbol(snapshot, {
      id: "symbol:test:candidate",
      fileId: testFile.id,
      type: "keystone.test.TestCase",
      name: "candidate",
      qualifiedName: "candidate",
    });
    snapshot.symbols = [production, exact, candidate];
    snapshot.relationships.push(
      {
        id: "relationship:exact-test",
        repositoryId: snapshot.repository.id,
        sourceId: exact.id,
        targetId: production.id,
        type: "keystone.core.CALLS",
        resolution: "exact",
        evidenceIds: ["evidence:relationship"],
        derivation: "resolved",
        confidence: 1,
        generation: 3,
      },
      {
        id: "relationship:candidate-test",
        repositoryId: snapshot.repository.id,
        sourceId: candidate.id,
        targetId: production.id,
        type: "keystone.core.TESTS",
        resolution: "candidate",
        evidenceIds: ["evidence:relationship"],
        derivation: "calculated",
        confidence: 0.4,
        generation: 3,
      },
    );
    const selected = new TestImpactService({
      getSnapshot: () => snapshot,
    } as never).select(executionSession({ expectedEntityIds: [production.id] }));
    expect(selected.map((item) => item.tier)).toEqual(["exact-resolved-call", "naming-candidate"]);
    expect(selected.map((item) => item.selected)).toEqual([true, false]);
  });

  it("distinguishes pre-existing diagnostics from introduced failures", () => {
    const snapshot = intelligenceSnapshot(3);
    const existing = {
      code: "architecture-layer",
      severity: "error" as const,
      message: "Existing layer violation.",
      relativePath: "src/index.ts",
    };
    snapshot.diagnostics.push(existing, {
      code: "contract-drift",
      severity: "error",
      message: "New contract drift.",
      relativePath: "src/index.ts",
    });
    const result = new StaticValidationProvider({
      getSnapshot: () => snapshot,
    } as never).validate(
      executionSession({
        repositoryBaseline: {
          ...executionSession().repositoryBaseline,
          diagnosticFingerprints: [intelligenceDiagnosticFingerprint(existing)],
        },
      }),
      validationStep("static-analysis"),
    );
    expect(result.status).toBe("failed");
    expect(result.output).toContain("New contract drift");
    expect(result.output).not.toContain("Existing layer violation");
    expect(result.findings[0]?.category).toBe("API");
  });

  it("reports a bounded local CPG security path with limitations", async () => {
    const changed = {
      entityId: "symbol:production",
      entityType: "keystone.code.Function",
      qualifiedName: "handle",
      relativePath: "src/index.ts",
      changeKind: "symbol-modified" as const,
      confidence: 1,
      evidenceIds: ["evidence:file"],
      limitations: [],
    };
    const descriptor = {
      id: "scope:handle",
      semanticSymbolId: changed.entityId,
      name: "handle",
    };
    const nodes = [
      { id: "source", code: "req.body.value", kind: "MEMBER_ACCESS" },
      { id: "sink", code: "exec(req.body.value)", kind: "CALL" },
    ].map((item) => ({
      ...item,
      fileId: "file:src/index.ts",
      scopeId: descriptor.id,
      evidenceIds: ["evidence:file"],
      parserVersion: "1",
      generation: 3,
    }));
    const provider = new SecurityValidationProvider({
      getCpgManifest: () => ({ scopes: [descriptor] }),
      readCpgScope: () =>
        Promise.resolve({
          nodes,
          edges: [
            {
              sourceId: "source",
              targetId: "sink",
              type: "FLOWS_TO",
              confidence: 0.9,
            },
          ],
        }),
    } as never);
    const result = await provider.validate(
      executionSession({ changedEntities: [changed] }),
      validationStep("security-check"),
    );
    expect(result.status).toBe("failed");
    expect(result.findings[0]?.details).toMatchObject({
      source: "req.body.value",
      sink: "exec(req.body.value)",
      confidence: 0.9,
    });
    expect(result.findings[0]?.details?.limitations?.join(" ")).toContain("not repository-wide");
  });

  it("labels structural performance observations as candidates, not runtime regressions", () => {
    const snapshot = intelligenceSnapshot(3);
    snapshot.symbols = [
      symbol(snapshot, {
        codeAnalysis: {
          scopeId: "scope:handle",
          structuralHash: "hash",
          providerId: "fixture-cpg",
          providerVersion: "1",
          calculationMethod: "cpg",
          confidence: 0.8,
          evidenceIds: ["evidence:file"],
          branches: 25,
          calls: 1,
          reads: 1,
          writes: 0,
          unresolvedCalls: 0,
        },
      }),
    ];
    const result = new PerformanceValidationProvider({
      getSnapshot: () => snapshot,
    } as never).validate(
      executionSession({
        changedEntities: [
          {
            entityId: "symbol:production",
            entityType: "keystone.code.Function",
            qualifiedName: "handle",
            relativePath: "src/index.ts",
            changeKind: "symbol-modified",
            confidence: 1,
            evidenceIds: ["evidence:file"],
            limitations: [],
          },
        ],
      }),
      validationStep("performance-check"),
    );
    expect(result.status).toBe("passed");
    expect(result.findings[0]?.severity).toBe("warning");
    expect(result.findings[0]?.description).toContain("not a measured runtime regression");
  });
});

describe("bounded persistence and contracts", () => {
  it("persists and reloads execution state without credential material", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-execution-store-"));
    temporary.push(root);
    const first = new ExecutionPersistenceStore(root);
    await first.initialize();
    const value = executionSession();
    await first.update((state) => ({ ...state, sessions: [value] }));
    const second = new ExecutionPersistenceStore(root);
    await second.initialize();
    expect(second.snapshot.sessions).toEqual([value]);
    expect(JSON.stringify(second.snapshot)).not.toMatch(/ghp_|api[_-]?key|password/i);
  });

  it("rejects unbounded Webview validation inputs", () => {
    expect(() =>
      ValidationPlanPayloadSchema.parse({
        sessionId: IDS.session,
        testMode: "impacted",
        excludedTestEntityIds: Array.from({ length: 501 }, (_, index) => `test:${index}`),
      }),
    ).toThrow();
  });

  it("recovers interrupted execution and validation as blocked, cancelled, and stale", async () => {
    const store = new ExecutionPersistenceStore();
    await store.initialize();
    const interrupted = executionSession({ status: "validating" });
    const run = ValidationRunSchemaV2.parse({
      schemaVersion: 1,
      id: "20000000-0000-4000-8000-000000000020",
      executionSessionId: interrupted.id,
      taskId: interrupted.taskId,
      status: "running",
      startedAt: "2026-07-16T00:00:00.000Z",
      stepResults: [
        {
          stepId: IDS.step,
          status: "failed",
          startedAt: "2026-07-16T00:00:00.000Z",
          completedAt: "2026-07-16T00:00:01.000Z",
          durationMs: 1000,
          outputTail: "partial",
          errorTail: "interrupted",
          outputTruncated: false,
          evidenceIds: [],
          baselineClassification: "unknown",
        },
      ],
      acceptanceCriteriaResults: [],
      findings: [],
      evidence: [],
      summary: {
        requiredStepsPassed: 0,
        requiredStepsFailed: 0,
        criteriaPassed: 0,
        criteriaFailed: 0,
        criteriaRequiringReview: 0,
        newRegressions: 0,
        preExistingFailures: 0,
        unexpectedChanges: 0,
        blockingFindings: 0,
      },
      repositoryGeneration: 1,
      repositoryFingerprint: "before",
      diagnostics: [],
    });
    await store.update((state) => ({
      ...state,
      sessions: [interrupted],
      runs: [run],
    }));
    const statuses: string[] = [];
    const service = new TaskExecutionService(
      store,
      {} as never,
      {
        setTaskStatus: (_workflowId: string, _taskId: string, status: string) => {
          statuses.push(status);
          return Promise.resolve(undefined);
        },
      } as never,
      {} as GitAdapter,
      {} as WorkspaceAdapter,
      { getSnapshot: () => intelligenceSnapshot(1) } as never,
    );
    await service.initialize();
    expect(service.get(interrupted.id)?.status).toBe("blocked");
    expect(service.get(interrupted.id)?.diagnostics.at(-1)?.code).toBe(
      "interrupted-execution-recovered",
    );
    expect(statuses).toEqual(["blocked"]);
    expect(store.snapshot.runs[0]?.status).toBe("cancelled");
    expect(store.snapshot.runs[0]?.stepResults[0]?.status).toBe("stale");
  });

  it("accepts manual evidence only for reviewable criteria and keeps it distinct from overrides", async () => {
    const store = new ExecutionPersistenceStore();
    await store.initialize();
    const reviewRun = ValidationRunSchemaV2.parse({
      schemaVersion: 1,
      id: "20000000-0000-4000-8000-000000000030",
      executionSessionId: IDS.session,
      taskId: IDS.task,
      status: "awaiting-user-review",
      startedAt: "2026-07-16T00:00:00.000Z",
      completedAt: "2026-07-16T00:00:01.000Z",
      stepResults: [],
      acceptanceCriteriaResults: [
        {
          criterionId: "AC-1",
          status: "requires-manual-review",
          stepIds: [],
          evidenceIds: [],
          explanation: "Manual verification required.",
        },
      ],
      findings: [],
      evidence: [],
      summary: {
        requiredStepsPassed: 0,
        requiredStepsFailed: 0,
        criteriaPassed: 0,
        criteriaFailed: 0,
        criteriaRequiringReview: 1,
        newRegressions: 0,
        preExistingFailures: 0,
        unexpectedChanges: 0,
        blockingFindings: 0,
      },
      repositoryGeneration: 1,
      repositoryFingerprint: "fixture",
      diagnostics: [],
    });
    await store.update((state) => ({ ...state, runs: [reviewRun] }));
    const validation = new ValidationOrchestrator(
      store,
      {} as never,
      { getRoots: () => [] } as unknown as WorkspaceAdapter,
      { getSnapshot: () => intelligenceSnapshot(1) } as never,
      {} as never,
    );
    const accepted = await validation.addManualEvidence(
      reviewRun.id,
      "AC-1",
      "Verified the required behavior locally without credentials.",
    );
    expect(accepted.acceptanceCriteriaResults[0]?.status).toBe("passed");
    expect(accepted.evidence[0]?.reliability).toBe("manual");
    expect(store.snapshot.overrides).toEqual([]);
    await store.update((state) => ({
      ...state,
      runs: state.runs.map((run) => ({
        ...run,
        acceptanceCriteriaResults: run.acceptanceCriteriaResults.map((item) => ({
          ...item,
          status: "failed" as const,
        })),
      })),
    }));
    await expect(
      validation.addManualEvidence(reviewRun.id, "AC-1", "Ignore failure."),
    ).rejects.toThrow("cannot replace");
  });
});
