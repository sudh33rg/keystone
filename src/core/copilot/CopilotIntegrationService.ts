import { createHash } from "node:crypto";
import {
  CopilotIntegrationCapabilitiesSchema,
  KeystoneToolDescriptorSchema,
  KeystoneToolInputSchema,
  KeystoneToolResultSchema,
  type CopilotIntegrationCapabilities,
  type CopilotToolAuditEntry,
  type KeystoneToolDescriptor,
  type KeystoneToolInput,
  type KeystoneToolName,
  type KeystoneToolResult,
} from "../../shared/contracts/copilotIntegration";
import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { CopilotIntegrationPersistenceStore } from "../persistence/CopilotIntegrationPersistenceStore";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { TaskContextService } from "../context/TaskContextService";
import type { ExecutionPersistenceStore } from "../persistence/ExecutionPersistenceStore";

export interface CopilotRuntimeSurface {
  chat: boolean;
  tools: boolean;
  participant: boolean;
  direct: boolean;
  assisted: boolean;
  clipboard: boolean;
}
export class CopilotCapabilityService {
  constructor(
    private readonly surface: () => CopilotRuntimeSurface,
    private readonly customizationAvailable: () => boolean,
    private readonly persistence?: CopilotIntegrationPersistenceStore,
  ) {}
  async refresh(): Promise<CopilotIntegrationCapabilities> {
    const runtime = this.surface();
    const discovery = this.customizationAvailable();
    const limitations = [
      ...(!runtime.chat ? ["Copilot Chat is unavailable in this window."] : []),
      ...(!runtime.tools
        ? ["The VS Code Language Model Tool API is unavailable or Keystone tools are disabled."]
        : []),
      ...(!runtime.participant
        ? ["The optional Keystone chat participant is unavailable or disabled."]
        : []),
      ...(!runtime.direct
        ? ["Direct agent invocation is unavailable; use assisted or clipboard mode."]
        : []),
    ];
    const base = {
      schemaVersion: 1 as const,
      detectedAt: new Date().toISOString(),
      chatAvailable: runtime.chat,
      customizationDiscoveryAvailable: discovery,
      customAgentDefinitionsDiscoverable: discovery,
      promptFilesDiscoverable: discovery,
      instructionFilesDiscoverable: discovery,
      skillsDiscoverable: discovery,
      languageModelToolsAvailable: runtime.tools,
      chatParticipantAvailable: runtime.participant,
      directAgentInvocationAvailable: runtime.direct,
      assistedInvocationAvailable: runtime.assisted,
      clipboardFallbackAvailable: runtime.clipboard,
      limitations,
    };
    const capabilities = CopilotIntegrationCapabilitiesSchema.parse({
      ...base,
      fingerprint: digest(JSON.stringify(base)),
    });
    if (this.persistence)
      await this.persistence.update((state) => ({ ...state, lastCapabilities: capabilities }));
    return capabilities;
  }
}

const TOOL_META: Array<[KeystoneToolName, string, boolean]> = [
  [
    "keystone_search_repository",
    "Search promoted local Repository Intelligence with deterministic ranking.",
    false,
  ],
  ["keystone_get_entity", "Get one canonical entity and bounded evidence.", false],
  ["keystone_find_usages", "Find evidence-backed usages of an entity.", false],
  ["keystone_find_callers", "Find exact and candidate callers of a symbol.", false],
  ["keystone_find_callees", "Find symbols called by a symbol.", false],
  [
    "keystone_find_implementations",
    "Find implementation relationships for a type or symbol.",
    false,
  ],
  ["keystone_find_tests", "Find tests mapped to an entity.", false],
  ["keystone_find_impacted_tests", "Rank tests impacted by an entity change.", false],
  ["keystone_show_path", "Find a bounded evidence-backed path between entities.", false],
  ["keystone_show_flow", "Reconstruct a bounded deterministic flow.", false],
  [
    "keystone_analyze_impact",
    "Analyze bounded direct, transitive, contract, data, test, and architecture impact.",
    false,
  ],
  ["keystone_get_task", "Get the scoped workflow task.", true],
  ["keystone_get_specification", "Get the current workflow specification.", true],
  ["keystone_get_acceptance_criteria", "Get task-scoped acceptance criteria.", true],
  ["keystone_get_task_context", "Get bounded reviewed task-context metadata.", true],
  ["keystone_get_validation_state", "Get validation state and evidence references.", true],
  ["keystone_get_workflow_state", "Get the current workflow state.", true],
];

