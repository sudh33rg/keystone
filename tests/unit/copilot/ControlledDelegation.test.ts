import { describe, expect, it, vi } from "vitest";
import { AgentProfileService, AgentRecommendationService, AgentSelectionService, CopilotAgentDiscoveryService } from "../../../src/core/copilot/AgentRegistry";
import { CapabilityDrivenCopilotAdapter, CopilotCapabilityDetector, type CopilotEnvironment } from "../../../src/core/copilot/CopilotAdapter";
import { DelegationFallbackService, DelegationPromptBuilder, TaskEligibilityService } from "../../../src/core/copilot/DelegationService";
import {
  ContextBudgetSchema,
  CopilotAgentDescriptorSchema,
  DevelopmentIntentSchema,
  DevelopmentSpecificationSchema,
  DevelopmentTaskSchema,
  DevelopmentWorkflowSnapshotSchema,
  TaskContextPackageSchema,
  type CopilotAgentDescriptor
} from "../../../src/shared/contracts/delegation";

const IDS = {
  workflow: "10000000-0000-4000-8000-000000000001",
  intent: "10000000-0000-4000-8000-000000000002",
  specification: "10000000-0000-4000-8000-000000000003",
  task: "10000000-0000-4000-8000-000000000004",
  context: "10000000-0000-4000-8000-000000000005"
};
const NOW = "2026-07-16T10:00:00.000Z";

function environment(overrides: Partial<CopilotEnvironment> = {}): CopilotEnvironment {
  return {
    listExtensions: () => Promise.resolve([]),
    listCommands: () => Promise.resolve([]),
    integrationMethods: () => Promise.resolve([]),
    executeAllowedCommand: () => Promise.resolve(),
    writeClipboard: () => Promise.resolve(),
    ...overrides
  };
}

function agent(overrides: Partial<CopilotAgentDescriptor> = {}): CopilotAgentDescriptor {
  return CopilotAgentDescriptorSchema.parse({
    id: "agent.implementation",
    displayName: "Implementation agent",
    source: "copilot-discovered",
    availability: "available",
    capabilities: ["implementation", "testing"],
    taskCategories: ["feature"],
    invocationMethod: "supported-direct",
    restrictions: [],
    confidence: 1,
    evidence: [{ kind: "runtime", source: "fixture", statement: "Returned by a supported discovery contract." }],
    ...overrides
  });
}

function task() {
  return DevelopmentTaskSchema.parse({
    id: IDS.task, workflowId: IDS.workflow, specificationId: IDS.specification, specificationRevision: 1,
    title: "Implement REQ-1", objective: "Add bounded delegation", description: "Implement the approved behavior.", category: "feature", status: "ready",
    dependencies: [], requirementIds: ["REQ-1"], acceptanceCriterionIds: ["AC-1"], expectedFiles: ["src/feature.ts"], expectedEntityIds: ["symbol:feature"],
    validationSteps: [{ command: "npm test" }], assignedAgentId: "agent.implementation", requiredCapabilities: ["implementation", "testing"], staleReasons: [],
    baseEntityFingerprints: { "file:src/feature.ts": "sha256:base" }, createdAt: NOW, updatedAt: NOW
  });
}

function specification() {
  return DevelopmentSpecificationSchema.parse({
    id: IDS.specification, workflowId: IDS.workflow, revision: 1, status: "approved", title: "Bounded delegation", repositoryId: "repo", branch: "main", baseCommit: "abc", intelligenceGeneration: 7,
    objective: "Add bounded delegation", scope: { included: ["delegation"], excluded: ["validation"], expectedFiles: ["src/feature.ts"], entityIds: ["symbol:feature"] },
    requirements: [{ id: "REQ-1", description: "Delegate only approved work." }], constraints: ["Do not modify unrelated files."],
    acceptanceCriteria: [{ id: "AC-1", description: "Approval gates execution.", required: true, requirementIds: ["REQ-1"], validationMethod: "npm test", expectedEvidence: "passing output", coveringTaskIds: [IDS.task] }],
    testStrategy: { existingTests: [], requiredTests: ["approval gate"], validationCommands: ["npm test"], manualScenarios: [], risks: [] }, decisions: [], evidence: [],
    approval: { approvedAt: NOW, approvedBy: "user", revision: 1 }, createdAt: NOW, updatedAt: NOW
  });
}

