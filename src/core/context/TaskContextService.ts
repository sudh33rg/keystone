import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import {
  ContextBudgetSchema,
  ContextItemSchema,
  TaskContextPackageSchema,
  type ContextBudget,
  type ContextItem,
  type DevelopmentSpecification,
  type DevelopmentTask,
  type TaskContextPackage
} from "../../shared/contracts/delegation";
import type { IntelligenceFileRecord, IntelligenceSnapshot, IntelligenceSymbolRecord } from "../../shared/contracts/intelligence";
import { RepositoryStateService } from "../integration/ProductIntegrationService";

export interface ContextBuildInput { task: DevelopmentTask; specification: DevelopmentSpecification; selectedAgentId?: string; budget?: Partial<ContextBudget>; pinnedEntityIds?: string[]; pinnedFiles?: string[]; currentFile?: string; currentSelection?: { relativePath: string; startLine: number; endLine: number }; signal?: AbortSignal }

export const CONTEXT_RANKING_WEIGHTS = Object.freeze({ required: 1000, userPin: 500, directTaskReference: 300, acceptanceCriterion: 250, expectedFile: 220, primaryEntity: 210, directRelationship: 150, testMapping: 140, apiOrData: 130, sameModule: 90, samePackage: 80, recentChange: 60, confidence: 100, stale: -300, sizePerK: -2 });

export class ContextCandidateCollector {
  constructor(private readonly snapshots: IntelligenceSnapshotReader, private readonly queries: IntelligenceQueryService, private readonly workspace: WorkspaceAdapter) {}

  getSnapshot(): IntelligenceSnapshot | undefined { return this.snapshots.getSnapshot(); }