export class CopilotToolPolicyService {
  validate(
    name: KeystoneToolName,
    input: unknown,
    repositoryId: string,
    trusted: boolean,
  ): KeystoneToolInput {
    if (!trusted)
      throw policyError(
        "workspace-untrusted",
        "Keystone tools are disabled until the workspace is trusted.",
      );
    const parsed = KeystoneToolInputSchema.parse(input);
    if (parsed.repositoryId !== repositoryId)
      throw policyError(
        "repository-scope-mismatch",
        "The tool request does not match the active repository.",
      );
    if (
      name.startsWith("keystone_get_") &&
      [
        "task",
        "specification",
        "acceptance_criteria",
        "task_context",
        "validation_state",
        "workflow_state",
      ].some((suffix) => name.endsWith(suffix)) &&
      !parsed.workflowId
    )
      throw policyError("workflow-scope-required", "This tool requires a workflowId.");
    return parsed;
  }
}

export class CopilotToolAuditService {
  constructor(private readonly persistence: CopilotIntegrationPersistenceStore) {}
  list(): CopilotToolAuditEntry[] {
    return this.persistence.snapshot.audit;
  }
  async record(entry: CopilotToolAuditEntry): Promise<void> {
    await this.persistence.update((state) => ({
      ...state,
      audit: [...state.audit, entry].slice(-state.settings.auditRetention),
    }));
  }
}

export class CopilotToolRegistry {
  constructor(private readonly available: () => boolean) {}
  list(): KeystoneToolDescriptor[] {
    return TOOL_META.map(([name, description, workflowAware]) =>
      KeystoneToolDescriptorSchema.parse({
        name,
        description,
        repositoryScope: "active-repository",
        workflowAware,
        mutating: false,
        resultLimit: 100,
        timeoutMs: 15_000,
        available: this.available(),
        ...(!this.available()
          ? { limitation: "Language Model Tool registration is unavailable or disabled." }
          : {}),
      }),
    );
  }
  has(name: string): name is KeystoneToolName {
    return TOOL_META.some(([candidate]) => candidate === name);
  }
}

