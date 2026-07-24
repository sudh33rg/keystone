import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  StageWorkspaceService,
  type StageWorkspacePersistence,
} from "../../src/core/workflows/StageWorkspaceService";
import type { WorkflowService } from "../../src/core/workflow/WorkflowService";
import type { IntelligenceSnapshotReader } from "../../src/core/persistence/IntelligenceStore";
import type { IntelligenceSnapshot } from "../../src/shared/contracts/intelligence";
import { IntelligenceSnapshotSchema } from "../../src/shared/contracts/intelligence";
import type { CopilotAdapter } from "../../src/core/copilot/CopilotAdapter";
import type { DevelopmentContextPackageService } from "../../src/core/context/DevelopmentContextPackageService";
import { DevelopmentSkillService } from "../../src/core/development/DevelopmentSkillService";
import { CanonicalWorkflowSchema, type CanonicalWorkflow } from "../../src/shared/contracts/canonicalWorkflow";
import { STAGE_WORKSPACE_SCHEMA_VERSION, type StageWorkspacePersistentState } from "../../src/shared/contracts/stageWorkspace";

function makeWorkflow(): CanonicalWorkflow {
  return CanonicalWorkflowSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    intent: { text: "Add a caching layer for repository queries", workType: "feature" },
    status: "active",
    stages: [
      { id: randomUUID(), type: "understand", displayName: "Understand", order: 1, status: "completed", required: true },
      { id: randomUUID(), type: "plan", displayName: "Plan", order: 2, status: "ready", required: true },
      { id: randomUUID(), type: "development", displayName: "Development", order: 3, status: "not-ready", required: true },
      { id: randomUUID(), type: "impact-analysis", displayName: "Impact Analysis", order: 4, status: "not-ready", required: true },
      { id: randomUUID(), type: "qa", displayName: "QA", order: 5, status: "not-ready", required: true },
      { id: randomUUID(), type: "pr-review", displayName: "PR Review", order: 6, status: "not-ready", required: true },
    ],
    currentStageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function inMemoryPersistence(): { persistence: StageWorkspacePersistence; get: () => unknown; set: (v: unknown) => void } {
  let value: unknown;
  const persistence: StageWorkspacePersistence = {
    read: async () => value,
    write: async (v) => {
      value = v;
    },
  };
  return { persistence, get: () => value, set: (v) => { value = v; } };
}

function stubWorkflowService(workflow: CanonicalWorkflow): WorkflowService {
  const workflows = new Map<string, CanonicalWorkflow>([[workflow.id, workflow]]);
  return {
    list: async () => [...workflows.values()],
    get: async (id: string) => workflows.get(id),
    getWorkflow: (id: string) => workflows.get(id),
    completeStage: async (workflowId: string, stageId: string) => {
      const current = workflows.get(workflowId);
      if (!current) throw new Error("WORKFLOW_NOT_FOUND");
      const stage = current.stages.find((item) => item.id === stageId);
      if (!stage) throw new Error("STAGE_NOT_FOUND");
      const next = current.stages.filter((item) => item.order > stage.order).sort((a, b) => a.order - b.order)[0];
      const updated: CanonicalWorkflow = {
        ...current,
        stages: current.stages.map((item) =>
          item.id === stage.id ? { ...item, status: "completed" as const } : item.id === next?.id ? { ...item, status: "ready" as const } : item,
        ),
        currentStageId: next?.id ?? null,
        status: next ? current.status : "completed",
        updatedAt: new Date().toISOString(),
      };
      workflows.set(workflowId, updated);
      return updated;
    },
  } as unknown as WorkflowService;
}

function stubIntelligence(): IntelligenceSnapshotReader {
  return {
    getSnapshot: () => undefined,
    getStatus: () => ({ status: "unavailable", generation: 0, files: 0, symbols: 0, relationships: 0, message: "no snapshot" }),
  } as unknown as IntelligenceSnapshotReader;
}

function stubCopilot(): CopilotAdapter {
  return {
    getCapabilities: () => undefined,
    refreshCapabilities: async () => ({ chatAvailable: false, supportedInvocationMethods: ["clipboard-v1"], clipboardAvailable: true }),
  } as unknown as CopilotAdapter;
}

function stubContextPackages(): DevelopmentContextPackageService {
  return {
    invalidate: async () => undefined,
    build: async () => ({
      metadata: { status: "complete" },
      sections: [],
      rawBaseline: { tokenCount: 10 },
      compressed: { tokenCount: 8, reductionPercentage: 20 },
      requiredFacts: [{ description: "scope", state: "satisfied" }],
      items: [],
      exclusions: [],
      metrics: { tokenizerMeasurement: "estimated" },
    }),
  } as unknown as DevelopmentContextPackageService;
}

function stubReadScopeContent(): (path: string, range?: { startLine: number; endLine: number }) => Promise<string> {
  return async () => "export const cache = new Map();\n";
}

/** Seed an already-approved Understand scope so the Plan stage can generate context. */
function seedUnderstand(workflow: CanonicalWorkflow): StageWorkspacePersistentState {
  const understandStage = workflow.stages.find((item) => item.type === "understand")!;
  return {
    schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION,
    revision: 1,
    understand: {
      [understandStage.id]: {
        schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION,
        workflowId: workflow.id,
        stageId: understandStage.id,
        intelligence: { status: "ready", generation: 1, files: 5, symbols: 20, relationships: 12, message: "ready" },
        configuration: { mode: "clipboard", agentId: "", agentLabel: "", agentAvailable: false, skill: "", instructions: [], capabilities: [] },
        delegations: [],
        analysis: {
          id: randomUUID(),
          objective: "Understand the caching intent",
          sections: [{ title: "Repository purpose", statement: "A VS Code extension.", confidence: "confirmed", evidence: [] }],
          scope: [{ id: randomUUID(), kind: "file", reference: "src/cache.ts", label: "src/cache.ts", confidence: "confirmed", included: true }],
          assumptions: [],
          ambiguities: [],
          requiredFacts: ["Relevant files"],
          recommendedNextAction: "Generate context",
          intelligenceRevision: 1,
          contentHash: "x",
          approved: true,
          createdAt: new Date().toISOString(),
        },
        contextPackage: undefined,
        prompt: undefined,
        result: undefined,
        validation: undefined,
        primaryAction: "stage-completed",
        completion: { allowed: true, unmet: [] },
        updatedAt: new Date().toISOString(),
      },
    },
    investigation: {},
    updatedAt: new Date().toISOString(),
  };
}

describe("StageWorkspaceService Plan stage", () => {
  let service: StageWorkspaceService;
  let workflow: CanonicalWorkflow;
  let mem: ReturnType<typeof inMemoryPersistence>;

  beforeEach(async () => {
    workflow = makeWorkflow();
    mem = inMemoryPersistence();
    mem.set(seedUnderstand(workflow));
    service = new StageWorkspaceService(
      mem.persistence,
      stubWorkflowService(workflow),
      stubIntelligence(),
      stubCopilot(),
      undefined,
      undefined,
      stubContextPackages(),
      stubReadScopeContent(),
      new DevelopmentSkillService(),
    );
    await service.initialize();
  });

  it("loads a plan state for a feature workflow", async () => {
    const plan = await service.loadPlan(workflow.id);
    expect(plan.workflowId).toBe(workflow.id);
    expect(plan.primaryAction).toBe("generate-context" as const);
    expect(plan.completion).toBeDefined();
    expect(mem.get() as StageWorkspacePersistentState).toBeDefined();
  });

  it("completing the plan stage marks Development ready (feature -> development)", async () => {
    await service.setPlanConfiguration(workflow.id, { mode: "clipboard" });
    const plan = await service.generatePlanContext(workflow.id);
    await service.approvePlanContext(workflow.id, plan.contextPackage!.id, plan.contextPackage!.revision);
    await service.delegatePlan(workflow.id);
    await service.capturePlan(workflow.id, { planResult: "Add a cache module around repository queries.", tasks: [{ id: "t1", title: "Add cache module", detail: "Create src/cache.ts", dependencies: [], affectedAreas: [], acceptanceCriteria: [], evidence: [] }] });
    await service.approvePlan(workflow.id);
    const { workflow: completed } = await service.completePlan(workflow.id);
    const development = completed.stages.find((item) => item.type === "development");
    expect(development?.status).toBe("ready");
    expect(completed.status).toBe("active");
  });

  it("blocks completion until context is approved, a result is captured, and a task exists", async () => {
    await service.setPlanConfiguration(workflow.id, { mode: "clipboard" });
    await service.generatePlanContext(workflow.id);
    // Before any approval/capture, completion must be blocked.
    await expect(service.completePlan(workflow.id)).rejects.toThrow(/cannot complete yet/);
    // capturePlan rejects an empty result.
    await expect(service.capturePlan(workflow.id, { planResult: "   " })).rejects.toThrow(/captured plan is required/);
  });
});

// ── Intelligence-backed Understand + capability-discovery groups ──────────────

function evidence(id: string, subjectId: string): unknown {
  return {
    id,
    subjectId,
    sourceKind: "source-file",
    workspaceRootId: "root-1",
    relativePath: "src/x.ts",
    extractorId: "ext",
    extractorVersion: "1",
    derivation: "extracted",
    generation: 1,
    confidence: 1,
    statement: "evidence",
  };
}

function makeSnapshot(): IntelligenceSnapshot {
  const repoId = "repo-1";
  const readme = { id: "f-readme", repositoryId: repoId, workspaceRootId: "root-1", relativePath: "README.md", language: "markdown", category: "documentation", analysisLevel: "metadata-only", byteSize: 100, modifiedAt: new Date().toISOString(), classification: { category: "documentation", analysisLevel: "metadata-only", included: true, generated: true, binary: false, sensitive: false, ruleId: "r", reason: "doc" }, evidenceIds: ["e-readme"], generation: 1 };
  const entry = { id: "f-entry", repositoryId: repoId, workspaceRootId: "root-1", relativePath: "src/extension.ts", language: "typescript", category: "source", analysisLevel: "deep", byteSize: 100, modifiedAt: new Date().toISOString(), classification: { category: "source", analysisLevel: "deep", included: true, generated: true, binary: false, sensitive: false, ruleId: "r", reason: "src" }, evidenceIds: ["e-entry"], generation: 1 };
  const sym = { id: "s-activate", repositoryId: repoId, fileId: "f-entry", type: "function", name: "activate", qualifiedName: "extension.activate", language: "typescript", range: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 }, exported: true, evidenceIds: ["e-sym"], confidence: 1, generation: 1, ownerFileId: "f-entry" };
  const rel = { id: "r-1", repositoryId: repoId, sourceId: "f-readme", targetId: "s-activate", type: "imports", ownerFileId: "f-readme", targetFileId: "f-entry", resolution: "exact", evidenceIds: ["e-rel"], derivation: "extracted", confidence: 1, generation: 1 };
  return IntelligenceSnapshotSchema.parse({
    manifest: { schemaVersion: 1, generation: 1, scanRevision: 1, repositoryId: repoId, status: "ready", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), extractorVersions: {} },
    repository: { id: repoId, displayName: "repo", workspaceRoots: [{ id: "root-1", name: "root", evidenceIds: ["e-root"] }], evidenceIds: ["e-repo"] },
    files: [readme, entry],
    symbols: [sym],
    relationships: [rel],
    evidence: [
      evidence("e-repo", repoId),
      evidence("e-root", "root-1"),
      evidence("e-readme", "f-readme"),
      evidence("e-entry", "f-entry"),
      evidence("e-sym", "s-activate"),
      evidence("e-rel", "r-1"),
    ],
    diagnostics: [],
  });
}