  async collect(input: ContextBuildInput): Promise<ContextItem[]> {
    const snapshot = this.snapshots.getSnapshot(); if (!snapshot) throw new Error("A complete intelligence generation is required to build delegation context.");
    const items: ContextItem[] = []; const required = (kind: ContextItem["kind"], id: string, title: string, content: string, reason: string): void => { items.push(item({ kind, id, title, content, reason, tier: "required", required: true, priority: CONTEXT_RANKING_WEIGHTS.required })); };
    required("objective", `objective:${input.task.id}`, "Task objective", input.task.objective, "The approved task objective is required for safe delegation.");
    for (const requirement of input.specification.requirements.filter((value) => input.task.requirementIds.includes(value.id))) required("requirement", `requirement:${requirement.id}`, requirement.id, requirement.description, "The task is traceable to this approved requirement.");
    for (const criterion of input.specification.acceptanceCriteria.filter((value) => input.task.acceptanceCriterionIds.includes(value.id))) required("acceptance-criterion", `criterion:${criterion.id}`, criterion.id, `${criterion.description}\nValidation: ${criterion.validationMethod}\nExpected evidence: ${criterion.expectedEvidence}`, "The task must satisfy and validate this acceptance criterion.");
    for (let index = 0; index < input.specification.constraints.length; index++) required("constraint", `constraint:${index}`, `Constraint ${index + 1}`, input.specification.constraints[index]!, "Approved engineering constraint.");
    for (const decision of input.specification.decisions.filter((value) => value.resolution)) required("decision", `decision:${decision.id}`, "Approved decision", `${decision.question}\nResolution: ${decision.resolution}`, "Resolved decision affecting the approved implementation.");
    for (const step of input.task.validationSteps) required("build-command", `validation:${items.length}`, "Required validation", step.command ?? step.manualCheck ?? "Manual validation", "The task cannot be considered ready for later validation without this step.");

    const taskFiles = new Set(input.task.expectedFiles); const pinnedFiles = new Set(input.pinnedFiles ?? []); const candidateFiles = new Set([...taskFiles, ...pinnedFiles, ...(input.currentFile ? [input.currentFile] : [])]);
    for (const relativePath of [...candidateFiles].slice(0, 200)) {
      input.signal?.throwIfAborted(); const file = snapshot.files.find((value) => value.relativePath === relativePath);
      if (!file) { items.push(item({ kind: "limitation", id: `missing-file:${relativePath}`, title: relativePath, content: "The expected file is not present in the active intelligence generation.", reason: "Missing expected file is an explicit context limitation.", tier: "supporting", priority: 100, relativePath, freshness: "unknown" })); continue; }
      if (!file.classification.included || file.classification.sensitive || file.classification.binary || file.classification.generated) { items.push(item({ kind: "limitation", id: `excluded-file:${file.id}`, title: relativePath, content: file.classification.reason, reason: "The intelligence safety policy prevents source inclusion.", tier: "supporting", priority: 100, relativePath, sourceEntityId: file.id, evidenceIds: file.evidenceIds })); continue; }
      const content = await this.readFile(file, snapshot, input.signal);
      items.push(item({ kind: "file", id: `file:${file.id}`, title: relativePath, content, reason: taskFiles.has(relativePath) ? "Expected file for the approved task." : pinnedFiles.has(relativePath) ? "User-pinned file." : "Current editor proximity candidate.", relationshipToTask: taskFiles.has(relativePath) ? "expected implementation area" : pinnedFiles.has(relativePath) ? "user-pinned repository context" : "current editor proximity", tier: taskFiles.has(relativePath) ? "required" : "supporting", required: taskFiles.has(relativePath), pinned: pinnedFiles.has(relativePath), priority: taskFiles.has(relativePath) ? CONTEXT_RANKING_WEIGHTS.expectedFile : pinnedFiles.has(relativePath) ? CONTEXT_RANKING_WEIGHTS.userPin : 160, relativePath, sourceEntityId: file.id, evidenceIds: file.evidenceIds, confidence: 1, compression: content.length < 6000 ? "bounded-file" : "selected-source-ranges" }));
      if (input.currentSelection?.relativePath === relativePath && input.currentSelection.endLine >= input.currentSelection.startLine) {
        const selected = content.split("\n").slice(Math.max(0, input.currentSelection.startLine), Math.min(input.currentSelection.endLine + 1, input.currentSelection.startLine + 400)).join("\n");
        if (selected.trim()) items.push(item({ kind: "source-range", id: `selection:${file.id}:${input.currentSelection.startLine}:${input.currentSelection.endLine}`, title: `${relativePath}:${input.currentSelection.startLine + 1}`, content: selected, reason: "The user's active editor selection is a high-priority context signal.", relationshipToTask: "current editor selection", tier: "supporting", priority: 400, relativePath, sourceEntityId: file.id, evidenceIds: file.evidenceIds, confidence: 1, compression: "selected-source-range" }));
      }
    }

    const entityIds = [...new Set([...input.task.expectedEntityIds, ...(input.pinnedEntityIds ?? []).map((value) => value.split("#", 1)[0]!)])].slice(0, 200);
    for (const entityId of entityIds) {
      input.signal?.throwIfAborted(); const symbol = snapshot.symbols.find((value) => value.id === entityId); if (!symbol) continue;
      const file = snapshot.files.find((value) => value.id === symbol.fileId); const source = file && safeFile(file) ? await this.readSymbol(symbol, file, input.signal) : symbol.signature ?? symbol.qualifiedName;
      items.push(item({ kind: source === symbol.signature ? "signature" : "source-range", id: `entity:${symbol.id}`, title: symbol.qualifiedName, content: source, reason: input.task.expectedEntityIds.includes(symbol.id) ? "Primary entity named by the approved task." : "User-pinned entity.", relationshipToTask: "primary implementation entity", tier: "required", required: true, pinned: input.pinnedEntityIds?.some((value) => value.startsWith(symbol.id)), priority: CONTEXT_RANKING_WEIGHTS.primaryEntity, relativePath: file?.relativePath, sourceEntityId: symbol.id, evidenceIds: symbol.evidenceIds, confidence: symbol.confidence, compression: source === symbol.signature ? "signature-only" : "selected-symbol-range" }));
      await this.collectQueries(symbol, input, items);
      if (symbol.codeAnalysis) items.push(item({ kind: "flow", id: `cpg:${symbol.id}`, title: `CPG summary for ${symbol.qualifiedName}`, content: `Branches: ${symbol.codeAnalysis.branches}; calls: ${symbol.codeAnalysis.calls}; reads: ${symbol.codeAnalysis.reads}; writes: ${symbol.codeAnalysis.writes}; unresolved calls: ${symbol.codeAnalysis.unresolvedCalls}.`, reason: "Supported TypeScript/JavaScript CPG scope adds control/data-flow precision.", relationshipToTask: "CPG scope summary", tier: "supporting", priority: 120, sourceEntityId: symbol.id, evidenceIds: symbol.codeAnalysis.evidenceIds, confidence: symbol.codeAnalysis.confidence, compression: "cpg-scope-summary" }));
    }
    return items.slice(0, 1000);
  }

