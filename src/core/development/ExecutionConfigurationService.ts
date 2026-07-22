import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import { DevelopmentSkillService } from "./DevelopmentSkillService";
import {
  EXECUTION_CONFIGURATION_SCHEMA_VERSION,
  ExecutionConfigurationPersistentStateSchema,
  type DevelopmentExecutionProfile,
  type ExecutionConfigurationAggregate,
  type ExecutionConfigurationPersistentState,
  type InstructionConflict,
  type InstructionPreview,
  type InstructionSource,
  type ManualAgentConfiguration,
  type SkillDefinition,
} from "../../shared/contracts/executionConfiguration";

export interface ExecutionConfigurationPersistence { read(): Promise<unknown | undefined>; write(value: ExecutionConfigurationPersistentState): Promise<void>; }
export class FileExecutionConfigurationPersistence implements ExecutionConfigurationPersistence {
  private readonly path: string;
  constructor(root: string, private readonly writer = new AtomicFileWriter()) { this.path = join(root, "workflows", "phase-4-execution-configuration.json"); }
  async read(): Promise<unknown | undefined> { try { return JSON.parse(await readFile(this.path, "utf8")) as unknown; } catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined; return { malformed: true }; } }
  write(value: ExecutionConfigurationPersistentState): Promise<void> { return this.writer.writeJson(this.path, value); }
}

export class ExecutionConfigurationError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable = true) { super(message); this.name = "ExecutionConfigurationError"; }
}

export interface ExecutionConfigurationDependencies {
  discoverCapabilities(manualAgents: ManualAgentConfiguration[]): Promise<Pick<ExecutionConfigurationAggregate, "capabilities" | "agents" | "manualAgents" | "diagnostics">>;
  discoverInstructions(configuredPaths: string[]): Promise<{ sources: InstructionSource[]; diagnostics: Array<{ code: string; message: string }> }>;
  previewInstruction(path: string): Promise<InstructionPreview>;
  listSkills(): SkillDefinition[];
  conflicts(instructions: Array<{ id: string; workspaceRelativePath: string; content: string }>, unavailable?: InstructionSource[]): InstructionConflict[];
  invalidatePrompt(workItemId: string): Promise<void>;
}

export interface ExecutionProfileDraft {
  workflowId: string; workItemId: string; executionCapabilityId: string; agentConfigurationId?: string; skillId: string; instructionIds: string[];
}

export class ExecutionConfigurationService {
  private state: ExecutionConfigurationPersistentState = emptyState();
  readonly diagnostics: string[] = [];
  constructor(private readonly persistence: ExecutionConfigurationPersistence, readonly dependencies: ExecutionConfigurationDependencies, private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID) {}

  async initialize(): Promise<void> {
    const stored = await this.persistence.read();
    if (stored === undefined) { const skill = new DevelopmentSkillService().builtInDevelopmentSkill(); this.state = emptyState(this.now(), [skill]); await this.persistence.write(this.state); return; }
    const parsed = ExecutionConfigurationPersistentStateSchema.safeParse(stored);
    if (!parsed.success) { this.diagnostics.push("Stored execution configuration is malformed and was not loaded."); this.state = emptyState(this.now()); return; }
    this.state = parsed.data;
  }

  async load(workflowId: string, workItemId: string): Promise<ExecutionConfigurationAggregate> {
    const capabilities = await this.dependencies.discoverCapabilities(this.state.manualAgents); const discovered = await this.dependencies.discoverInstructions(this.state.manualInstructionPaths); const skills = this.dependencies.listSkills();
    const manualAgents = this.state.manualAgents.map((item) => capabilities.manualAgents.find((candidate) => candidate.id === item.id) ?? { ...item, commandAvailable: false });
    const current = this.state.profiles.find((item) => item.workflowId === workflowId && item.workItemId === workItemId) ?? null;
    const profile = current ? this.refreshStatus(current, capabilities.capabilities, discovered.sources, skills) : null;
    const selected = profile ? discovered.sources.filter((item) => profile.instructionIds.includes(item.id)) : [];
    const conflicts = await this.detect(selected);
    return { capabilities: capabilities.capabilities, agents: capabilities.agents, manualAgents, instructions: discovered.sources, skills, conflicts, diagnostics: [...capabilities.diagnostics, ...discovered.diagnostics, ...this.diagnostics.map((message) => ({ code: "persistence-failed", message }))], profile };
  }

