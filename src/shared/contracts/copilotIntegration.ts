import { z } from "zod";

export const COPILOT_INTEGRATION_SCHEMA_VERSION = 1 as const;
const Id = z.string().min(1).max(500);
const Scope = z.object({ repositoryId: Id, workflowId: z.string().uuid().optional(), taskId: z.string().uuid().optional(), intelligenceGeneration: z.number().int().nonnegative().optional() }).strict();

export const CopilotIntegrationCapabilitiesSchema = z.object({
  schemaVersion: z.literal(COPILOT_INTEGRATION_SCHEMA_VERSION), detectedAt: z.string().datetime(),
  chatAvailable: z.boolean(), customizationDiscoveryAvailable: z.boolean(), customAgentDefinitionsDiscoverable: z.boolean(), promptFilesDiscoverable: z.boolean(), instructionFilesDiscoverable: z.boolean(), skillsDiscoverable: z.boolean(), languageModelToolsAvailable: z.boolean(), chatParticipantAvailable: z.boolean(), directAgentInvocationAvailable: z.boolean(), assistedInvocationAvailable: z.boolean(), clipboardFallbackAvailable: z.boolean(), limitations: z.array(z.string().max(1000)).max(50), fingerprint: z.string().max(256),
}).strict();
export type CopilotIntegrationCapabilities = z.infer<typeof CopilotIntegrationCapabilitiesSchema>;

export const CopilotCustomizationRecordSchema = z.object({
  id: Id, kind: z.enum(["instruction", "path-instruction", "agent", "skill", "prompt"]), name: z.string().min(1).max(500), description: z.string().max(2000).optional(), source: z.enum(["repository", "workspace", "user", "extension"]), sourcePath: z.string().max(1024).optional(), scopePatterns: z.array(z.string().max(1024)).max(100).optional(), applicability: z.enum(["automatically-applicable", "suggested", "manually-selected", "not-applicable", "unavailable", "untrusted", "stale"]), applicable: z.boolean(), applicabilityReason: z.string().max(2000).optional(), enabled: z.boolean(), trustState: z.enum(["trusted", "workspace-trusted", "untrusted", "unknown"]), contentFingerprint: z.string().max(256), lastModified: z.string().datetime().optional(), runtimeVerified: z.boolean().default(false), guidanceDisposition: z.enum(["native", "included", "reference", "excluded", "duplicate"]).default("reference"), duplicateOf: Id.optional(),
}).strict();
export type CopilotCustomizationRecord = z.infer<typeof CopilotCustomizationRecordSchema>;