export class CopilotToolExecutionService {
  private readonly policy = new CopilotToolPolicyService();
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly contexts: TaskContextService,
    private readonly executions: ExecutionPersistenceStore,
    private readonly audit: CopilotToolAuditService,
    private readonly trusted: () => boolean,
  ) {}
  async execute(
    name: KeystoneToolName,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<KeystoneToolResult> {
    const snapshot = this.snapshots.getSnapshot();
    if (!snapshot)
      throw policyError(
        "intelligence-unavailable",
        "A promoted Intelligence generation is required.",
      );
    const input = this.policy.validate(name, raw, snapshot.repository.id, this.trusted());
    if (
      input.intelligenceGeneration !== undefined &&
      input.intelligenceGeneration !== snapshot.manifest.generation
    )
      throw policyError(
        "stale-intelligence",
        `Requested generation ${input.intelligenceGeneration} is stale; current promoted generation is ${snapshot.manifest.generation}.`,
      );
    const invocationId = crypto.randomUUID();
    const started = performance.now();
    const controller = new AbortController();
    const forward = () => controller.abort();
    signal?.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("Tool time budget exceeded.", "TimeoutError")),
      input.timeoutMs,
    );
    let outcome: CopilotToolAuditEntry["outcome"] = "succeeded";
    let result: KeystoneToolResult | undefined;
    try {
      const rawData = await this.dispatch(name, input, controller.signal);
      const bounded = bound(rawData, input.limit);
      const durationMs = performance.now() - started;
      result = KeystoneToolResultSchema.parse({
        schemaVersion: 1,
        invocationId,
        toolName: name,
        repositoryId: snapshot.repository.id,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        generation: snapshot.manifest.generation,
        quality: bounded.truncated ? "truncated" : quality(rawData),
        data: redact(bounded.data),
        evidence: evidenceOf(rawData).slice(0, 100),
        confidence: confidenceOf(rawData),
        truncated: bounded.truncated,
        diagnostics: diagnosticsOf(rawData),
        durationMs,
      });
      return result;
    } catch (cause) {
      outcome = controller.signal.aborted
        ? controller.signal.reason instanceof DOMException &&
          controller.signal.reason.name === "TimeoutError"
          ? "timed-out"
          : "cancelled"
        : "failed";
      throw cause;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
      const durationMs = performance.now() - started;
      await this.audit.record({
        invocationId,
        toolName: name,
        repositoryId: snapshot.repository.id,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        inputFingerprint: digest(
          JSON.stringify({ ...input, query: input.query ? digest(input.query) : undefined }),
        ),
        intelligenceGeneration: snapshot.manifest.generation,
        resultCount: result ? countResult(result.data) : 0,
        durationMs,
        outcome,
        truncated: result?.truncated ?? false,
        ...(outcome !== "succeeded" ? { diagnosticId: outcome } : {}),
        at: new Date().toISOString(),
      });
    }
  }
  private async dispatch(
    name: KeystoneToolName,
    input: KeystoneToolInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    const q = input.entityId ?? input.query;
    const target = input.targetEntityId ?? input.targetQuery;
    switch (name) {
      case "keystone_search_repository":
        return this.intelligence.search({ query: input.query ?? "", limit: input.limit }, signal);
      case "keystone_get_entity": {
        const id = input.entityId ?? (await this.resolve(input.query, input.limit, signal));
        return id ? this.intelligence.entity(id) : { unresolved: true, candidates: [] };
      }
      case "keystone_find_usages":
        return this.intelligence.unified({ text: `where is ${required(q)} used` }, signal);
      case "keystone_find_callers":
        return this.intelligence.unified({ text: `what calls ${required(q)}` }, signal);
      case "keystone_find_callees":
        return this.intelligence.unified({ text: `what does ${required(q)} call` }, signal);
      case "keystone_find_implementations":
        return this.intelligence.unified(
          { query: structured("DEPENDENTS", required(q), input) },
          signal,
        );
      case "keystone_find_tests":
        return this.intelligence.unified({ text: `tests for ${required(q)}` }, signal);
      case "keystone_find_impacted_tests":
        return this.intelligence.unified(
          {
            query: structured("IMPACT", required(q), input, [
              "keystone.core.TestCase",
              "keystone.core.TestSuite",
            ]),
          },
          signal,
        );
      case "keystone_show_path":
        return this.intelligence.unified(
          { text: `path from ${required(q)} to ${required(target)}` },
          signal,
        );
      case "keystone_show_flow":
        return this.intelligence.unified({ text: `show ${required(q)} flow` }, signal);
      case "keystone_analyze_impact":
        return this.intelligence.unified({ text: `what is impacted by ${required(q)}` }, signal);
      case "keystone_get_workflow_state":
        return this.requireWorkflow(input.workflowId!);
      case "keystone_get_task":
        return this.requireTask(input.workflowId!, input.taskId);
      case "keystone_get_specification":
        return this.requireWorkflow(input.workflowId!).specification ?? { unavailable: true };
      case "keystone_get_acceptance_criteria": {
        const workflow = this.requireWorkflow(input.workflowId!);
        const task = this.requireTask(input.workflowId!, input.taskId);
        return (workflow.specification?.acceptanceCriteria ?? []).filter(
          (item) => !input.taskId || task.acceptanceCriterionIds.includes(item.id),
        );
      }
      case "keystone_get_task_context":
        return input.taskId
          ? (this.contexts.get(input.taskId) ?? { unavailable: true })
          : { unavailable: true };
      case "keystone_get_validation_state": {
        const sessions = this.executions.snapshot.sessions.filter(
          (item) =>
            item.workflowId === input.workflowId && (!input.taskId || item.taskId === input.taskId),
        );
        const ids = new Set(sessions.flatMap((item) => item.validationRunIds));
        return { sessions, runs: this.executions.snapshot.runs.filter((item) => ids.has(item.id)) };
      }
    }
  }
  private requireWorkflow(id: string) {
    const value = this.workflows.get(id);
    if (!value) throw policyError("workflow-not-found", "The requested workflow was not found.");
    return value;
  }
  private requireTask(workflowId: string, taskId?: string) {
    const workflow = this.requireWorkflow(workflowId);
    const task = taskId ? workflow.tasks.find((item) => item.id === taskId) : workflow.tasks[0];
    if (!task) throw policyError("task-not-found", "The requested task was not found.");
    return task;
  }
  private async resolve(
    query: string | undefined,
    limit: number,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (!query) return undefined;
    const result = await this.intelligence.search({ query, limit: Math.min(limit, 20) }, signal);
    return result.total === 1 ? result.items[0]?.id : undefined;
  }
}