  async refresh(workflowId: string, workItemId: string): Promise<ExecutionConfigurationAggregate> { return this.load(workflowId, workItemId); }

  async saveProfile(draft: ExecutionProfileDraft, correlationId: string): Promise<ExecutionConfigurationAggregate> {
    this.assertCorrelation(correlationId); const aggregate = await this.load(draft.workflowId, draft.workItemId);
    const capability = aggregate.capabilities.find((item) => item.id === draft.executionCapabilityId);
    if (!capability || capability.availability !== "available") throw new ExecutionConfigurationError("capability-unavailable", "The selected execution mode is not currently available.");
    const skill = aggregate.skills.find((item) => item.id === draft.skillId && item.applicableStageTypes.includes("development"));
    if (!skill) throw new ExecutionConfigurationError("skill-not-found", "The selected Development skill was not found or is not applicable.");
    const instructions = draft.instructionIds.map((id) => aggregate.instructions.find((item) => item.id === id));
    if (instructions.some((item) => !item)) throw new ExecutionConfigurationError("instruction-not-found", "A selected instruction was not found.");
    if (instructions.some((item) => item!.availability !== "available" || !item!.contentHash)) throw new ExecutionConfigurationError("instruction-unreadable", "Every selected instruction must be readable and unchanged.");
    let agent: ManualAgentConfiguration | undefined;
    if (draft.agentConfigurationId) {
      agent = aggregate.manualAgents.find((item) => item.id === draft.agentConfigurationId);
      if (!agent) throw new ExecutionConfigurationError("manual-agent-invalid", "The selected manual agent was not found.");
      if (capability.kind === "chat-command-handoff" && (!agent.chatCommandId || !agent.commandAvailable)) throw new ExecutionConfigurationError("command-not-registered", "The manual agent's chat command is not registered in VS Code.");
    }
    const conflicts = await this.detect(instructions as InstructionSource[]);
    if (conflicts.some((item) => item.severity === "error")) throw new ExecutionConfigurationError("instruction-conflict", "Resolve blocking instruction conflicts before saving configuration.");
    const timestamp = this.now(); const existing = this.state.profiles.find((item) => item.workflowId === draft.workflowId && item.workItemId === draft.workItemId);
    const instructionHashes = Object.fromEntries((instructions as InstructionSource[]).map((item) => [item.id, item.contentHash!]));
    const contentHash = hash({ executionCapabilityId: capability.id, agentConfigurationId: agent?.id, skillId: skill.id, skillHash: skill.contentHash, instructionIds: draft.instructionIds, instructionHashes });
    const profile: DevelopmentExecutionProfile = { id: existing?.id ?? this.createId(), workflowId: draft.workflowId, workItemId: draft.workItemId, executionCapabilityId: capability.id, ...(agent ? { agentConfigurationId: agent.id } : {}), skillId: skill.id, instructionIds: [...new Set(draft.instructionIds)], status: "valid", validation: { capabilityAvailable: true, skillAvailable: true, instructionsAvailable: true, conflictsResolved: true }, instructionHashes, skillHash: skill.contentHash, contentHash, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    await this.commit({ ...this.state, profiles: existing ? replace(this.state.profiles, profile) : [...this.state.profiles, profile], correlations: { ...this.state.correlations, [correlationId]: profile.id } }, timestamp);
    await this.dependencies.invalidatePrompt(draft.workItemId);
    return this.load(draft.workflowId, draft.workItemId);
  }

  async createManualAgent(input: { displayName: string; chatCommandId?: string; usageNote?: string }, correlationId: string): Promise<ExecutionConfigurationAggregate> {
    this.assertCorrelation(correlationId); const displayName = input.displayName.trim(); if (!displayName) throw new ExecutionConfigurationError("manual-agent-invalid", "Manual agent display name is required.");
    const timestamp = this.now(); const agent: ManualAgentConfiguration = { id: this.createId(), displayName, ...(input.chatCommandId?.trim() ? { chatCommandId: input.chatCommandId.trim() } : {}), ...(input.usageNote?.trim() ? { usageNote: input.usageNote.trim() } : {}), createdAt: timestamp, updatedAt: timestamp };
    await this.commit({ ...this.state, manualAgents: [...this.state.manualAgents, agent], correlations: { ...this.state.correlations, [correlationId]: agent.id } }, timestamp);
    return this.loadAny();
  }

  async updateManualAgent(id: string, input: { displayName: string; chatCommandId?: string; usageNote?: string }, correlationId: string): Promise<ExecutionConfigurationAggregate> {
    this.assertCorrelation(correlationId); const existing = this.state.manualAgents.find((item) => item.id === id); if (!existing) throw new ExecutionConfigurationError("manual-agent-invalid", "Manual agent was not found.");
    const displayName = input.displayName.trim(); if (!displayName) throw new ExecutionConfigurationError("manual-agent-invalid", "Manual agent display name is required.");
    const next = { ...existing, displayName, chatCommandId: input.chatCommandId?.trim() || undefined, usageNote: input.usageNote?.trim() || undefined, updatedAt: this.now() };
    await this.commit({ ...this.state, manualAgents: replace(this.state.manualAgents, next), correlations: { ...this.state.correlations, [correlationId]: id } }, next.updatedAt); return this.loadAny();
  }

  async deleteManualAgent(id: string, correlationId: string): Promise<ExecutionConfigurationAggregate> {
    this.assertCorrelation(correlationId); if (this.state.profiles.some((item) => item.agentConfigurationId === id)) throw new ExecutionConfigurationError("manual-agent-in-use", "Update the active execution profile before deleting this manual agent.");
    await this.commit({ ...this.state, manualAgents: this.state.manualAgents.filter((item) => item.id !== id), correlations: { ...this.state.correlations, [correlationId]: id } }, this.now()); return this.loadAny();
  }

  async addInstructionPath(path: string, workflowId: string, workItemId: string, correlationId: string): Promise<ExecutionConfigurationAggregate> {
    this.assertCorrelation(correlationId); const preview = await this.dependencies.previewInstruction(path);
    if (this.state.manualInstructionPaths.includes(preview.workspaceRelativePath)) throw new ExecutionConfigurationError("instruction-duplicate", "That instruction file is already configured.");
    await this.commit({ ...this.state, manualInstructionPaths: [...this.state.manualInstructionPaths, preview.workspaceRelativePath], correlations: { ...this.state.correlations, [correlationId]: preview.id } }, this.now()); return this.load(workflowId, workItemId);
  }

  async previewInstruction(instructionId: string): Promise<InstructionPreview> { const discovered = await this.dependencies.discoverInstructions(this.state.manualInstructionPaths); const source = discovered.sources.find((item) => item.id === instructionId); if (!source) throw new ExecutionConfigurationError("instruction-not-found", "Instruction file was not found."); return this.dependencies.previewInstruction(source.workspaceRelativePath); }
  skill(skillId: string): SkillDefinition { const skill = this.dependencies.listSkills().find((item) => item.id === skillId); if (!skill) throw new ExecutionConfigurationError("skill-not-found", "Development skill was not found."); return skill; }
  async promptContext(workflowId: string, workItemId: string) {
    const aggregate = await this.load(workflowId, workItemId); const profile = aggregate.profile;
    if (!profile || profile.status !== "valid") throw new ExecutionConfigurationError(profile ? "execution-profile-stale" : "execution-profile-invalid", profile ? "Refresh and save the stale execution profile before preparing a prompt." : "Save a valid execution profile before preparing a prompt.");
    const capability = aggregate.capabilities.find((item) => item.id === profile.executionCapabilityId)!; const skill = aggregate.skills.find((item) => item.id === profile.skillId)!;
    const instructions = await Promise.all(profile.instructionIds.map((id) => this.previewInstruction(id)));
    const agent = profile.agentConfigurationId ? aggregate.manualAgents.find((item) => item.id === profile.agentConfigurationId) : undefined;
    return { profile, capability, skill, instructions, agent };
  }
  manualInstructionPaths(): string[] { return [...this.state.manualInstructionPaths]; }
  manualAgents(): ManualAgentConfiguration[] { return this.state.manualAgents.map((item) => ({ ...item })); }

  private async detect(sources: InstructionSource[]): Promise<InstructionConflict[]> {
    const unavailable = sources.filter((item) => item.availability !== "available"); const available = sources.filter((item) => item.availability === "available");
    const previews = await Promise.all(available.map((item) => this.dependencies.previewInstruction(item.workspaceRelativePath)));
    return this.dependencies.conflicts(previews.map((item) => ({ id: item.id, workspaceRelativePath: item.workspaceRelativePath, content: item.content })), unavailable);
  }
  private refreshStatus(profile: DevelopmentExecutionProfile, capabilities: ExecutionConfigurationAggregate["capabilities"], instructions: InstructionSource[], skills: SkillDefinition[]): DevelopmentExecutionProfile {
    const capabilityAvailable = capabilities.some((item) => item.id === profile.executionCapabilityId && item.availability === "available"); const skill = skills.find((item) => item.id === profile.skillId); const skillAvailable = Boolean(skill && skill.contentHash === profile.skillHash);
    const instructionsAvailable = profile.instructionIds.every((id) => { const current = instructions.find((item) => item.id === id); return current?.availability === "available" && current.contentHash === profile.instructionHashes[id]; });
    const valid = capabilityAvailable && skillAvailable && instructionsAvailable;
    return { ...profile, status: valid ? "valid" : "stale", validation: { ...profile.validation, capabilityAvailable, skillAvailable, instructionsAvailable, conflictsResolved: profile.validation.conflictsResolved } };
  }
  private async loadAny(): Promise<ExecutionConfigurationAggregate> { const profile = this.state.profiles.at(-1); return this.load(profile?.workflowId ?? "00000000-0000-4000-8000-000000000000", profile?.workItemId ?? "00000000-0000-4000-8000-000000000000"); }
  private assertCorrelation(value: string): void { if (!value?.trim() || value.length > 200) throw new ExecutionConfigurationError("execution-profile-invalid", "A correlation ID is required."); }
  private async commit(next: Omit<ExecutionConfigurationPersistentState, "revision" | "updatedAt"> & Partial<Pick<ExecutionConfigurationPersistentState, "revision" | "updatedAt">>, timestamp: string): Promise<void> { const state = ExecutionConfigurationPersistentStateSchema.parse({ ...next, schemaVersion: EXECUTION_CONFIGURATION_SCHEMA_VERSION, revision: this.state.revision + 1, updatedAt: timestamp }); await this.persistence.write(state); this.state = state; }
}

function emptyState(updatedAt = new Date().toISOString(), skills: SkillDefinition[] = []): ExecutionConfigurationPersistentState { return { schemaVersion: EXECUTION_CONFIGURATION_SCHEMA_VERSION, revision: 0, manualAgents: [], manualInstructionPaths: [], skills, profiles: [], correlations: {}, updatedAt }; }
function replace<T extends { id: string }>(items: T[], value: T): T[] { return items.map((item) => item.id === value.id ? value : item); }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
