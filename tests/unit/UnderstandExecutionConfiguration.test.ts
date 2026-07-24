import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StageWorkspaceService } from "../../src/core/workflows/StageWorkspaceService";
import { ExecutionConfigurationService } from "../../src/core/development/ExecutionConfigurationService";
import { DevelopmentSkillService } from "../../src/core/development/DevelopmentSkillService";
import type { CanonicalWorkflow } from "../../src/shared/contracts/canonicalWorkflow";
import type { WorkflowService } from "../../src/core/workflow/WorkflowService";
import type { IntelligenceSnapshotReader } from "../../src/core/persistence/IntelligenceStore";
import type { CopilotAdapter } from "../../src/core/copilot/CopilotAdapter";
import type { DevelopmentContextPackageService } from "../../src/core/context/DevelopmentContextPackageService";
import type { StageWorkspacePersistence } from "../../src/core/workflows/StageWorkspaceService";

const capability = { id: "clipboard", kind: "clipboard-handoff" as const, displayName: "Clipboard Handoff", availability: "available" as const, source: "vscode-api" as const };
const instruction = { id: "instruction:a", name: "a.md", workspaceRelativePath: ".github/a.md", uri: "file:///repo/.github/a.md", sourceType: "repository" as const, contentHash: "a".repeat(64), sizeBytes: 20, availability: "available" as const };
const skill = { id: "keystone-development", name: "Development", description: "Implement", applicableStageTypes: ["development" as const], promptFragment: "Implement and list files changed.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in" as const, contentHash: "b".repeat(64), version: 1 };

