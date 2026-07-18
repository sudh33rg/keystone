import { createHash } from "node:crypto";
import { AssistedLaunchStateSchema, type AssistedLaunchState, type CopilotCustomizationRecord, type KeystoneToolInput } from "../../shared/contracts/copilotIntegration";
import type { CopilotIntegrationPersistenceStore } from "../persistence/CopilotIntegrationPersistenceStore";
import type { CopilotToolExecutionService } from "./CopilotIntegrationService";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { TaskContextService } from "../context/TaskContextService";
import type { CopilotAdapter } from "./CopilotAdapter";

export interface KeystoneChatAnswer { supported: boolean; markdown: string; toolName?: string; result?: unknown; actions: Array<{ title: string; command: "open-source" | "open-keystone" | "show-usages" | "show-flow" | "add-to-context"; arguments?: unknown[] }>; }
export class KeystoneChatParticipantService {
  constructor(private readonly tools: CopilotToolExecutionService, private readonly repositoryId: () => string | undefined) {}
  async answer(prompt: string, scope: { workflowId?: string; taskId?: string; generation?: number }, signal?: AbortSignal): Promise<KeystoneChatAnswer> {
    const base: Omit<KeystoneToolInput, "limit" | "timeoutMs"> = { repositoryId: this.repositoryId() ?? "unavailable", ...scope };
    const rules: Array<{ match: RegExp; tool: Parameters<CopilotToolExecutionService["execute"]>[0]; input: (match: RegExpExecArray) => unknown }> = [
      { match: /^find\s+usages\s+(?:of\s+)?(.+)$/i, tool: "keystone_find_usages", input: (m) => ({ ...base, query: m[1] }) },
      { match: /^show\s+(?:the\s+)?(.+?)\s+flow$/i, tool: "keystone_show_flow", input: (m) => ({ ...base, query: m[1] }) },
      { match: /^which\s+tests\s+are\s+impacted\s+by\s+(.+?)\??$/i, tool: "keystone_find_impacted_tests", input: (m) => ({ ...base, query: m[1] }) },
      { match: /^(?:why\s+is\s+)?(?:the\s+)?current\s+task\s+blocked\??$/i, tool: "keystone_get_workflow_state", input: () => base },
      { match: /^prepare\s+context\s+for\s+(?:the\s+)?current\s+task$/i, tool: "keystone_get_task_context", input: () => base },
      { match: /^find\s+(.+)$/i, tool: "keystone_search_repository", input: (m) => ({ ...base, query: m[1] }) },
    ];
    for (const rule of rules) { const match = rule.match.exec(prompt.trim()); if (!match) continue; const result = await this.tools.execute(rule.tool, { ...(rule.input(match) as Record<string, unknown>), limit: 25, timeoutMs: 5_000 }, signal); return { supported: true, toolName: rule.tool, result, markdown: render(result), actions: actionsFor(result) }; }
    return { supported: false, markdown: "Keystone cannot answer that request deterministically. Try: `find <entity>`, `find usages of <entity>`, `show <feature> flow`, `which tests are impacted by <entity>?`, or `why is the current task blocked?`", actions: [{ title: "Open Ask Repository", command: "open-keystone" }] };
  }
}