  private async collectQueries(symbol: IntelligenceSymbolRecord, input: ContextBuildInput, items: ContextItem[]): Promise<void> {
    const limits = { results: 20, nodes: 30, edges: 60, paths: 5, depth: 2, evidence: 30, timeBudgetMs: 1000 };
    for (const [operation, kind, reason] of [["NEIGHBORHOOD", "symbol", "Direct evidence-backed graph relationship."], ["TESTS_FOR", "test", "Evidence-backed test mapping for the primary entity."], ["IMPACT", "symbol", "Bounded impact candidate for the primary entity."]] as const) {
      input.signal?.throwIfAborted(); const result = await this.queries.unified({ query: { operation, seeds: [{ id: symbol.id, kind: "id" }], limits } }, input.signal);
      const selected = operation === "NEIGHBORHOOD" ? result.data.nodes : result.data.items;
      for (const value of selected.filter((candidate) => candidate.id !== symbol.id).slice(0, operation === "TESTS_FOR" ? 10 : 8)) {
        items.push(item({ kind, id: `${operation}:${symbol.id}:${value.id}`, title: value.qualifiedName ?? value.name, content: `${value.type}: ${value.qualifiedName ?? value.name}`, reason, relationshipToTask: operation.toLowerCase(), tier: operation === "TESTS_FOR" ? "supporting" : "optional", priority: operation === "TESTS_FOR" ? CONTEXT_RANKING_WEIGHTS.testMapping : CONTEXT_RANKING_WEIGHTS.directRelationship, relativePath: value.relativePath, sourceEntityId: value.id, evidenceIds: result.evidence.filter((evidence) => evidence.subjectId === value.id).map((evidence) => evidence.id), confidence: value.confidence, compression: "entity-summary" }));
      }
    }
  }

  private async readFile(file: IntelligenceFileRecord, snapshot: IntelligenceSnapshot, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted(); const root = snapshot.repository.workspaceRoots.find((value) => value.id === file.workspaceRootId); const workspaceRoot = this.workspace.getRoots().find((value) => value.name === root?.name) ?? this.workspace.getRoots()[0]; if (!workspaceRoot) return "";
    const content = await this.workspace.readTextFile(this.workspace.fileReference(workspaceRoot, file.relativePath).uri); signal?.throwIfAborted(); return sanitize(content).slice(0, 20_000);
  }

  private async readSymbol(symbol: IntelligenceSymbolRecord, file: IntelligenceFileRecord, signal?: AbortSignal): Promise<string> {
    const snapshot = this.snapshots.getSnapshot()!; const content = await this.readFile(file, snapshot, signal); const lines = content.split("\n"); const start = Math.max(0, symbol.range.startLine - 3); const end = Math.min(lines.length, symbol.range.endLine + 4); const selected = lines.slice(start, end).join("\n"); return selected.length > 12_000 ? symbol.signature ?? selected.slice(0, 12_000) : selected;
  }
}

export class ContextRanker {
  rank(items: ContextItem[]): ContextItem[] { return items.map((value) => ({ ...value, priority: score(value) })).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)); }
}

export class ContextBudgetService {
  resolve(input?: Partial<ContextBudget>): ContextBudget { return ContextBudgetSchema.parse(input ?? {}); }
  fits(items: ContextItem[], budget: ContextBudget): boolean { return sum(items, "estimatedTokens") <= budget.maxEstimatedTokens && sum(items, "estimatedCharacters") <= budget.maxCharacters && new Set(items.flatMap((item) => item.relativePath ? [item.relativePath] : [])).size <= budget.maxFiles && items.filter((item) => item.kind === "source-range").length <= budget.maxSourceFragments && items.filter((item) => item.kind === "graph-path").length <= budget.maxGraphPaths && items.filter((item) => item.kind === "test").length <= budget.maxTestMappings; }
}

export class ContextCompressor {
  constructor(private readonly budgets = new ContextBudgetService()) {}
  compress(candidates: ContextItem[], budget: ContextBudget): { included: ContextItem[]; excluded: TaskContextPackage["exclusions"]; diagnostics: TaskContextPackage["diagnostics"] } {
    const unique = new Map<string, ContextItem>(); const excluded: TaskContextPackage["exclusions"] = [];
    for (const candidate of candidates) { const key = `${candidate.kind}:${candidate.sourceEntityId ?? candidate.relativePath ?? candidate.content}`; const existing = unique.get(key); if (!existing || candidate.required || candidate.priority > existing.priority) { if (existing) excluded.push({ item: existing, reason: "duplicate", restorable: false }); unique.set(key, candidate); } else excluded.push({ item: candidate, reason: "duplicate", restorable: false }); }
    const required = [...unique.values()].filter((item) => item.required); const included = [...required]; const diagnostics: TaskContextPackage["diagnostics"] = [];
    if (!this.budgets.fits(required, budget)) diagnostics.push({ code: "required-context-over-budget", severity: "error", message: "Required context exceeds the configured budget; delegation is blocked until the budget or approved scope changes." });
    for (const candidate of [...unique.values()].filter((item) => !item.required).sort((left, right) => tierRank(right.tier) - tierRank(left.tier) || right.priority - left.priority)) {
      if (this.budgets.fits([...included, candidate], budget)) included.push(candidate); else excluded.push({ item: candidate, reason: "over-budget", restorable: true });
    }
    return { included, excluded, diagnostics };
  }
}