function context(reviewed = true) {
  return TaskContextPackageSchema.parse({
    schemaVersion: 1, id: IDS.context, taskId: IDS.task, specificationId: IDS.specification, specificationRevision: 1, repositoryId: "repo", branch: "main", baseCommit: "abc", intelligenceGeneration: 7,
    selectedAgentId: "agent.implementation", objective: "Add bounded delegation", requirements: ["Delegate only approved work."], acceptanceCriteria: ["Approval gates execution."], constraints: ["Do not modify unrelated files."],
    items: [], exclusions: [], budget: ContextBudgetSchema.parse({}), estimatedTokens: 0, estimatedCharacters: 0, completeness: "complete", diagnostics: [], reviewed, createdAt: NOW,
    contentFingerprint: "sha256:context", sourceFingerprint: "sha256:source", metrics: { buildDurationMs: 1, candidateCount: 0, includedCount: 0, excludedCount: 0, compressionRatioEstimate: 0, cacheReuse: false }
  });
}

function workflow() {
  const spec = specification(); const developmentTask = task();
  const intent = DevelopmentIntentSchema.parse({ id: IDS.intent, workflowId: IDS.workflow, revision: 1, originalText: "Add bounded delegation", normalizedObjective: "Add bounded delegation", mode: "spec-driven", category: "feature", expectedOutcome: "Bounded delegation", risk: "medium", constraints: [], ambiguities: [], requiredDecisions: [], affectedEntities: [], intelligenceGeneration: 7, branch: "main", createdAt: NOW });
  return DevelopmentWorkflowSnapshotSchema.parse({ schemaVersion: 1, id: IDS.workflow, revision: 1, repositoryId: "repo", branch: "main", headCommit: "abc", intelligenceGeneration: 7, intent, specification: spec, specificationHistory: [], tasks: [developmentTask], status: "planned", createdAt: NOW, updatedAt: NOW });
}

describe("capability-driven Copilot integration", () => {
  it("reports absent and unknown capabilities as unavailable", async () => {
    const result = await new CopilotCapabilityDetector(environment()).detect();
    expect(result).toMatchObject({ extensionDetected: false, chatAvailable: false, agentDiscoveryAvailable: false, directInvocationAvailable: false, promptInsertionAvailable: false });
    expect(result.diagnostics.map((item) => item.code)).toContain("copilot-absent");
  });

  it("does not infer direct invocation or discovery from chat commands", async () => {
    const result = await new CopilotCapabilityDetector(environment({
      listExtensions: () => Promise.resolve([{ id: "github.copilot-chat", version: "1.2.3", active: true }]),
      listCommands: () => Promise.resolve(["workbench.action.chat.open", "workbench.action.chat.openEditSession"])
    })).detect();
    expect(result.chatAvailable).toBe(true);
    expect(result.agentModeAvailable).toBe(false);
    expect(result.directInvocationAvailable).toBe(false);
    expect(result.agentDiscoveryAvailable).toBe(false);
  });

  it("discovers agents only through an explicitly supported runtime method", async () => {
    const discovered = agent();
    const discoverAgents = vi.fn(() => Promise.resolve([discovered]));
    const adapter = new CapabilityDrivenCopilotAdapter(environment({ integrationMethods: () => Promise.resolve(["agent-discovery-v1"]), discoverAgents }));
    expect(await adapter.discoverAgents()).toMatchObject([{ id: discovered.id, availability: "available", source: "copilot-discovered" }]);
    expect(discoverAgents).toHaveBeenCalledOnce();
  });

  it("returns no default or fabricated agent when discovery is unsupported", async () => {
    const adapter = new CapabilityDrivenCopilotAdapter(environment());
    expect(await new CopilotAgentDiscoveryService(adapter).discover()).toEqual([]);
  });
});