function snapshotIntelligence(snapshot: IntelligenceSnapshot): IntelligenceSnapshotReader {
  return {
    getSnapshot: () => snapshot,
    getStatus: () => ({ status: "ready", generation: snapshot.manifest.generation, files: snapshot.files.length, symbols: snapshot.symbols.length, relationships: snapshot.relationships.length, message: "ready" }),
  } as unknown as IntelligenceSnapshotReader;
}

function readmeContent(): string {
  return "# Keystone\n\nKeystone is a deterministic VS Code extension.\n\nIt builds a local intelligence graph.\n";
}

describe("StageWorkspaceService Understand evidence depth", () => {
  it("reads a real documentation excerpt and resolves entry points from fan-in", async () => {
    const workflow = makeWorkflow();
    const mem = inMemoryPersistence();
    const service = new StageWorkspaceService(
      mem.persistence,
      stubWorkflowService(workflow),
      snapshotIntelligence(makeSnapshot()),
      stubCopilot(),
      undefined,
      undefined,
      stubContextPackages(),
      async () => readmeContent(),
      new DevelopmentSkillService(),
    );
    await service.initialize();
    const understand = await service.analyzeIntent(workflow.id);
    const purpose = understand.analysis!.sections.find((item) => item.title === "Repository purpose");
    expect(purpose?.statement).toContain("Keystone is a deterministic VS Code extension");
    const entryPoints = understand.analysis!.sections.find((item) => item.title === "Entry points");
    expect(entryPoints?.statement).toContain("extension.activate");
  });
});

describe("StageWorkspaceService capability discovery notice", () => {
  it("surfaces a truthful discovery notice when capability refresh fails", async () => {
    const workflow = makeWorkflow();
    const mem = inMemoryPersistence();
    const failingCopilot = {
      getCapabilities: () => undefined,
      refreshCapabilities: async () => { throw new Error("Copilot host unavailable"); },
    } as unknown as CopilotAdapter;
    const service = new StageWorkspaceService(
      mem.persistence,
      stubWorkflowService(workflow),
      stubIntelligence(),
      failingCopilot,
      undefined,
      undefined,
      stubContextPackages(),
      async () => "",
      new DevelopmentSkillService(),
    );
    await service.initialize();
    const understand = await service.loadUnderstand(workflow.id);
    expect(understand.configuration.discoveryNotice).toContain("Copilot capability discovery failed");
  });
});