export class ContextDiagnosticsService {
  validate(packageData: TaskContextPackage): TaskContextPackage["diagnostics"] { const diagnostics = [...packageData.diagnostics]; if (packageData.items.some((item) => secretLike(item.content))) diagnostics.push({ code: "secret-like-context", severity: "error", message: "Secret-like content was detected; the package cannot be delegated." }); if (!packageData.items.some((item) => item.kind === "acceptance-criterion")) diagnostics.push({ code: "missing-criteria", severity: "error", message: "No task-linked acceptance criterion is present." }); return diagnostics.slice(0, 100); }
}

export class TaskContextService {
  private cache = new Map<string, TaskContextPackage>();
  readonly ranker = new ContextRanker(); readonly compressor = new ContextCompressor(); readonly budgets = new ContextBudgetService(); readonly diagnostics = new ContextDiagnosticsService();
  constructor(private readonly collector: ContextCandidateCollector, private readonly persistence: DelegationPersistenceStore) {}

  async build(input: ContextBuildInput): Promise<TaskContextPackage> {
    const started = performance.now(); const budget = this.budgets.resolve(input.budget); const sourceFingerprint = await digest(JSON.stringify({ task: input.task, specificationRevision: input.specification.revision, agent: input.selectedAgentId, budget, pins: [input.pinnedEntityIds, input.pinnedFiles], currentFile: input.currentFile, currentSelection: input.currentSelection })); const cached = this.cache.get(sourceFingerprint);
    if (cached) return TaskContextPackageSchema.parse({ ...cached, metrics: { ...cached.metrics, cacheReuse: true } });
    const candidates = this.ranker.rank(await this.collector.collect(input)); input.signal?.throwIfAborted(); const compressed = this.compressor.compress(candidates, budget);
    const included = compressed.included.map((item) => ContextItemSchema.parse({ ...item, included: true })); const estimatedCharacters = sum(included, "estimatedCharacters"); const estimatedTokens = sum(included, "estimatedTokens"); const snapshot = this.collector.getSnapshot(); if (!snapshot) throw new Error("Intelligence generation unavailable after context collection.");
    const packageData = TaskContextPackageSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), taskId: input.task.id, specificationId: input.specification.id, specificationRevision: input.specification.revision, repositoryState: new RepositoryStateService().fromIntelligence(snapshot), repositoryId: input.specification.repositoryId, branch: snapshot.repository.branch ?? "unknown", baseCommit: snapshot.repository.headCommit ?? "unknown", intelligenceGeneration: snapshot.manifest.generation, selectedAgentId: input.selectedAgentId, objective: input.task.objective, requirements: input.specification.requirements.filter((item) => input.task.requirementIds.includes(item.id)).map((item) => item.description), acceptanceCriteria: input.specification.acceptanceCriteria.filter((item) => input.task.acceptanceCriterionIds.includes(item.id)).map((item) => item.description), constraints: input.specification.constraints, items: included, exclusions: compressed.excluded, budget, estimatedTokens, estimatedCharacters, completeness: compressed.diagnostics.some((item) => item.severity === "error") ? "blocked" : compressed.excluded.length ? "partial" : "complete", diagnostics: [...compressed.diagnostics, { code: "token-estimate", severity: "info", message: "Token counts are conservative character-based estimates, not Copilot billing or tokenizer measurements." }], reviewed: false, createdAt: new Date().toISOString(), contentFingerprint: await digest(JSON.stringify(included.map((item) => [item.id, item.content, item.pinned]))), sourceFingerprint, metrics: { buildDurationMs: performance.now() - started, candidateCount: candidates.length, includedCount: included.length, excludedCount: compressed.excluded.length, compressionRatioEstimate: candidates.length ? compressed.excluded.length / candidates.length : 0, cacheReuse: false } });
    packageData.diagnostics = this.diagnostics.validate(packageData); packageData.completeness = packageData.diagnostics.some((item) => item.severity === "error") ? "blocked" : packageData.completeness;
    this.cache.set(sourceFingerprint, packageData); if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
    await this.persistence.update((state) => ({ ...state, contexts: [...state.contexts.filter((item) => item.taskId !== input.task.id), packageData].slice(-200) })); return packageData;
  }

  get(taskId: string): TaskContextPackage | undefined { return this.persistence.snapshot.contexts.find((item) => item.taskId === taskId); }
  async update(taskId: string, updater: (value: TaskContextPackage) => TaskContextPackage): Promise<TaskContextPackage> { let output: TaskContextPackage | undefined; await this.persistence.update((state) => ({ ...state, contexts: state.contexts.map((item) => { if (item.taskId !== taskId) return item; output = TaskContextPackageSchema.parse({ ...updater(structuredClone(item)), reviewed: false }); return output; }) })); if (!output) throw new Error(`No context package exists for task ${taskId}.`); return output; }
  pin(taskId: string, itemId: string, pinned: boolean): Promise<TaskContextPackage> { return this.update(taskId, (value) => ({ ...value, items: value.items.map((item) => item.id === itemId ? { ...item, pinned } : item), contentFingerprint: `${value.contentFingerprint}:pin:${itemId}:${pinned}` })); }
  remove(taskId: string, itemId: string, overrideRequired = false): Promise<TaskContextPackage> { return this.update(taskId, (value) => { const selected = value.items.find((item) => item.id === itemId); if (!selected) return value; if (selected.required && !overrideRequired) throw new Error("Required context cannot be removed without an explicit warning override."); return { ...value, items: value.items.filter((item) => item.id !== itemId), exclusions: [...value.exclusions, { item: selected, reason: "user-removed" as const, restorable: true }], completeness: selected.required ? "blocked" as const : value.completeness, contentFingerprint: `${value.contentFingerprint}:removed:${itemId}` }; }); }
  restore(taskId: string, itemId: string): Promise<TaskContextPackage> { return this.update(taskId, (value) => { const excluded = value.exclusions.find((entry) => entry.item.id === itemId); if (!excluded) return value; return { ...value, items: [...value.items, { ...excluded.item, included: true }], exclusions: value.exclusions.filter((entry) => entry.item.id !== itemId), contentFingerprint: `${value.contentFingerprint}:restored:${itemId}` }; }); }
  review(taskId: string, fingerprint: string): Promise<TaskContextPackage> { return this.update(taskId, (value) => { if (value.contentFingerprint !== fingerprint) throw new Error("Context fingerprint changed; regenerate and review the current package."); if (value.completeness === "blocked") throw new Error("Blocked context cannot be approved."); return { ...value, reviewed: true }; }); }
  invalidate(taskId: string, reason: string): Promise<TaskContextPackage> { this.cache.clear(); return this.update(taskId, (value) => ({ ...value, reviewed: false, completeness: "blocked", diagnostics: [...value.diagnostics, { code: "context-invalidated", severity: "error" as const, message: reason }].slice(-100) })); }
}