describe("agent profiles, recommendation, and selection", () => {
  it("keeps configured availability unknown and inherits alias evidence only from its explicit target", () => {
    const discovered = agent();
    const configured = agent({ id: "configured", displayName: "Configured", source: "workspace-configured", availability: "unknown", evidence: [{ kind: "configuration", source: "settings", statement: "Inert metadata." }] });
    const alias = agent({ id: "alias", displayName: "Alias", source: "user-alias", availability: "unknown", capabilities: [], taskCategories: [], aliasFor: discovered.id, evidence: [{ kind: "alias", source: "settings", statement: "Explicit alias." }] });
    const merged = new AgentProfileService().merge([discovered], [configured, alias]);
    expect(merged.find((item) => item.id === "configured")?.availability).toBe("unknown");
    expect(merged.find((item) => item.id === "alias")).toMatchObject({ availability: "available", capabilities: ["implementation", "testing"] });
  });

  it("ranks deterministically and exposes every match and penalty", () => {
    const result = new AgentRecommendationService().recommend(task(), [agent(), agent({ id: "agent.docs", displayName: "Docs", capabilities: ["documentation"], taskCategories: ["documentation"] })]);
    expect(result.candidates[0]).toMatchObject({ agent: { id: "agent.implementation" }, matchingCapabilities: ["implementation", "testing"], missingCapabilities: [] });
    expect(result.candidates[1]?.reasons.join(" ")).toContain("missing: implementation, testing");
  });

  it("requires confirmation and rejects unavailable selections", async () => {
    const selection = new AgentSelectionService();
    await expect(selection.select(IDS.task, agent(), false)).rejects.toThrow("explicit user confirmation");
    await expect(selection.select(IDS.task, agent({ availability: "unavailable" }), true)).rejects.toThrow("unavailable");
  });
});

describe("prompt, fallback, and eligibility gates", () => {
  it("builds a deterministic, complete prompt without an LLM", async () => {
    const builder = new DelegationPromptBuilder();
    const first = await builder.build(task(), specification(), agent(), context());
    const second = await builder.build(task(), specification(), agent(), context());
    expect(first).toEqual(second);
    expect(first.prompt).toContain("Acceptance criteria");
    expect(first.prompt).toContain("Do not modify unrelated areas");
    expect(first.fingerprint).toMatch(/^sha256:/);
  });

  it("uses direct, assisted, and clipboard modes strictly from detected capability flags", () => {
    const fallback = new DelegationFallbackService();
    const base = { schemaVersion: 1 as const, detectedAt: NOW, extensionDetected: true, extensionVersions: {}, agentModeAvailable: false, agentDiscoveryAvailable: false, completionEventsAvailable: false, resultCaptureAvailable: false, supportedInvocationMethods: [], diagnostics: [], fingerprint: "f", discoveryDurationMs: 0 };
    expect(fallback.mode({ ...base, chatAvailable: true, directInvocationAvailable: true, promptInsertionAvailable: true }, agent())).toBe("direct");
    expect(fallback.mode({ ...base, chatAvailable: true, directInvocationAvailable: true, promptInsertionAvailable: true }, agent({ source: "workspace-configured", availability: "unknown", invocationMethod: undefined }))).toBe("assisted");
    expect(fallback.mode({ ...base, chatAvailable: true, directInvocationAvailable: false, promptInsertionAvailable: true })).toBe("assisted");
    expect(fallback.mode({ ...base, chatAvailable: true, directInvocationAvailable: false, promptInsertionAvailable: false })).toBe("clipboard");
  });

  it("blocks unreviewed context and an unapproved exact prompt", () => {
    const result = new TaskEligibilityService().check({ workflow: workflow(), task: task(), specification: specification(), agent: agent(), context: context(false), currentGeneration: 7, currentBranch: "main" });
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((item) => item.code)).toEqual(expect.arrayContaining(["context-unreviewed", "delegation-unapproved"]));
  });
});