export const KeystoneToolNameSchema = z.enum(["keystone_search_repository", "keystone_get_entity", "keystone_find_usages", "keystone_find_callers", "keystone_find_callees", "keystone_find_implementations", "keystone_find_tests", "keystone_find_impacted_tests", "keystone_show_path", "keystone_show_flow", "keystone_analyze_impact", "keystone_get_task", "keystone_get_specification", "keystone_get_acceptance_criteria", "keystone_get_task_context", "keystone_get_validation_state", "keystone_get_workflow_state"]);
export type KeystoneToolName = z.infer<typeof KeystoneToolNameSchema>;
export const KeystoneToolInputSchema = Scope.extend({ query: z.string().max(1000).optional(), entityId: Id.optional(), targetQuery: z.string().max(1000).optional(), targetEntityId: Id.optional(), includeCandidates: z.boolean().optional(), relationshipTypes: z.array(z.string().max(200)).max(30).optional(), limit: z.number().int().min(1).max(100).default(25), timeoutMs: z.number().int().min(100).max(15_000).default(5_000) }).strict();
export type KeystoneToolInput = z.infer<typeof KeystoneToolInputSchema>;
export const KeystoneToolDiagnosticSchema = z.object({ code: z.string().max(100), severity: z.enum(["info", "warning", "error"]), message: z.string().max(2000), recoveryAction: z.string().max(2000).optional() }).strict();
export const KeystoneToolResultSchema = z.object({ schemaVersion: z.literal(1), invocationId: z.string().uuid(), toolName: KeystoneToolNameSchema, repositoryId: Id, workflowId: z.string().uuid().optional(), taskId: z.string().uuid().optional(), generation: z.number().int().nonnegative(), quality: z.enum(["exact", "reliable", "candidate", "unresolved", "stale", "truncated"]), data: z.unknown(), evidence: z.array(z.unknown()).max(100), confidence: z.number().min(0).max(1), truncated: z.boolean(), diagnostics: z.array(KeystoneToolDiagnosticSchema).max(50), durationMs: z.number().nonnegative() }).strict();
export type KeystoneToolResult = z.infer<typeof KeystoneToolResultSchema>;
export const KeystoneToolDescriptorSchema = z.object({ name: KeystoneToolNameSchema, description: z.string().max(1000), repositoryScope: z.literal("active-repository"), workflowAware: z.boolean(), mutating: z.literal(false), resultLimit: z.number().int().positive(), timeoutMs: z.number().int().positive(), available: z.boolean(), limitation: z.string().max(1000).optional() }).strict();
export type KeystoneToolDescriptor = z.infer<typeof KeystoneToolDescriptorSchema>;
export const CopilotToolAuditEntrySchema = z.object({ invocationId: z.string().uuid(), toolName: KeystoneToolNameSchema, repositoryId: Id, workflowId: z.string().uuid().optional(), taskId: z.string().uuid().optional(), inputFingerprint: z.string().max(256), intelligenceGeneration: z.number().int().nonnegative(), resultCount: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), outcome: z.enum(["succeeded", "failed", "cancelled", "timed-out"]), truncated: z.boolean(), diagnosticId: z.string().max(100).optional(), at: z.string().datetime() }).strict();
export type CopilotToolAuditEntry = z.infer<typeof CopilotToolAuditEntrySchema>;

export const AssistedLaunchStateSchema = z.object({ id: z.string().uuid(), workflowId: z.string().uuid(), taskId: z.string().uuid(), selectedAgentId: Id.optional(), intendedAgentLabel: z.string().max(200).optional(), customizationFingerprints: z.array(z.string().max(256)).max(100), prompt: z.string().max(50_000), promptFingerprint: z.string().max(256), status: z.enum(["prepared", "opened", "copied", "confirmed", "cancelled", "uncertain", "stale"]), preparedAt: z.string().datetime(), confirmedAt: z.string().datetime().optional() }).strict();
export type AssistedLaunchState = z.infer<typeof AssistedLaunchStateSchema>;
export const CopilotIntegrationPersistentStateSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), customizationFingerprints: z.record(z.string(), z.string()), customizationEnabled: z.record(z.string(), z.boolean()), selectedAgents: z.record(z.string(), z.string()), lastCapabilities: CopilotIntegrationCapabilitiesSchema.optional(), settings: z.object({ toolsEnabled: z.boolean(), participantEnabled: z.boolean(), includeCandidates: z.boolean(), maximumToolResults: z.number().int().min(1).max(100), maximumSourceExcerptLines: z.number().int().min(0).max(100), defaultAssistedMode: z.enum(["open-chat", "clipboard"]), auditRetention: z.number().int().min(10).max(1000) }).strict(), audit: z.array(CopilotToolAuditEntrySchema).max(1000), assistedLaunches: z.array(AssistedLaunchStateSchema).max(100), updatedAt: z.string().datetime() }).strict();
export type CopilotIntegrationPersistentState = z.infer<typeof CopilotIntegrationPersistentStateSchema>;

export const CopilotScopePayloadSchema = Scope;
export const CopilotCustomizationIdPayloadSchema = Scope.extend({ customizationId: Id }).strict();
export const CopilotCustomizationTogglePayloadSchema = CopilotCustomizationIdPayloadSchema.extend({ enabled: z.boolean() }).strict();
export const CopilotToolTestPayloadSchema = Scope.extend({ toolName: KeystoneToolNameSchema, input: KeystoneToolInputSchema }).strict();
export const AssistedLaunchPayloadSchema = Scope.extend({ selectedAgentId: Id.optional(), intendedAgentLabel: z.string().max(200).optional() }).strict();
export const AssistedLaunchIdPayloadSchema = z.object({ launchId: z.string().uuid() }).strict();
