import { z } from "zod";

export const ExecutionCapabilitySchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["clipboard-handoff", "chat-command-handoff", "direct-agent-invocation", "manual-work"]),
  displayName: z.string().min(1).max(200),
  availability: z.enum(["available", "unavailable", "requires-configuration"]),
  source: z.enum(["vscode-api", "registered-command", "manual-configuration", "keystone"]),
  diagnostic: z.object({ code: z.string().min(1), message: z.string().min(1).max(2000) }).strict().optional(),
  commandId: z.string().min(1).max(500).optional(),
}).strict();

export const ManualAgentConfigurationSchema = z.object({
  id: z.string().uuid(), displayName: z.string().trim().min(1).max(200), chatCommandId: z.string().trim().min(1).max(500).optional(), usageNote: z.string().trim().max(2000).optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), commandAvailable: z.boolean().optional(),
}).strict();

export const DiscoveredAgentSchema = z.object({
  id: z.string().min(1).max(500), displayName: z.string().min(1).max(200), sourceExtension: z.string().max(500).optional(),
  supportedInvocationModes: z.array(z.enum(["chat-command-handoff", "direct-agent-invocation"])).max(10), availability: z.enum(["available", "unavailable"]),
}).strict();

export const InstructionSourceSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(500), workspaceRelativePath: z.string().min(1).max(10_000), uri: z.string().min(1).max(20_000),
  sourceType: z.enum(["repository", "copilot", "keystone", "user-selected"]), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), sizeBytes: z.number().int().nonnegative(), modifiedAt: z.string().datetime().optional(),
  availability: z.enum(["available", "missing", "unreadable", "unsupported"]), diagnostic: z.object({ code: z.string().min(1), message: z.string().min(1).max(2000) }).strict().optional(),
}).strict();
export const InstructionPreviewSchema = InstructionSourceSchema.extend({ content: z.string().max(262_144) }).strict();

export const SkillDefinitionSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), applicableStageTypes: z.array(z.string().min(1).max(100)).min(1).max(20), promptFragment: z.string().min(1).max(50_000),
  expectedOutput: z.object({ summaryRequired: z.boolean(), changedFilesRequired: z.boolean(), testsRequired: z.boolean(), assumptionsRequired: z.boolean() }).strict(),
  source: z.enum(["keystone-built-in", "repository", "user-created"]), contentHash: z.string().regex(/^[a-f0-9]{64}$/), version: z.number().int().positive(),
}).strict();

export const InstructionConflictSchema = z.object({
  id: z.string().min(1).max(200), category: z.enum(["file-scope", "test-requirement", "output-format", "naming-rule", "framework-rule", "git-policy", "instruction-availability"]),
  state: z.enum(["no-conflict", "possible-conflict", "conflict", "unresolved"]), severity: z.enum(["info", "warning", "error"]), confidence: z.enum(["deterministic", "inferred"]),
  instructionIds: z.array(z.string().min(1)).min(1), sourcePaths: z.array(z.string().min(1)).min(1), evidence: z.array(z.string().min(1).max(500)).min(1), recommendedResolution: z.string().min(1).max(2000),
}).strict();

export const DevelopmentExecutionProfileSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), workItemId: z.string().uuid(), executionCapabilityId: z.string().min(1).max(200), agentConfigurationId: z.string().min(1).max(500).optional(), skillId: z.string().min(1).max(200), instructionIds: z.array(z.string().min(1).max(200)).max(100),
  status: z.enum(["draft", "valid", "invalid", "stale"]), validation: z.object({ capabilityAvailable: z.boolean(), skillAvailable: z.boolean(), instructionsAvailable: z.boolean(), conflictsResolved: z.boolean() }).strict(),
  instructionHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)), instructionPaths: z.record(z.string(), z.string().min(1).max(10_000)).optional(), skillHash: z.string().regex(/^[a-f0-9]{64}$/), contentHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();

export const ExecutionConfigurationAggregateSchema = z.object({
  capabilities: z.array(ExecutionCapabilitySchema), agents: z.array(DiscoveredAgentSchema), manualAgents: z.array(ManualAgentConfigurationSchema), instructions: z.array(InstructionSourceSchema), skills: z.array(SkillDefinitionSchema), conflicts: z.array(InstructionConflictSchema),
  diagnostics: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) }).strict()), profile: DevelopmentExecutionProfileSchema.nullable(),
}).strict();

export const EXECUTION_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const ExecutionConfigurationPersistentStateSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONFIGURATION_SCHEMA_VERSION), revision: z.number().int().nonnegative(), manualAgents: z.array(ManualAgentConfigurationSchema.omit({ commandAvailable: true })), manualInstructionPaths: z.array(z.string().min(1).max(10_000)), skills: z.array(SkillDefinitionSchema), profiles: z.array(DevelopmentExecutionProfileSchema), correlations: z.record(z.string(), z.string()), updatedAt: z.string().datetime(),
}).strict();

export type ExecutionCapability = z.infer<typeof ExecutionCapabilitySchema>;
export type ManualAgentConfiguration = z.infer<typeof ManualAgentConfigurationSchema>;
export type DiscoveredAgent = z.infer<typeof DiscoveredAgentSchema>;
export type InstructionSource = z.infer<typeof InstructionSourceSchema>;
export type InstructionPreview = z.infer<typeof InstructionPreviewSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export type InstructionConflict = z.infer<typeof InstructionConflictSchema>;
export type DevelopmentExecutionProfile = z.infer<typeof DevelopmentExecutionProfileSchema>;
export type ExecutionConfigurationAggregate = z.infer<typeof ExecutionConfigurationAggregateSchema>;
export type ExecutionConfigurationPersistentState = z.infer<typeof ExecutionConfigurationPersistentStateSchema>;