export class ContextPreviewService { preview(packageData: TaskContextPackage): TaskContextPackage { return structuredClone(packageData); } }
export class ContextEngine extends TaskContextService {}

function item(input: Partial<ContextItem> & Pick<ContextItem, "id" | "kind" | "title" | "content" | "reason">): ContextItem { const content = sanitize(input.content); return ContextItemSchema.parse({ tier: "optional", relationshipToTask: "repository evidence", evidenceIds: [], confidence: 1, estimatedCharacters: content.length, estimatedTokens: estimateTokens(content), freshness: "current", priority: 0, pinned: false, required: false, included: true, compression: "structured-summary", ...input, content }); }
function score(value: ContextItem): number { return value.priority + (value.required ? CONTEXT_RANKING_WEIGHTS.required : 0) + (value.pinned ? CONTEXT_RANKING_WEIGHTS.userPin : 0) + value.confidence * CONTEXT_RANKING_WEIGHTS.confidence + Math.ceil(value.estimatedCharacters / 1000) * CONTEXT_RANKING_WEIGHTS.sizePerK + (value.freshness === "stale" ? CONTEXT_RANKING_WEIGHTS.stale : 0); }
function safeFile(file: IntelligenceFileRecord): boolean { return file.classification.included && !file.classification.sensitive && !file.classification.binary && !file.classification.generated; }
function sanitize(value: string): string { return value.replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s]+)/gi, "[REDACTED]"); }
function secretLike(value: string): boolean { return /gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value); }
function estimateTokens(value: string): number { return Math.ceil(value.length / 4); }
function tierRank(value: ContextItem["tier"]): number { return value === "required" ? 3 : value === "supporting" ? 2 : 1; }
function sum<K extends "estimatedTokens" | "estimatedCharacters">(items: ContextItem[], key: K): number { return items.reduce((total, item) => total + item[key], 0); }
async function digest(value: string): Promise<string> { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return `sha256:${Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("")}`; }
