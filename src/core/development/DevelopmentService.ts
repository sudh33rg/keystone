import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import type { WorkflowService } from "../workflow/WorkflowService";
import { DevelopmentPromptService } from "./DevelopmentPromptService";
import { ManualHandoffError, type ManualHandoffService } from "./ManualHandoffService";
import type { WorkspaceChangeService } from "./WorkspaceChangeService";
import type { ExecutionConfigurationService } from "./ExecutionConfigurationService";
import type { DevelopmentContextBuildInput, DevelopmentContextPackageService } from "../context/DevelopmentContextPackageService";
import {
  DEVELOPMENT_SCHEMA_VERSION,
  DevelopmentPersistentStateSchema,
  DevelopmentIntelligenceSelectionSchema,
  DevelopmentResultSchema,
  DevelopmentScopeItemSchema,
  type DevelopmentAggregate,
  type DevelopmentChangeDetection,
  type DevelopmentHandoff,
  type DevelopmentIntelligenceSelection,
  type DevelopmentPersistentState,
  type DevelopmentResult,
  type DevelopmentScopeItem,
  type DevelopmentWorkItem,
  type DevelopmentWorkItemStatus,
} from "../../shared/contracts/development";

export interface DevelopmentPersistence { read(): Promise<unknown | undefined>; write(value: DevelopmentPersistentState): Promise<void>; }
export class FileDevelopmentPersistence implements DevelopmentPersistence {
  private readonly path: string;
  constructor(root: string, private readonly writer = new AtomicFileWriter()) { this.path = join(root, "workflows", "phase-3-development.json"); }
  async read(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as unknown; }
    catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined; return { malformed: true }; }
  }
  write(value: DevelopmentPersistentState): Promise<void> { return this.writer.writeJson(this.path, value); }
}

export class DevelopmentServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable = true) { super(message); this.name = "DevelopmentServiceError"; }
}

const transitions: Record<DevelopmentWorkItemStatus, DevelopmentWorkItemStatus[]> = {
  ready: ["editing", "prompt-prepared", "awaiting-result", "failed"], editing: ["prompt-prepared", "awaiting-result", "failed"],
  "prompt-prepared": ["editing", "handed-off", "awaiting-result", "failed"], "handed-off": ["awaiting-result", "failed"],
  "awaiting-result": ["result-recorded", "awaiting-review", "failed"], "result-recorded": ["awaiting-review", "failed"],
  "awaiting-review": ["awaiting-result", "completed", "failed"], completed: [], failed: ["editing", "awaiting-result"],
};

export class DevelopmentService {
  private state: DevelopmentPersistentState = emptyState();
  private readonly promptService: DevelopmentPromptService;
  private handoffService?: ManualHandoffService;
  private changeService?: WorkspaceChangeService;
  private executionConfiguration?: ExecutionConfigurationService;
  private contextPackages?: DevelopmentContextPackageService;
  private readScopeContent?: (path: string, range?: { startLine: number; endLine: number }) => Promise<string>;
  private readonly latestChanges = new Map<string, DevelopmentChangeDetection>();
  readonly diagnostics: string[] = [];

  constructor(private readonly persistence: DevelopmentPersistence, private readonly workflows: WorkflowService, private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID, promptService?: DevelopmentPromptService) {
    this.promptService = promptService ?? new DevelopmentPromptService(now, createId);
  }
  setHandoffService(service: ManualHandoffService): void { this.handoffService = service; }
  setWorkspaceChangeService(service: WorkspaceChangeService): void { this.changeService = service; }
  setExecutionConfigurationService(service: ExecutionConfigurationService): void { this.executionConfiguration = service; }
  setContextPackageService(service: DevelopmentContextPackageService, readScopeContent: (path: string, range?: { startLine: number; endLine: number }) => Promise<string>): void { this.contextPackages = service; this.readScopeContent = readScopeContent; }

  async initialize(): Promise<void> {
    const stored = await this.persistence.read();
    if (stored === undefined) { this.state = emptyState(this.now()); return; }
    const parsed = DevelopmentPersistentStateSchema.safeParse(stored);
    if (!parsed.success) { this.diagnostics.push("Stored Development state is malformed and was not loaded."); this.state = emptyState(this.now()); return; }
    this.state = parsed.data;
  }