export class CopilotPromptPreparationService {
  prepare(workflow: ReturnType<DevelopmentWorkflowService["get"]> & {}, taskId: string, customizations: CopilotCustomizationRecord[], context: ReturnType<TaskContextService["get"]>): { prompt: string; included: CopilotCustomizationRecord[]; decisions: string[] } {
    const task = workflow.tasks.find((item) => item.id === taskId); if (!task) throw new Error("Task was not found."); const specification = workflow.specification; if (!specification) throw new Error("An approved specification is required."); const unique = new Map<string, CopilotCustomizationRecord>(); const decisions: string[] = [];
    for (const item of customizations.filter((value) => value.enabled && value.applicable)) { if (unique.has(item.contentFingerprint)) decisions.push(`${item.name} excluded as duplicate of ${unique.get(item.contentFingerprint)!.name}.`); else { unique.set(item.contentFingerprint, item); decisions.push(`${item.name}: ${item.guidanceDisposition === "native" ? "referenced for native Copilot discovery" : "referenced by Keystone"}.`); } }
    const included = [...unique.values()]; const prompt = [
      `Implement the approved Keystone task: ${task.title}`, "", `Objective: ${task.objective}`, "", "Acceptance criteria:", ...specification.acceptanceCriteria.filter((item) => task.acceptanceCriterionIds.includes(item.id)).map((item) => `- ${item.description} (${item.validationMethod})`), "", "Constraints:", ...specification.constraints.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`), "", "Relevant repository context:", ...(context?.items.slice(0, 30).map((item) => `- ${item.kind}: ${item.relativePath ?? item.id}`) ?? ["- Build or refresh the reviewed task context in Keystone."]), "", "Applicable guidance (discover natively; do not duplicate contents):", ...included.map((item) => `- ${item.kind}: ${item.sourcePath ?? item.name} [${item.contentFingerprint}]`), "", "Expected output:", "- Implement only this task within the approved files and constraints.", "- Add or update focused tests.", "- Report changed files and validation performed.", "", "Keystone read-only Intelligence tools may be available for exact search, usages, callers/callees, tests, paths, flows, impact, workflow, context, and validation state. Do not assume a tool is available until the environment lists it.", "", `Validation expectations: ${task.validationSteps.map((item) => "command" in item ? item.command : item.manualCheck).join("; ")}`,
    ].join("\n").slice(0, 50_000); return { prompt, included, decisions };
  }
}

export class CopilotAssistedLaunchService {
  readonly prompts = new CopilotPromptPreparationService();
  constructor(private readonly persistence: CopilotIntegrationPersistenceStore, private readonly workflows: DevelopmentWorkflowService, private readonly contexts: TaskContextService, private readonly copilot: CopilotAdapter) {}
  async prepare(workflowId: string, taskId: string, customizations: CopilotCustomizationRecord[], selection: { selectedAgentId?: string; intendedAgentLabel?: string }): Promise<AssistedLaunchState> { const workflow = this.workflows.get(workflowId); if (!workflow) throw new Error("Workflow not found."); const prepared = this.prompts.prepare(workflow, taskId, customizations, this.contexts.get(taskId)); const launch = AssistedLaunchStateSchema.parse({ id: crypto.randomUUID(), workflowId, taskId, ...selection, customizationFingerprints: prepared.included.map((item) => item.contentFingerprint), prompt: prepared.prompt, promptFingerprint: hash(prepared.prompt), status: "prepared", preparedAt: new Date().toISOString() }); await this.save(launch); return launch; }
  get(id: string): AssistedLaunchState | undefined { return this.persistence.snapshot.assistedLaunches.find((item) => item.id === id); }
  async open(id: string): Promise<AssistedLaunchState> { const launch = this.require(id); await this.copilot.openCopilot(); return this.transition(launch, "opened"); }
  async copy(id: string): Promise<AssistedLaunchState> { const launch = this.require(id); await this.copilot.copyPrompt(launch.prompt); return this.transition(launch, "copied"); }
  async confirm(id: string): Promise<AssistedLaunchState> { const launch = this.require(id); return this.transition({ ...launch, confirmedAt: new Date().toISOString() }, "confirmed"); }
  async cancel(id: string): Promise<AssistedLaunchState> { return this.transition(this.require(id), "cancelled"); }
  async recover(currentFingerprint: (launch: AssistedLaunchState) => string | undefined): Promise<void> { await this.persistence.update((state) => ({ ...state, assistedLaunches: state.assistedLaunches.map((item) => item.status === "opened" || item.status === "copied" ? { ...item, status: "uncertain" as const } : currentFingerprint(item) && currentFingerprint(item) !== item.promptFingerprint ? { ...item, status: "stale" as const } : item) })); }
  private require(id: string): AssistedLaunchState { const value = this.get(id); if (!value) throw new Error("Prepared assisted launch not found."); return value; }
  private async transition(value: AssistedLaunchState, status: AssistedLaunchState["status"]): Promise<AssistedLaunchState> { const next = AssistedLaunchStateSchema.parse({ ...value, status }); await this.save(next); return next; }
  private async save(value: AssistedLaunchState): Promise<void> { await this.persistence.update((state) => ({ ...state, assistedLaunches: [...state.assistedLaunches.filter((item) => item.id !== value.id), value].slice(-100) })); }
}

export class CopilotIntegrationDiagnosticsService { from(capabilities: { limitations: string[] }): Array<{ code: string; severity: "info"; message: string; recoveryAction: string }> { return capabilities.limitations.map((message, index) => ({ code: `copilot-limitation-${index + 1}`, severity: "info", message, recoveryAction: "Refresh capabilities after changing the environment or integration settings." })); } }
function hash(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function render(result: { toolName: string; quality: string; generation: number; truncated: boolean; data: unknown; diagnostics: Array<{ message: string }> }): string { const count = Array.isArray(result.data) ? result.data.length : result.data && typeof result.data === "object" && Array.isArray((result.data as Record<string, unknown>).items) ? ((result.data as Record<string, unknown>).items as unknown[]).length : 1; return `**${result.toolName}** returned ${count} bounded result${count === 1 ? "" : "s"} from Intelligence generation ${result.generation} (${result.quality}${result.truncated ? ", truncated" : ""}).${result.diagnostics.length ? `\n\n${result.diagnostics.map((item) => `- ${item.message}`).join("\n")}` : ""}`; }
function actionsFor(result: { toolName: string }): KeystoneChatAnswer["actions"] { return [{ title: "Open in Keystone", command: "open-keystone" }, ...(result.toolName === "keystone_find_usages" ? [{ title: "Show usages", command: "show-usages" as const }] : []), ...(result.toolName === "keystone_show_flow" ? [{ title: "Show flow", command: "show-flow" as const }] : []), { title: "Add to current task context", command: "add-to-context" }]; }