function execFixture() {
  let stored: unknown; let invalidations = 0;
  const serviceHolder: { current?: ExecutionConfigurationService } = {};
  const service = new ExecutionConfigurationService(
    { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    {
      discoverCapabilities: async () => ({ capabilities: [capability], agents: [], manualAgents: serviceHolder.current?.manualAgents() ?? [], diagnostics: [] }),
      discoverInstructions: async () => ({ sources: [instruction], diagnostics: [] }),
      previewInstruction: async () => ({ ...instruction, content: "Run tests." }),
      listSkills: () => [skill],
      conflicts: () => [],
      invalidatePrompt: async () => { invalidations += 1; },
    },
  );
  serviceHolder.current = service;
  return { service, read: () => stored, invalidations: () => invalidations };
}

function makeWorkflow(): CanonicalWorkflow {
  const stage = (type: "understand" | "investigation" | "plan" | "complete", order: number) => ({
    id: crypto.randomUUID(), type, status: type === "understand" ? "active" : "ready", order,
  });
  const stages = [
    stage("understand", 0),
    stage("investigation", 1),
    stage("plan", 2),
    stage("complete", 3),
  ];
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    intent: { text: "Add a caching layer", workType: "feature" },
    status: "active",
    stages,
    currentStageId: stages[0]!.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as CanonicalWorkflow;
}

function stubWorkflowService(workflow: CanonicalWorkflow): WorkflowService {
  const workflows = new Map<string, CanonicalWorkflow>([[workflow.id, workflow]]);
  return {
    list: async () => [...workflows.values()],
    get: async (id: string) => workflows.get(id),
    getWorkflow: (id: string) => workflows.get(id),
    completeStage: async (workflowId: string, stageId: string) => {
      const current = workflows.get(workflowId);
      const stage = current!.stages.find((item) => item.id === stageId)!;
      const next = current!.stages.filter((item) => item.order > stage.order).sort((a, b) => a.order - b.order)[0];
      const updated: CanonicalWorkflow = {
        ...current!,
        stages: current!.stages.map((item) =>
          item.id === stage.id ? { ...item, status: "completed" as const } : item.id === next?.id ? { ...item, status: "ready" as const } : item,
        ),
        currentStageId: next?.id ?? null,
        status: next ? current!.status : "completed",
        updatedAt: new Date().toISOString(),
      };
      workflows.set(workflowId, updated);
      return updated;
    },
  } as unknown as WorkflowService;
}

function stubIntelligence(): IntelligenceSnapshotReader {
  const snapshot = {
    manifest: { generation: 1 },
    languages: [["TypeScript", 3]] as Array<[string, number]>,
    relationships: [],
    modules: [] as Array<[string, { symbols: number; edges: number; files: number }]>,
    documents: [],
    manifests: [],
    symbols: [],
    files: [{ relativePath: "src/cache.ts" }],
    tests: [],
  };
  return {
    getSnapshot: () => snapshot as unknown as IntelligenceSnapshotReader["getSnapshot"] extends () => infer R ? R : never,
    getStatus: () => ({ status: "ready", generation: 1, files: 5, symbols: 20, relationships: 12, message: "ready" }),
  } as unknown as IntelligenceSnapshotReader;
}

function stubCopilot(): CopilotAdapter {
  return {
    getCapabilities: () => undefined,
    refreshCapabilities: async () => ({ chatAvailable: false, supportedInvocationMethods: ["clipboard-v1"], clipboardAvailable: true }),
    copyPrompt: async () => undefined,
    openCopilot: async () => undefined,
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

function stubReadScopeContent(_path: string): Promise<string> {
  return Promise.resolve("export const cache = new Map();\n");
}

describe("Understand execution configuration (no synthetic work-item identifiers)", () => {
  let service: StageWorkspaceService;
  let workflow: CanonicalWorkflow;
  let exec: ReturnType<typeof execFixture>;
  let mem: { get: () => unknown; set: (v: unknown) => void };

  beforeEach(async () => {
    workflow = makeWorkflow();
    exec = execFixture();
    await exec.service.initialize();
    // Provide a valid manual agent so clipboard/chat modes have a selectable agent.
    await exec.service.createManualAgent({ displayName: "Test Manual Agent", chatCommandId: "workbench.action.chat.open" }, "seed-agent");
    const understandStage = workflow.stages.find((item) => item.type === "understand")!;
    let stored: unknown = {
      schemaVersion: 1,
      revision: 1,
      understand: {
        [understandStage.id]: {
          schemaVersion: 1,
          workflowId: workflow.id,
          stageId: understandStage.id,
          workItemId: crypto.randomUUID(),
          completion: { allowed: false, unmet: [] },
          intelligence: { status: "ready", generation: 1, files: 5, symbols: 20, relationships: 12, message: "ready" },
          configuration: { mode: "clipboard", agentId: "", agentLabel: "", agentAvailable: false, skill: "", instructions: [], capabilities: [], agentOptions: [], manualAgentOptions: [], skillOptions: [], instructionOptions: [], conflicts: [] },
          selectedInstructionIds: [],
          conflictResolutions: [],
          delegations: [],
          analysis: {
            id: crypto.randomUUID(),
            objective: "Understand the caching intent",
            sections: [{ title: "Repository purpose", statement: "A VS Code extension.", confidence: "confirmed", evidence: [] }],
            scope: [{ id: crypto.randomUUID(), kind: "file", reference: "src/cache.ts", label: "src/cache.ts", confidence: "confirmed", included: true }],
            assumptions: [],
            ambiguities: [],
            requiredFacts: ["Relevant files"],
            recommendedNextAction: "Generate context",
            intelligenceRevision: 1,
            contentHash: "x",
            approved: true,
            createdAt: new Date().toISOString(),
          },
          primaryAction: "generate-context",
          updatedAt: new Date().toISOString(),
        },
      },
      investigation: {},
      updatedAt: new Date().toISOString(),
    };
    const persistence: StageWorkspacePersistence = { read: async () => stored, write: async (v) => { stored = v; } };
    mem = { get: () => stored, set: (v) => { stored = v; } };
    service = new StageWorkspaceService(
      persistence,
      stubWorkflowService(workflow),
      stubIntelligence(),
      stubCopilot(),
      undefined,
      exec.service,
      stubContextPackages(),
      stubReadScopeContent,
      new DevelopmentSkillService(),
    );
    await service.initialize();
  });

  afterEach(() => { mem.set(undefined); });

  it("group 1: reuses one persisted UUID across stage, profile, context, prompt, and delegation", async () => {
    const loaded = await service.loadUnderstand(workflow.id);
    const workItemId = loaded.workItemId;
    expect(workItemId).toMatch(/^[0-9a-f-]{36}$/);
    // No synthetic `${stageKind}:${stageId}` identifier is ever produced.
    expect(workItemId).not.toContain(":");

    // Save a profile through the real execution configuration service.
    const saved = await service.setConfiguration(workflow.id, {
      mode: "clipboard",
      skill: "keystone-development",
      agentId: "",
      instructionIds: [instruction.id],
      conflictResolutions: [],
    });
    expect(saved.executionProfileId).toBeDefined();
    expect(saved.executionProfileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.workItemId).toBe(workItemId);

    // Context package uses the same UUID, never a synthetic one.
    const withContext = await service.generateContext(workflow.id);
    expect(withContext.contextPackage?.id).toBeDefined();
    expect(mem.get()).toBeDefined();

    // Reload restores the exact same UUID (webview reload / EDH restart).
    const reloaded = await service.loadUnderstand(workflow.id);
    expect(reloaded.workItemId).toBe(workItemId);
    expect(reloaded.executionProfileId).toBe(saved.executionProfileId);
    expect(reloaded.configuration.skill).toBe("keystone-development");
    expect(reloaded.selectedInstructionIds).toEqual([instruction.id]);

    // Delegation stores the real profile revision (not a hard-coded 0).
    const approved = await service.approveContext(workflow.id, withContext.contextPackage!.id, withContext.contextPackage!.revision);
    const delegated = await service.delegate(workflow.id);
    const record = delegated.delegations[delegated.delegations.length - 1]!;
    expect(record.executionProfileRevision).toBe(saved.executionProfileRevision);
    expect(record.executionProfileRevision).not.toBe(0);
    expect(approved.workItemId).toBe(workItemId);

    // Execution-profile identity must be the real persisted profile ID, never the
    // work-item UUID, and must carry a profile-specific version + content hash.
    expect(saved.executionProfileId).not.toBe(workItemId);
    expect(record.executionProfileId).toBe(saved.executionProfileId);
    expect(record.executionProfileId).not.toBe(workItemId);
    expect(saved.executionProfileRevision).toBeGreaterThan(0);
    expect(saved.executionProfileContentHash).toBeDefined();
    expect(record.executionProfileContentHash).toBe(saved.executionProfileContentHash);
    expect(withContext.contextPackage?.executionProfileId).toBe(saved.executionProfileId);
    expect(withContext.contextPackage?.executionProfileRevision).toBe(saved.executionProfileRevision);
    expect(approved.prompt?.executionProfileId).toBe(saved.executionProfileId);
  });

  it("group 2: persists agent, skill, instruction, and conflict selections", async () => {
    const saved = await service.setConfiguration(workflow.id, {
      mode: "clipboard",
      skill: "keystone-development",
      agentId: "",
      instructionIds: [instruction.id],
      conflictResolutions: [{ conflictId: "c1", resolution: "win-first" }],
    });
    expect(saved.configuration.skill).toBe("keystone-development");
    expect(saved.selectedInstructionIds).toEqual([instruction.id]);
    expect(saved.conflictResolutions).toEqual([{ conflictId: "c1", resolution: "win-first" }]);

    const reloaded = await service.loadUnderstand(workflow.id);
    expect(reloaded.configuration.skill).toBe("keystone-development");
    expect(reloaded.selectedInstructionIds).toEqual([instruction.id]);
    expect(reloaded.conflictResolutions).toEqual([{ conflictId: "c1", resolution: "win-first" }]);

    // An invalid skill does NOT fall back to the first skill; it blocks saving.
    await expect(service.setConfiguration(workflow.id, {
      mode: "clipboard",
      skill: "does-not-exist",
      agentId: "",
      instructionIds: [],
      conflictResolutions: [],
    })).rejects.toThrow(/valid Keystone skill/);
  });

  it("group 3: a configuration change invalidates only the correct context and prompt", async () => {
    await service.setConfiguration(workflow.id, {
      mode: "clipboard",
      skill: "keystone-development",
      agentId: "",
      instructionIds: [instruction.id],
      conflictResolutions: [],
    });
    const withContext = await service.generateContext(workflow.id);
    await service.approveContext(workflow.id, withContext.contextPackage!.id, withContext.contextPackage!.revision);
    const before = await service.loadUnderstand(workflow.id);
    expect(before.contextPackage?.status).toBe("approved");

    // Changing the skill selection invalidates the approved context + prepared prompt.
    const after = await service.setConfiguration(workflow.id, {
      mode: "clipboard",
      skill: "keystone-development",
      agentId: "",
      instructionIds: [],
      conflictResolutions: [],
    });
    expect(after.contextPackage?.status).toBe("stale");
    expect(after.prompt).toBeUndefined();

    // The persisted UUID is unchanged by the invalidation.
    expect(after.workItemId).toBe(before.workItemId);
  });
});

// Conflict-resolution effectiveness, combined agent auto-selection, and
// profile-specific staleness. Needs a fixture that reports conflicting
// instructions and a blocking conflict between them.
describe("Understand execution configuration — conflicts, agents, and profile freshness", () => {
  let workflow: CanonicalWorkflow;
  let exec: ReturnType<typeof conflictFixture>;
  let mem: { get: () => unknown; set: (v: unknown) => void };
  let stored: unknown;
  let service: StageWorkspaceService;

  const instrA = { id: "instruction:a", name: "a.md", workspaceRelativePath: ".github/a.md", uri: "file:///repo/.github/a.md", sourceType: "repository" as const, contentHash: "a".repeat(64), sizeBytes: 20, availability: "available" as const };
  const instrB = { id: "instruction:b", name: "b.md", workspaceRelativePath: ".github/b.md", uri: "file:///repo/.github/b.md", sourceType: "repository" as const, contentHash: "b".repeat(64), sizeBytes: 20, availability: "available" as const };
  const conflictingSkill = { id: "keystone-development", name: "Development", description: "Implement", applicableStageTypes: ["development"], promptFragment: "Implement and list files changed.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in" as const, contentHash: "c".repeat(64).toString().slice(0, 64), version: 1 };

  function conflictFixture() {
    let persistence: unknown; let invalidations = 0;
    const serviceHolder: { current?: ExecutionConfigurationService } = {};
    const service = new ExecutionConfigurationService(
      { read: async () => persistence, write: async (value) => { persistence = structuredClone(value); } },
      {
        discoverCapabilities: async () => ({ capabilities: [capability], agents: [], manualAgents: serviceHolder.current?.manualAgents() ?? [], diagnostics: [] }),
        discoverInstructions: async () => ({ sources: [instrA, instrB], diagnostics: [] }),
        previewInstruction: async (path: string) => {
          const source = path.endsWith("a.md") ? instrA : instrB;
          return { ...source, content: path.endsWith("a.md") ? "Require tests." : "Forbid tests." };
        },
        listSkills: () => [conflictingSkill],
        conflicts: (items: Array<{ id: string; workspaceRelativePath: string; content: string }>) =>
          items.length === 2
            ? [{ id: "conflict:x", category: "test-requirement", state: "conflict", severity: "error", confidence: "deterministic", instructionIds: [instrA.id, instrB.id], sourcePaths: [instrA.workspaceRelativePath, instrB.workspaceRelativePath], evidence: ["conflicting test policy"], recommendedResolution: "Exclude one instruction." }]
            : [],
        invalidatePrompt: async () => { invalidations += 1; },
      },
    );
    serviceHolder.current = service;
    return { service, read: () => persistence, invalidations: () => invalidations };
  }

  beforeEach(async () => {
    workflow = makeWorkflow();
    exec = conflictFixture();
    await exec.service.initialize();
    await exec.service.createManualAgent({ displayName: "Conflicting Manual Agent", chatCommandId: "workbench.action.chat.open" }, "seed-agent-2");
    const understandStage = workflow.stages.find((item) => item.type === "understand")!;
    stored = {
      schemaVersion: 1,
      revision: 1,
      understand: {
        [understandStage.id]: {
          schemaVersion: 1,
          workflowId: workflow.id,
          stageId: understandStage.id,
          workItemId: crypto.randomUUID(),
          completion: { allowed: false, unmet: [] },
          intelligence: { status: "ready", generation: 1, files: 5, symbols: 20, relationships: 12, message: "ready" },
          configuration: { mode: "clipboard", agentId: "", agentLabel: "", agentAvailable: false, skill: "", instructions: [], capabilities: [], agentOptions: [], manualAgentOptions: [], skillOptions: [], instructionOptions: [], conflicts: [] },
          selectedInstructionIds: [],
          conflictResolutions: [],
          delegations: [],
          analysis: {
            id: crypto.randomUUID(),
            objective: "Understand the caching intent",
            sections: [{ title: "Repository purpose", statement: "A VS Code extension.", confidence: "confirmed", evidence: [] }],
            scope: [{ id: crypto.randomUUID(), kind: "file", reference: "src/cache.ts", label: "src/cache.ts", confidence: "confirmed", included: true }],
            assumptions: [], ambiguities: [], requiredFacts: ["Relevant files"], recommendedNextAction: "Generate context", intelligenceRevision: 1, contentHash: "x", approved: true, createdAt: new Date().toISOString(),
          },
          primaryAction: "generate-context",
          updatedAt: new Date().toISOString(),
        },
      },
      investigation: {},
      updatedAt: new Date().toISOString(),
    };
    mem = { get: () => stored, set: (v) => { stored = v; } };
    service = new StageWorkspaceService(
      { read: async () => stored, write: async (v) => { stored = v; } },
      stubWorkflowService(workflow),
      stubIntelligence(),
      stubCopilot(),
      undefined,
      exec.service,
      stubContextPackages(),
      stubReadScopeContent,
      new DevelopmentSkillService(),
    );
    await service.initialize();
  });

  afterEach(() => { mem.set(undefined); });

  it("resolves a blocking conflict and persists effective instruction selection", async () => {
    // A blocking conflict with no resolution is rejected by the centralized gate.
    await expect(service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id, instrB.id], conflictResolutions: [],
    })).rejects.toThrow(/Resolve blocking instruction conflicts/);

    // exclude-first removes instruction A from the effective set.
    const excluded = await service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id, instrB.id], conflictResolutions: [{ conflictId: "conflict:x", resolution: "exclude-first" }],
    });
    expect(excluded.executionProfileId).toBeDefined();
    expect(excluded.selectedInstructionIds).toEqual([instrA.id, instrB.id]);
    const aggregate = await exec.service.load(workflow.id, excluded.workItemId);
    expect(aggregate.profile?.instructionIds).toEqual([instrB.id]);

    // Re-selecting via a winner keeps only the winning instruction.
    const winner = await service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id, instrB.id], conflictResolutions: [{ conflictId: "conflict:x", resolution: "win-first" }],
    });
    const winnerAggregate = await exec.service.load(workflow.id, winner.workItemId);
    expect(winnerAggregate.profile?.instructionIds).toEqual([instrA.id]);

    // acknowledge can never bypass a blocking conflict.
    await expect(service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id, instrB.id], conflictResolutions: [{ conflictId: "conflict:x", resolution: "acknowledge" }],
    })).rejects.toThrow(/cannot be resolved by acknowledgment/);
  });

  it("auto-selects a combined agent only when exactly one valid option exists", async () => {
    const loaded = await service.loadUnderstand(workflow.id);
    // The single seeded manual agent should have been auto-selected.
    expect(loaded.configuration.agentId).toBeTruthy();

    // With two manual agents present, no auto-selection occurs and saving is blocked.
    const multiExec = conflictFixture();
    await multiExec.service.initialize();
    await multiExec.service.createManualAgent({ displayName: "Agent 1", chatCommandId: "workbench.action.chat.open" }, "a1");
    await multiExec.service.createManualAgent({ displayName: "Agent 2", chatCommandId: "workbench.action.chat.open" }, "a2");
    let multiStored: unknown = structuredClone(stored);
    const multiService = new StageWorkspaceService(
      { read: async () => multiStored, write: async (v) => { multiStored = v; } },
      stubWorkflowService(workflow),
      stubIntelligence(),
      stubCopilot(),
      undefined,
      multiExec.service,
      stubContextPackages(),
      stubReadScopeContent,
      new DevelopmentSkillService(),
    );
    await multiService.initialize();
    await expect(multiService.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id], conflictResolutions: [],
    })).rejects.toThrow(/execution agent is required/);
  });

  it("rejects stale profile on context generation and delegation after a profile change", async () => {
    const saved = await service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id], conflictResolutions: [],
    });
    const withContext = await service.generateContext(workflow.id);
    expect(withContext.contextPackage?.executionProfileId).toBe(saved.executionProfileId);

    // An unrelated profile change (a different work item) must NOT stale this stage.
    await exec.service.saveProfile({ workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), executionCapabilityId: capability.id, skillId: conflictingSkill.id, instructionIds: [instrA.id] }, "other-wf");
    const stillFresh = await service.generateContext(workflow.id);
    expect(stillFresh.contextPackage?.status).not.toBe("stale");

    // Changing THIS profile (new instruction) must stale the context and block regeneration
    // and delegation until the configuration is re-saved.
    const workItemId = (await service.loadUnderstand(workflow.id)).workItemId;
    await exec.service.saveProfile({ workflowId: workflow.id, workItemId, executionCapabilityId: capability.id, skillId: conflictingSkill.id, instructionIds: [instrB.id] }, "resave-current");
    await expect(service.generateContext(workflow.id)).rejects.toThrow(/execution profile changed/i);
    await expect(service.delegate(workflow.id)).rejects.toThrow(/execution profile changed/i);
  });
});