  async initializeStage(workflowId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId);
    const existing = this.state.workItems.find((item) => item.workflowId === workflowId);
    if (existing) return this.load(workflowId);
    const workflow = await this.workflows.activateDevelopmentStage(workflowId);
    const stage = workflow.stages.find((item) => item.type === "development");
    if (!stage) throw new DevelopmentServiceError("development-stage-not-found", "This workflow does not contain a Development stage.");
    const timestamp = this.now();
    const workItem: DevelopmentWorkItem = { id: this.createId(), workflowId, stageId: stage.id, objective: workflow.intent.text, status: "ready", sourceScopeIds: [], createdAt: timestamp, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: [...this.state.workItems, workItem], objectiveRevisions: { ...this.state.objectiveRevisions, [workItem.id]: 1 }, correlations: { ...this.state.correlations, [correlationId]: workItem.id } }, timestamp);
    return this.load(workflowId);
  }

  async load(workflowId: string): Promise<DevelopmentAggregate> {
    const workflow = this.workflows.getWorkflow(workflowId);
    if (!workflow) throw new DevelopmentServiceError("workflow-not-found", "The selected workflow was not found.");
    const workItem = this.state.workItems.find((item) => item.workflowId === workflowId);
    if (!workItem) throw new DevelopmentServiceError("work-item-not-found", "Initialize the Development stage before loading it.");
    const scopeItems = this.state.scopeItems.filter((item) => item.workItemId === workItem.id);
    const promptPreparation = workItem.promptPreparationId ? this.state.promptPreparations.find((item) => item.id === workItem.promptPreparationId && item.status !== "superseded") ?? null : null;
    const handoff = workItem.handoffId ? this.state.handoffs.find((item) => item.id === workItem.handoffId) ?? null : null;
    const result = workItem.resultId ? this.state.results.find((item) => item.id === workItem.resultId) ?? null : null;
    const changeDetection = mergeAssociations(this.latestChanges.get(workItem.id) ?? { available: false, message: "Detect workspace changes to review them.", changes: [] }, result, scopeItems);
    return { workflow, workItem, scopeItems, intelligenceSelections: this.state.intelligenceSelections.filter((selection) => selection.workItemId === workItem.id), promptPreparation, handoff, result, contextPackage: this.contextPackages?.get(workItem.id) ?? null, changeDetection, completion: completionState(workflow.intent.workType, workItem, scopeItems, promptPreparation, handoff, result, this.state.manualOrigins.includes(workItem.id)) };
  }

  async getHomeSummary(workflowId: string): Promise<{ nextRequiredAction: string } | undefined> {
    if (!this.state.workItems.some((item) => item.workflowId === workflowId)) return undefined;
    const aggregate = await this.load(workflowId);
    if (this.executionConfiguration && aggregate.workItem.status !== "completed") {
      const configuration = await this.executionConfiguration.load(workflowId, aggregate.workItem.id);
      if (!configuration.profile) return { nextRequiredAction: "Configure Development execution" };
      if (configuration.conflicts.some((item) => item.severity === "error")) return { nextRequiredAction: "Resolve Development instruction conflicts" };
      if (configuration.profile.status !== "valid") return { nextRequiredAction: "Review stale Development execution profile" };
    }
    const next = aggregate.completion.unmet[0] ?? (aggregate.workItem.status === "completed" ? "Open the next required stage" : "Complete Development");
    return { nextRequiredAction: next };
  }

  async updateObjective(workflowId: string, workItemId: string, objective: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const value = objective.trim();
    if (!value || value.length > 10_000) throw new DevelopmentServiceError("invalid-objective", "Development objective is required and must be 10,000 characters or fewer.");
    if (item.objective === value) return this.load(workflowId);
    const timestamp = this.now(); const nextItem = { ...item, objective: value, status: "editing" as const, updatedAt: timestamp, promptPreparationId: undefined, handoffId: undefined };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), promptPreparations: this.state.promptPreparations.map((entry) => entry.id === item.promptPreparationId ? { ...entry, status: "superseded" as const } : entry), objectiveRevisions: { ...this.state.objectiveRevisions, [item.id]: (this.state.objectiveRevisions[item.id] ?? 1) + 1 }, correlations: { ...this.state.correlations, [correlationId]: item.id } }, timestamp);
    await this.contextPackages?.invalidate(workItemId, "The Development objective changed.");
    return this.load(workflowId);
  }

  async addScopeItem(workflowId: string, workItemId: string, raw: DevelopmentScopeItem, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const parsed = DevelopmentScopeItemSchema.safeParse(raw);
    if (!parsed.success || parsed.data.workflowId !== workflowId || parsed.data.workItemId !== workItemId) throw new DevelopmentServiceError("scope-item-invalid", "The source-scope item does not match this Development work item.");
    const duplicate = this.state.scopeItems.some((entry) => entry.workItemId === workItemId && entry.workspaceRelativePath === parsed.data.workspaceRelativePath && (entry.kind === "file" && parsed.data.kind === "file" || entry.symbol?.entityId === parsed.data.symbol?.entityId));
    if (duplicate) throw new DevelopmentServiceError("duplicate-scope-item", "That source item is already in the Development scope.");
    const timestamp = this.now(); const nextItem = { ...item, status: "editing" as const, sourceScopeIds: [...item.sourceScopeIds, parsed.data.id], promptPreparationId: undefined, handoffId: undefined, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), scopeItems: [...this.state.scopeItems, parsed.data], promptPreparations: supersede(this.state.promptPreparations, item.promptPreparationId), correlations: { ...this.state.correlations, [correlationId]: parsed.data.id } }, timestamp);
    await this.contextPackages?.invalidate(workItemId, "The selected source scope changed.");
    return this.load(workflowId);
  }

  async removeScopeItem(workflowId: string, workItemId: string, scopeItemId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId);
    if (!item.sourceScopeIds.includes(scopeItemId)) throw new DevelopmentServiceError("scope-item-not-found", "The selected source-scope item was not found.");
    const timestamp = this.now(); const nextItem = { ...item, status: "editing" as const, sourceScopeIds: item.sourceScopeIds.filter((id) => id !== scopeItemId), promptPreparationId: undefined, handoffId: undefined, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), scopeItems: this.state.scopeItems.filter((entry) => entry.id !== scopeItemId), promptPreparations: supersede(this.state.promptPreparations, item.promptPreparationId), correlations: { ...this.state.correlations, [correlationId]: scopeItemId } }, timestamp);
    await this.contextPackages?.invalidate(workItemId, "The selected source scope changed.");
    return this.load(workflowId);
  }

  async addIntelligenceSelection(workflowId: string, workItemId: string, raw: Omit<DevelopmentIntelligenceSelection, "id" | "workflowId" | "workItemId" | "createdAt">, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId);
    const parsed = DevelopmentIntelligenceSelectionSchema.safeParse({ ...raw, id: this.createId(), workflowId, workItemId, createdAt: this.now() });
    if (!parsed.success) throw new DevelopmentServiceError("context-update-failed", "The bounded Intelligence selection is invalid.");
    const duplicate = this.state.intelligenceSelections.some((selection) => selection.workItemId === workItemId && selection.entityIds.join("\0") === parsed.data.entityIds.join("\0") && selection.edgeIds.join("\0") === parsed.data.edgeIds.join("\0"));
    if (duplicate) throw new DevelopmentServiceError("duplicate-scope-item", "That Intelligence path is already selected for Development context.");
    const timestamp = this.now();
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, { ...item, status: "editing", promptPreparationId: undefined, handoffId: undefined, updatedAt: timestamp }), intelligenceSelections: [...this.state.intelligenceSelections, parsed.data], promptPreparations: supersede(this.state.promptPreparations, item.promptPreparationId), correlations: { ...this.state.correlations, [correlationId]: parsed.data.id } }, timestamp);
    await this.contextPackages?.invalidate(workItemId, "A bounded Intelligence flow selection changed.");
    return this.load(workflowId);
  }

  async replaceScopeAvailability(workflowId: string, workItemId: string, scopeItems: DevelopmentScopeItem[]): Promise<DevelopmentAggregate> {
    this.assertWorkItem(workflowId, workItemId); const ids = new Set(scopeItems.map((item) => item.id));
    await this.commit({ ...this.state, scopeItems: this.state.scopeItems.map((item) => ids.has(item.id) ? scopeItems.find((entry) => entry.id === item.id)! : item) }, this.now());
    return this.load(workflowId);
  }

  async preparePrompt(workflowId: string, workItemId: string, repositoryName: string, notes: string | undefined, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const workflow = this.workflows.getWorkflow(workflowId)!;
    const scope = this.state.scopeItems.filter((entry) => entry.workItemId === workItemId && entry.availability === "available");
    if (!scope.length) throw new DevelopmentServiceError("completion-gate-failed", "Select at least one available source-scope item before preparing the prompt.");
    const execution = this.executionConfiguration ? await this.executionConfiguration.promptContext(workflowId, workItemId) : undefined;
    if (execution?.capability.kind === "manual-work") throw new DevelopmentServiceError("execution-profile-invalid", "Manual Work does not require prompt preparation. Start manual work from the selected execution profile.");
    const contextPackage = this.contextPackages?.get(workItemId);
    if (this.contextPackages && (!contextPackage || contextPackage.metadata.status !== "approved")) throw new DevelopmentServiceError("package-not-approved", "Approve the current context package before preparing the Development prompt.");
    if (this.contextPackages && contextPackage) { const savedNotes = contextPackage.items.find((entry) => entry.id === "development:user-notes")?.content; const freshInput = await this.contextInput(workflowId, workItemId, contextPackage.budget.requestedTokens, savedNotes, contextPackage.items.filter((entry) => entry.pinned).map((entry) => entry.id)); if (!await this.contextPackages.ensureFresh(freshInput)) throw new DevelopmentServiceError("package-stale", "The approved context package is stale because an input or source changed. Regenerate and approve it again."); }
    const prepared = this.promptService.prepare({ workflowId, workItemId, intent: workflow.intent.text, workType: workflow.intent.workType, specification: workflow.specification?.text, objective: item.objective, objectiveRevision: this.state.objectiveRevisions[item.id] ?? 1, specificationRevision: workflow.specification?.revision, repositoryName, notes, scope, ...(contextPackage ? { contextPackage } : {}), ...(execution ? { execution } : {}) });
    const timestamp = this.now(); const nextItem = { ...item, status: "prompt-prepared" as const, promptPreparationId: prepared.id, handoffId: undefined, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), promptPreparations: [...supersede(this.state.promptPreparations, item.promptPreparationId), prepared], correlations: { ...this.state.correlations, [correlationId]: prepared.id } }, timestamp);
    return this.load(workflowId);
  }

  async copyPrompt(workflowId: string, workItemId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const prompt = this.currentPrompt(item);
    await this.assertContextFreshForHandoff(workflowId, workItemId, prompt.contextPackageId, prompt.contextPackageRevision, prompt.contextPackageHash);
    if (!this.handoffService) throw new DevelopmentServiceError("clipboard-unavailable", "Clipboard integration is unavailable.");
    let handoff: DevelopmentHandoff;
    try { handoff = await this.handoffService.copy({ workflowId, workItemId, promptPreparationId: prompt.id, content: prompt.content }); if (prompt.contextPackageId && prompt.contextPackageRevision && prompt.contextPackageHash) handoff = { ...handoff, contextPackageId: prompt.contextPackageId, contextPackageRevision: prompt.contextPackageRevision, contextPackageHash: prompt.contextPackageHash }; }
    catch (cause) {
      if (cause instanceof ManualHandoffError && cause.handoff) {
        const timestamp = this.now(); const failedItem = { ...item, handoffId: cause.handoff.id, updatedAt: timestamp };
        await this.commit({ ...this.state, workItems: replace(this.state.workItems, failedItem), handoffs: [...this.state.handoffs, cause.handoff], correlations: { ...this.state.correlations, [correlationId]: cause.handoff.id } }, timestamp);
      }
      throw cause;
    }
    const timestamp = this.now(); const nextItem = { ...item, handoffId: handoff.id, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), handoffs: [...this.state.handoffs, handoff], correlations: { ...this.state.correlations, [correlationId]: handoff.id } }, timestamp);
    return this.load(workflowId);
  }

  async confirmHandoff(workflowId: string, workItemId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const handoff = item.handoffId ? this.state.handoffs.find((entry) => entry.id === item.handoffId) : undefined;
    if (!handoff || !this.handoffService) throw new DevelopmentServiceError("handoff-not-confirmed", "Copy the current prompt before confirming handoff.");
    await this.assertContextFreshForHandoff(workflowId, workItemId, handoff.contextPackageId, handoff.contextPackageRevision, handoff.contextPackageHash);
    const confirmed = this.handoffService.confirm(handoff); const timestamp = this.now(); const nextItem = { ...item, status: "awaiting-result" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), handoffs: replace(this.state.handoffs, confirmed), promptPreparations: this.state.promptPreparations.map((entry) => entry.id === confirmed.promptPreparationId ? { ...entry, status: "handed-off" as const } : entry), correlations: { ...this.state.correlations, [correlationId]: confirmed.id } }, timestamp);
    return this.load(workflowId);
  }

  async recordManualOrigin(workflowId: string, workItemId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const timestamp = this.now(); const nextItem = { ...item, status: "awaiting-result" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), manualOrigins: [...new Set([...this.state.manualOrigins, workItemId])], correlations: { ...this.state.correlations, [correlationId]: workItemId } }, timestamp);
    return this.load(workflowId);
  }

  async detectChanges(workflowId: string, workItemId: string): Promise<DevelopmentAggregate> {
    this.assertWorkItem(workflowId, workItemId); const detection = this.changeService ? await this.changeService.detect() : { available: false, message: "Source-control change detection is unavailable. Select changed files manually.", changes: [] };
    this.latestChanges.set(workItemId, detection); return this.load(workflowId);
  }

  async recordResult(workflowId: string, workItemId: string, raw: { summary: string; decisions?: string; assumptions?: string; testsRun?: string; unresolvedIssues?: string }, correlationId: string): Promise<DevelopmentResult> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const manual = this.state.manualOrigins.includes(workItemId); const handoff = item.handoffId ? this.state.handoffs.find((entry) => entry.id === item.handoffId && entry.status === "handed-off") : undefined;
    if (!manual && !handoff) throw new DevelopmentServiceError("handoff-not-confirmed", "Confirm the prompt handoff or select manual work before recording a result.");
    const timestamp = this.now(); const existing = item.resultId ? this.state.results.find((entry) => entry.id === item.resultId) : undefined;
    const parsed = DevelopmentResultSchema.safeParse({ id: existing?.id ?? this.createId(), workflowId, workItemId, ...(handoff ? { handoffId: handoff.id } : {}), executionOrigin: manual ? "manual" : "keystone-handoff", summary: raw.summary, ...(raw.decisions?.trim() ? { decisions: raw.decisions } : {}), ...(raw.assumptions?.trim() ? { assumptions: raw.assumptions } : {}), ...(raw.testsRun?.trim() ? { testsRun: raw.testsRun } : {}), ...(raw.unresolvedIssues?.trim() ? { unresolvedIssues: raw.unresolvedIssues } : {}), associatedChangedFiles: existing?.associatedChangedFiles ?? [], excludedChangedFiles: existing?.excludedChangedFiles ?? [], noCode: existing?.noCode, reviewStatus: "not-reviewed", createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
    if (!parsed.success) throw new DevelopmentServiceError("result-invalid", "A result summary is required and all result fields must be within their limits.");
    const nextItem = { ...item, status: "awaiting-review" as const, resultId: parsed.data.id, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), results: existing ? replace(this.state.results, parsed.data) : [...this.state.results, parsed.data], correlations: { ...this.state.correlations, [correlationId]: parsed.data.id } }, timestamp);
    return parsed.data;
  }

  async associateChangedFiles(workflowId: string, workItemId: string, resultId: string, associated: string[], excluded: Array<{ path: string; reason: string }>, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const result = this.assertResult(item, resultId);
    if (excluded.some((entry) => !entry.reason.trim())) throw new DevelopmentServiceError("result-invalid", "Every excluded changed file requires a reason.");
    if ([...associated, ...excluded.map((entry) => entry.path)].some((path) => !validRelativePath(path))) throw new DevelopmentServiceError("result-invalid", "Changed-file paths must be workspace-relative.");
    const timestamp = this.now(); const next = { ...result, associatedChangedFiles: [...new Set(associated)], excludedChangedFiles: excluded.map((entry) => ({ path: entry.path, reason: entry.reason.trim() })), reviewStatus: "not-reviewed" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, results: replace(this.state.results, next), correlations: { ...this.state.correlations, [correlationId]: result.id } }, timestamp);
    return this.load(workflowId);
  }

  async confirmNoCode(workflowId: string, workItemId: string, resultId: string, explanation: string, confirmed: boolean, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const result = this.assertResult(item, resultId);
    if (!confirmed || !explanation.trim()) throw new DevelopmentServiceError("result-invalid", "Confirm the no-code outcome and provide an explanation.");
    const timestamp = this.now(); const next = { ...result, noCode: { explanation: explanation.trim(), confirmed: true as const }, reviewStatus: "not-reviewed" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, results: replace(this.state.results, next), correlations: { ...this.state.correlations, [correlationId]: result.id } }, timestamp);
    return this.load(workflowId);
  }

  async reviewResult(workflowId: string, workItemId: string, resultId: string, decision: "accepted" | "changes-requested", correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId); const result = this.assertResult(item, resultId); const timestamp = this.now();
    const nextResult = { ...result, reviewStatus: decision, updatedAt: timestamp }; const nextItem = { ...item, status: decision === "changes-requested" ? "awaiting-result" as const : "awaiting-review" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, nextItem), results: replace(this.state.results, nextResult), correlations: { ...this.state.correlations, [correlationId]: result.id } }, timestamp);
    return this.load(workflowId);
  }

  async completeDevelopment(workflowId: string, workItemId: string, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const aggregate = await this.load(workflowId); const item = this.assertWorkItem(workflowId, workItemId);
    if (aggregate.result?.reviewStatus !== "accepted") throw new DevelopmentServiceError("result-not-reviewed", "Accept the Development result before completing the stage.");
    if (!aggregate.completion.allowed) throw new DevelopmentServiceError("completion-gate-failed", `Development cannot complete: ${aggregate.completion.unmet.join("; ")}`);
    const previous = this.state; const timestamp = this.now(); const completed = { ...item, status: "completed" as const, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, completed), correlations: { ...this.state.correlations, [correlationId]: item.id } }, timestamp);
    try { await this.workflows.completeDevelopmentStage(workflowId, item.stageId); }
    catch (cause) { await this.persistence.write(previous); this.state = previous; throw new DevelopmentServiceError("persistence-failed", cause instanceof Error ? cause.message : "Workflow stage persistence failed."); }
    return this.load(workflowId);
  }

  async transitionStatus(workflowId: string, workItemId: string, status: DevelopmentWorkItemStatus, correlationId: string): Promise<DevelopmentAggregate> {
    this.assertCorrelation(correlationId); const item = this.assertWorkItem(workflowId, workItemId);
    if (!transitions[item.status].includes(status)) throw new DevelopmentServiceError("invalid-status-transition", `Development work item cannot move from ${item.status} to ${status}.`);
    const timestamp = this.now(); await this.commit({ ...this.state, workItems: replace(this.state.workItems, { ...item, status, updatedAt: timestamp }), correlations: { ...this.state.correlations, [correlationId]: item.id } }, timestamp); return this.load(workflowId);
  }

  /**
   * Creates a new Development work item for a routed production defect (Keystone
   * Phase 8 failure routing). This does not modify the existing work item; it
   * adds a focused work item so the defect can be fixed via the normal
   * Development flow. Returns the new work item id.
   */
  async createDefectWorkItem(workflowId: string, objective: string, correlationId: string, evidence?: string): Promise<string> {
    this.assertCorrelation(correlationId);
    const workflow = await this.workflows.activateDevelopmentStage(workflowId);
    const stage = workflow.stages.find((item) => item.type === "development");
    if (!stage) throw new DevelopmentServiceError("development-stage-not-found", "This workflow does not contain a Development stage.");
    const value = objective.trim();
    if (!value || value.length > 10_000) throw new DevelopmentServiceError("invalid-objective", "Defect objective is required and must be 10,000 characters or fewer.");
    const timestamp = this.now();
    const workItem: DevelopmentWorkItem = {
      id: this.createId(),
      workflowId,
      stageId: stage.id,
      objective: evidence ? `${value}\n\nEvidence:\n${evidence}` : value,
      status: "ready",
      sourceScopeIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.commit({ ...this.state, workItems: [...this.state.workItems, workItem], objectiveRevisions: { ...this.state.objectiveRevisions, [workItem.id]: 1 }, correlations: { ...this.state.correlations, [correlationId]: workItem.id } }, timestamp);
    return workItem.id;
  }

  /** Load a specific Development work item (not just the first for the workflow). */
  async loadWorkItem(workflowId: string, workItemId: string): Promise<DevelopmentAggregate> {
    const workflow = this.workflows.getWorkflow(workflowId);
    if (!workflow) throw new DevelopmentServiceError("workflow-not-found", "The selected workflow was not found.");
    const workItem = this.state.workItems.find((item) => item.id === workItemId && item.workflowId === workflowId);
    if (!workItem) throw new DevelopmentServiceError("work-item-not-found", "The selected Development work item was not found.");
    const scopeItems = this.state.scopeItems.filter((item) => item.workItemId === workItem.id);
    const promptPreparation = workItem.promptPreparationId ? this.state.promptPreparations.find((item) => item.id === workItem.promptPreparationId && item.status !== "superseded") ?? null : null;
    const handoff = workItem.handoffId ? this.state.handoffs.find((item) => item.id === workItem.handoffId) ?? null : null;
    const result = workItem.resultId ? this.state.results.find((item) => item.id === workItem.resultId) ?? null : null;
    return { workflow, workItem, scopeItems, intelligenceSelections: this.state.intelligenceSelections.filter((selection) => selection.workItemId === workItem.id), promptPreparation, handoff, result, contextPackage: this.contextPackages?.get(workItem.id) ?? null, changeDetection: { available: false, changes: [], message: "Defect work item created by Phase 8 routing." }, completion: completionState(workflow.intent.workType, workItem, scopeItems, promptPreparation, handoff, result, this.state.manualOrigins.includes(workItem.id)) };
  }

  async invalidatePrompt(workItemId: string): Promise<void> {
    await this.contextPackages?.invalidate(workItemId, "The Development execution profile changed.");
    const item = this.state.workItems.find((entry) => entry.id === workItemId); if (!item?.promptPreparationId) return;
    const timestamp = this.now(); const next = { ...item, status: "editing" as const, promptPreparationId: undefined, handoffId: undefined, updatedAt: timestamp };
    await this.commit({ ...this.state, workItems: replace(this.state.workItems, next), promptPreparations: supersede(this.state.promptPreparations, item.promptPreparationId) }, timestamp);
  }

  async buildContextPackage(workflowId: string, workItemId: string, budgetTokens: number, notes: string | undefined, pinnedItemIds: string[], correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); const input = await this.contextInput(workflowId, workItemId, budgetTokens, notes, pinnedItemIds); await this.contextPackages!.build(input); return this.load(workflowId); }
  async changeContextBudget(workflowId: string, workItemId: string, packageId: string, revision: number, budgetTokens: number, notes: string | undefined, pinnedItemIds: string[], correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); const input = await this.contextInput(workflowId, workItemId, budgetTokens, notes, pinnedItemIds); await this.contextPackages!.changeBudget(input, packageId, revision, budgetTokens); return this.load(workflowId); }
  async approveContextPackage(workflowId: string, workItemId: string, packageId: string, revision: number, fingerprint: string, correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); await this.contextPackages!.approve(workItemId, packageId, revision, fingerprint); return this.load(workflowId); }
  async pinContextItem(workflowId: string, workItemId: string, packageId: string, revision: number, itemId: string, pinned: boolean, correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); await this.contextPackages!.pin(workItemId, packageId, revision, itemId, pinned); return this.load(workflowId); }
  async removeContextItem(workflowId: string, workItemId: string, packageId: string, revision: number, itemId: string, overrideRequired: boolean, correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); await this.contextPackages!.remove(workItemId, packageId, revision, itemId, overrideRequired); return this.load(workflowId); }
  async restoreContextItem(workflowId: string, workItemId: string, packageId: string, revision: number, itemId: string, correlationId: string): Promise<DevelopmentAggregate> { this.assertCorrelation(correlationId); await this.contextPackages!.restore(workItemId, packageId, revision, itemId); return this.load(workflowId); }

  private async contextInput(workflowId: string, workItemId: string, budgetTokens: number, notes: string | undefined, pinnedItemIds: string[]): Promise<DevelopmentContextBuildInput> { if (!this.contextPackages || !this.readScopeContent || !this.executionConfiguration) throw new DevelopmentServiceError("internal-error", "Context compression is unavailable in this workspace."); const item = this.assertWorkItem(workflowId, workItemId); const workflow = this.workflows.getWorkflow(workflowId)!; const execution = await this.executionConfiguration.promptContext(workflowId, workItemId); if (execution.capability.kind === "manual-work") throw new DevelopmentServiceError("execution-profile-invalid", "Manual Work does not require an agent context package."); const scopeItems = this.state.scopeItems.filter((entry) => entry.workItemId === workItemId && entry.availability === "available"); if (!scopeItems.length) throw new DevelopmentServiceError("required-fact-missing", "Select at least one available source-scope item before building context."); const scope = await Promise.all(scopeItems.map(async (entry) => { let content: string; try { content = await this.readScopeContent!(entry.workspaceRelativePath, entry.symbol?.range); } catch (cause) { const missing = cause instanceof Error && "code" in cause && cause.code === "ENOENT"; throw new DevelopmentServiceError(missing ? "source-file-missing" : "source-file-unreadable", `${missing ? "Source file is missing" : "Source file could not be read"}: ${entry.workspaceRelativePath}. Restore access, then regenerate context.`); } if (entry.kind === "symbol" && !content.trim()) throw new DevelopmentServiceError("symbol-content-unavailable", `The selected symbol range has no readable content: ${entry.workspaceRelativePath}. Reselect the symbol, then regenerate context.`); return { id: entry.id, kind: entry.kind, workspaceRelativePath: entry.workspaceRelativePath, content, ...(entry.symbol ? { symbol: entry.symbol } : {}) }; })); return { workflowId, stageId: item.stageId, workItemId, executionProfileId: execution.profile.id, intent: workflow.intent.text, workType: workflow.intent.workType, specification: workflow.specification?.text, objective: item.objective, objectiveRevision: this.state.objectiveRevisions[item.id] ?? 1, specificationRevision: workflow.specification?.revision, budgetTokens, pinnedItemIds, notes, scope, intelligenceSelections: this.state.intelligenceSelections.filter((selection) => selection.workItemId === workItemId), skill: { id: execution.skill.id, name: execution.skill.name, content: execution.skill.promptFragment, contentHash: execution.skill.contentHash }, instructions: execution.instructions.map((entry) => ({ id: entry.id, name: entry.name, path: entry.workspaceRelativePath, content: entry.content, contentHash: entry.contentHash ?? createHash("sha256").update(entry.content).digest("hex") })) }; }

  private assertWorkItem(workflowId: string, workItemId: string): DevelopmentWorkItem {
    const item = this.state.workItems.find((entry) => entry.id === workItemId && entry.workflowId === workflowId);
    if (!item) throw new DevelopmentServiceError("work-item-not-found", "The Development work item does not match this workflow."); return item;
  }
  private assertResult(item: DevelopmentWorkItem, resultId: string): DevelopmentResult {
    const result = this.state.results.find((entry) => entry.id === resultId && entry.workItemId === item.id);
    if (!result) throw new DevelopmentServiceError("result-invalid", "The Development result does not match this work item."); return result;
  }
  private currentPrompt(item: DevelopmentWorkItem) {
    const prompt = item.promptPreparationId ? this.state.promptPreparations.find((entry) => entry.id === item.promptPreparationId && entry.status === "prepared") : undefined;
    if (!prompt) throw new DevelopmentServiceError("prompt-stale", "Prepare a current Development prompt before handoff."); return prompt;
  }
  private async assertContextFreshForHandoff(workflowId: string, workItemId: string, packageId?: string, revision?: number, fingerprint?: string): Promise<void> { if (!this.contextPackages) return; const pkg = this.contextPackages.get(workItemId); if (!pkg || pkg.metadata.status !== "approved" || pkg.id !== packageId || pkg.metadata.version !== revision || pkg.metadata.contentHash !== fingerprint) throw new DevelopmentServiceError("package-not-approved", "The prompt does not reference the current approved context package. Regenerate and approve context, then prepare the prompt again."); const savedNotes = pkg.items.find((entry) => entry.id === "development:user-notes")?.content; const input = await this.contextInput(workflowId, workItemId, pkg.budget.requestedTokens, savedNotes, pkg.items.filter((entry) => entry.pinned).map((entry) => entry.id)); if (!await this.contextPackages.ensureFresh(input)) { await this.invalidatePrompt(workItemId); throw new DevelopmentServiceError("package-stale", "The approved context package is stale because an input or source changed. Regenerate and approve it again."); } }
  private assertCorrelation(value: string): void { if (!value?.trim() || value.length > 200) throw new DevelopmentServiceError("invalid-correlation", "A valid correlation ID is required."); }
  private async commit(next: Omit<DevelopmentPersistentState, "revision" | "updatedAt"> & Partial<Pick<DevelopmentPersistentState, "revision" | "updatedAt">>, timestamp: string): Promise<void> {
    const state = DevelopmentPersistentStateSchema.parse({ ...next, schemaVersion: DEVELOPMENT_SCHEMA_VERSION, revision: this.state.revision + 1, updatedAt: timestamp }); await this.persistence.write(state); this.state = state;
  }
}