function structured(
  operation: string,
  value: string,
  input: KeystoneToolInput,
  entityTypes?: string[],
) {
  return {
    operation,
    seeds: [{ kind: value.startsWith("entity:") ? "stable-id" : "name", value }],
    filters: {
      confidenceAtLeast: input.includeCandidates ? 0 : 0.7,
      ...(entityTypes ? { entityTypes } : {}),
    },
    traversal: { direction: "both", maxDepth: 4, pathMode: "shortest" },
    include: { evidence: true, source: false, explanation: true },
    ranking: { strategy: "relevance", weights: {} },
    limits: {
      results: input.limit,
      nodes: 200,
      edges: 500,
      depth: 4,
      paths: 10,
      timeBudgetMs: input.timeoutMs,
    },
  };
}
function required(value: string | undefined): string {
  if (!value?.trim()) throw policyError("invalid-input", "An entity query is required.");
  return value.trim();
}
function policyError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}
function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function countResult(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "usages", "paths", "sessions", "runs"])
      if (Array.isArray(record[key])) return record[key].length;
  }
  return value === undefined ? 0 : 1;
}
function bound(value: unknown, limit: number): { data: unknown; truncated: boolean } {
  let truncated = false;
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 8) {
      truncated = true;
      return "[depth limit]";
    }
    if (Array.isArray(item)) {
      if (item.length > limit) truncated = true;
      return item.slice(0, limit).map((entry) => visit(entry, depth + 1));
    }
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .slice(0, 100)
          .map(([key, entry]) => [key, visit(entry, depth + 1)]),
      );
    if (typeof item === "string" && item.length > 4000) {
      truncated = true;
      return `${item.slice(0, 4000)}…`;
    }
    return item;
  };
  return { data: visit(value, 0), truncated };
}
function redact(value: unknown): unknown {
  const secret = /(token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,}]+/gi;
  const visit = (item: unknown): unknown =>
    typeof item === "string"
      ? item.replace(secret, "$1=[REDACTED]")
      : Array.isArray(item)
        ? item.map(visit)
        : item && typeof item === "object"
          ? Object.fromEntries(
              Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
                /(token|password|secret|credential)/i.test(key) ? `${key}` : key,
                /(token|password|secret|credential)/i.test(key) ? "[REDACTED]" : visit(entry),
              ]),
            )
          : item;
  return visit(value);
}
function evidenceOf(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.evidence) ? record.evidence : [];
}
function diagnosticsOf(
  value: unknown,
): Array<{ code: string; severity: "info" | "warning" | "error"; message: string }> {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Record<string, unknown>).diagnostics)
  )
    return [];
  return ((value as Record<string, unknown>).diagnostics as Array<Record<string, unknown>>)
    .slice(0, 50)
    .map((item) => ({
      code: typeof item.code === "string" ? item.code.slice(0, 100) : "diagnostic",
      severity: item.severity === "error" || item.severity === "warning" ? item.severity : "info",
      message:
        typeof item.message === "string"
          ? item.message.slice(0, 2000)
          : "A structured diagnostic was returned without a message.",
    }));
}
function confidenceOf(value: unknown): number {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.confidence === "number") return Math.max(0, Math.min(1, record.confidence));
    if (Array.isArray(record.resolvedSeeds) && record.resolvedSeeds.length) return 0.9;
  }
  return 0.7;
}
function quality(value: unknown): KeystoneToolResult["quality"] {
  const diagnostics = diagnosticsOf(value);
  if (diagnostics.some((item) => /ambiguous|unresolved/i.test(item.code))) return "unresolved";
  return confidenceOf(value) >= 0.9
    ? "exact"
    : confidenceOf(value) >= 0.7
      ? "reliable"
      : "candidate";
}