// Regression: no execution-profile fallbacks remain. The real persisted profile id
// must be used (never the work-item id), and a missing profile must fail with
// EXECUTION_PROFILE_REQUIRED rather than being silently substituted.
describe("Understand execution configuration — no profile fallbacks", () => {
  let workflow: CanonicalWorkflow;
  let exec: { service: ExecutionConfigurationService; read: () => unknown; invalidations: () => number };
  let stored: unknown;
  let mem: { get: () => unknown; set: (v: unknown) => void };
  let service: StageWorkspaceService;

  const instrA = { id: "instruction:a", name: "a.md", workspaceRelativePath: ".github/a.md", uri: "file:///repo/.github/a.md", sourceType: "repository" as const, contentHash: "a".repeat(64), sizeBytes: 20, availability: "available" as const };
  const instrB = { id: "instruction:b", name: "b.md", workspaceRelativePath: ".github/b.md", uri: "file:///repo/.github/b.md", sourceType: "repository" as const, contentHash: "b".repeat(64), sizeBytes: 20, availability: "available" as const };
  const fallbackSkill = { id: "keystone-development", name: "Development", description: "Implement", applicableStageTypes: ["development"], promptFragment: "Implement and list files changed.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in" as const, contentHash: "c".repeat(64).toString().slice(0, 64), version: 1 };

  function localConflictFixture() {
    let persistence: unknown; let invalidations = 0;
    const serviceHolder: { current?: ExecutionConfigurationService } = {};
    const svc = new ExecutionConfigurationService(
      { read: async () => persistence, write: async (value) => { persistence = structuredClone(value); } },
      {
        discoverCapabilities: async () => ({ capabilities: [capability], agents: [], manualAgents: serviceHolder.current?.manualAgents() ?? [], diagnostics: [] }),
        discoverInstructions: async () => ({ sources: [instrA, instrB], diagnostics: [] }),
        previewInstruction: async (path: string) => {
          const source = path.endsWith("a.md") ? instrA : instrB;
          return { ...source, content: path.endsWith("a.md") ? "Require tests." : "Forbid tests." };
        },
        listSkills: () => [fallbackSkill],
        conflicts: () => [],
        invalidatePrompt: async () => { invalidations += 1; },
      },
    );
    serviceHolder.current = svc;
    return { service: svc, read: () => persistence, invalidations: () => invalidations };
  }

  beforeEach(async () => {
    workflow = makeWorkflow();
    exec = localConflictFixture();
    await exec.service.initialize();
    await exec.service.createManualAgent({ displayName: "Conflicting Manual Agent", chatCommandId: "workbench.action.chat.open" }, "seed-agent-2");
    const understandStage = workflow.stages.find((item) => item.type === "understand")!;
    stored = {
      schemaVersion: 1,
      revision: 1,
      understand: {
        [understandStage.id]: {
          schemaVersion: 1,
          workflowId: workflow.id,
          stageId: understandStage.id,
          workItemId: crypto.randomUUID(),
          completion: { allowed: false, unmet: [] },
          intelligence: { status: "ready", generation: 1, files: 5, symbols: 20, relationships: 12, message: "ready" },
          configuration: { mode: "clipboard", agentId: "", agentLabel: "", agentAvailable: false, skill: "", instructions: [], capabilities: [], agentOptions: [], manualAgentOptions: [], skillOptions: [], instructionOptions: [], conflicts: [] },
          selectedInstructionIds: [],
          conflictResolutions: [],
          delegations: [],
          analysis: {
            id: crypto.randomUUID(),
            objective: "Understand the caching intent",
            sections: [{ title: "Repository purpose", statement: "A VS Code extension.", confidence: "confirmed", evidence: [] }],
            scope: [{ id: crypto.randomUUID(), kind: "file", reference: "src/cache.ts", label: "src/cache.ts", confidence: "confirmed", included: true }],
            assumptions: [], ambiguities: [], requiredFacts: ["Relevant files"], recommendedNextAction: "Generate context", intelligenceRevision: 1, contentHash: "x", approved: true, createdAt: new Date().toISOString(),
          },
          primaryAction: "generate-context",
          updatedAt: new Date().toISOString(),
        },
      },
      investigation: {},
      updatedAt: new Date().toISOString(),
    };
    mem = { get: () => stored, set: (v) => { stored = v; } };
    service = new StageWorkspaceService(
      { read: async () => stored, write: async (v) => { stored = v; } },
      stubWorkflowService(workflow),
      stubIntelligence(),
      stubCopilot(),
      undefined,
      exec.service,
      stubContextPackages(),
      stubReadScopeContent,
      new DevelopmentSkillService(),
    );
    await service.initialize();
  });

  afterEach(() => { mem.set(undefined); });

  it("throws EXECUTION_PROFILE_REQUIRED instead of substituting the work-item id", async () => {
    // No profile was saved for this stage, so executionProfileId is undefined.
    const state = await service.loadUnderstand(workflow.id);
    expect(state.executionProfileId).toBeUndefined();
    // Generating context must fail loudly — it must NOT fall back to workItemId.
    await expect(service.generateContext(workflow.id))
      .rejects.toThrow(/EXECUTION_PROFILE_REQUIRED|Save a valid execution profile/);
    // The persisted state must never record the work-item id as a profile id.
    const after = await service.loadUnderstand(workflow.id);
    expect(after.executionProfileId).toBeUndefined();
    expect(after.workItemId).not.toBe(after.executionProfileId);
  });

  it("uses the profile-specific revision exclusively (no global service revision fallback)", async () => {
    const saved = await service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrA.id], conflictResolutions: [],
    });
    // The persisted profile carries its own revision; the stage records exactly that.
    const aggregate = await exec.service.load(workflow.id, saved.workItemId);
    expect(aggregate.profile?.revision).toBe(saved.executionProfileRevision);
    expect(saved.executionProfileRevision).toBeGreaterThan(0);
    // Re-saving bumps the profile-specific revision; the stage tracks the new one.
    const resaved = await service.setConfiguration(workflow.id, {
      mode: "clipboard", skill: "keystone-development", agentId: "", instructionIds: [instrB.id], conflictResolutions: [{ conflictId: "conflict:x", resolution: "win-first" }],
    });
    expect(resaved.executionProfileRevision).toBe((aggregate.profile?.revision ?? 0) + 1);
    const resavedAggregate = await exec.service.load(workflow.id, resaved.workItemId);
    expect(resaved.executionProfileRevision).toBe(resavedAggregate.profile?.revision);
  });
});