function emptyState(updatedAt = new Date().toISOString()): DevelopmentPersistentState { return { schemaVersion: DEVELOPMENT_SCHEMA_VERSION, revision: 0, workItems: [], scopeItems: [], intelligenceSelections: [], promptPreparations: [], handoffs: [], results: [], objectiveRevisions: {}, manualOrigins: [], correlations: {}, updatedAt }; }
function replace<T extends { id: string }>(items: T[], value: T): T[] { return items.map((item) => item.id === value.id ? value : item); }
function supersede<T extends { id: string; status: string }>(items: T[], id?: string): T[] { return items.map((item) => item.id === id ? { ...item, status: "superseded" } : item); }
function completionState(workType: string, workItem: DevelopmentWorkItem, scope: DevelopmentScopeItem[], prompt: DevelopmentAggregate["promptPreparation"], handoff: DevelopmentHandoff | null, result: DevelopmentResult | null, manual: boolean) {
  const unmet: string[] = [];
  if (!workItem.objective.trim()) unmet.push("Define a valid Development objective");
  if (!scope.length && workType !== "investigation") unmet.push("Select source scope");
  if (scope.some((item) => item.availability !== "available")) unmet.push("Resolve missing source-scope items");
  if (!manual && !prompt) unmet.push("Prepare a current development prompt");
  if (!manual && handoff?.status !== "handed-off") unmet.push("Confirm handoff or select manual work");
  if (!result?.summary.trim()) unmet.push("Record the Development result");
  if (result?.reviewStatus !== "accepted") unmet.push("Accept the Development result");
  if (result && !result.associatedChangedFiles.length && !result.noCode?.confirmed) unmet.push("Associate a changed file or confirm a no-code outcome");
  return { allowed: unmet.length === 0, unmet };
}
function mergeAssociations(detection: DevelopmentChangeDetection, result: DevelopmentResult | null, scope: DevelopmentScopeItem[]): DevelopmentChangeDetection {
  const associated = new Set(result?.associatedChangedFiles ?? []); const scoped = new Set(scope.map((item) => item.workspaceRelativePath)); const excluded = new Map((result?.excludedChangedFiles ?? []).map((item) => [item.path, item.reason]));
  return { ...detection, changes: detection.changes.map((change) => ({ ...change, associated: associated.has(change.path), inSourceScope: scoped.has(change.path), ...(excluded.has(change.path) ? { exclusionReason: excluded.get(change.path) } : {}) })) };
}
function validRelativePath(path: string): boolean { const normalized = path.replace(/\\/g, "/"); return Boolean(normalized) && !normalized.startsWith("/") && !normalized.split("/").includes(".."); }
