import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { JsonStorage } from "../platform/storage/jsonStorage";
import type {
  CodeSymbol,
  ContextPack,
  DeveloperIntent,
  RepoFile,
  RepoIntelligence,
  RepoSkill,
  RouteDecision,
  ServiceNode,
  TestMapping
} from "../domain/types";
import { buildIntentContextPack, type ContextBuildOptions } from "./intentContextBuilder";
import { estimateTokens } from "./tokenEstimator";
import { selectCanonicalContext } from "../intelligence/okf/canonicalContext";

export type ContextOperation =
  | "UNDERSTAND_INTENT"
  | "ANSWER_QUESTION"
  | "PLAN_CHANGE"
  | "IMPLEMENT"
  | "DEBUG"
  | "REVIEW_CHANGE"
  | "SECURITY_ANALYSIS"
  | "PERFORMANCE_ANALYSIS"
  | "EXPLAIN";

export type ContextExpansionLevel = "summary" | "standard" | "full";

export type ContextSourceCategory =
  | "intent"
  | "decisions"
  | "intelligence"
  | "workspace"
  | "changes"
  | "diagnostics"
  | "history";

export type ContextCandidateSourceType =
  | "intent"
  | "decision"
  | "repository-file"
  | "symbol"
  | "test"
  | "api"
  | "service"
  | "intelligence-unit"
  | "intelligence-relationship"
  | "intelligence-flow"
  | "workspace"
  | "change"
  | "diagnostic"
  | "history"
  | "user-context"
  | "bounded-intelligence";

export interface ContextEvidenceReference {
  readonly id?: string;
  readonly entityId?: string;
  readonly relationshipId?: string;
  readonly flowId?: string;
  readonly evidenceId?: string;
  readonly kind: string;
  readonly label: string;
  readonly path?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ContextSourceRevision {
  readonly value: string;
  readonly capturedAt: string;
  readonly source: "okf" | "intelligence" | "file";
}

/** A retrievable unit of context known to Keystone. Bodies are only retained when selected. */
export interface ContextCandidate {
  readonly id: string;
  readonly category: ContextSourceCategory;
  readonly sourceType: ContextCandidateSourceType;
  readonly content?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly priority: number;
  readonly relevance: number;
  readonly estimatedTokenCost: number;
  readonly sourceRevision: ContextSourceRevision;
  readonly confidence?: number;
  readonly evidence: readonly ContextEvidenceReference[];
  readonly expandable: boolean;
}

export interface ContextReference {
  readonly candidateId: string;
  readonly sourceType: ContextCandidateSourceType;
  readonly label: string;
  readonly path?: string;
  readonly reason: string;
  readonly estimatedTokenCost: number;
  readonly sourceRevision: ContextSourceRevision;
}

export interface ContextInventory {
  readonly candidateCount: number;
  readonly candidateIds: readonly string[];
}

export interface ContextPackage {
  readonly id: string;
  readonly intent: DeveloperIntent;
  readonly objective: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly estimatedTransmittedTokens: number;
  /** Stable inventory of everything known to this preparation operation. */
  readonly knownContext: ContextInventory;
  /** Context relevant to the operation before the transmission budget is applied. */
  readonly selectedContext: readonly ContextCandidate[];
  /** Context represented in the generated Copilot prompt/packet. */
  readonly transmittedContext: readonly ContextCandidate[];
  /** Known context retained locally for later retrieval or expansion. */
  readonly retainedContext: readonly ContextCandidate[];
  readonly omittedContext: readonly ContextReference[];
  readonly sourceRevision: ContextSourceRevision;
  readonly evidence: readonly ContextEvidenceReference[];
  readonly allCandidateCount: number;
  readonly createdAt: string;
  readonly contextPackId: string;
}

export interface ContextPackageSummary {
  readonly id: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly estimatedTransmittedTokens: number;
  readonly allCandidateCount: number;
  readonly selectedCandidateCount: number;
  readonly transmittedCandidateCount: number;
  readonly retainedCandidateCount: number;
  readonly omittedContextCount: number;
  readonly sourceRevision: string;
  readonly sourceCounts: readonly ContextSourceCount[];
  readonly candidates: readonly ContextCandidateSummary[];
}

export interface ContextSourceCount {
  readonly category: ContextSourceCategory;
  readonly label: string;
  readonly count: number;
  readonly included: boolean;
}

export interface ContextCandidateSummary {
  readonly id: string;
  readonly category: ContextSourceCategory;
  readonly sourceType: ContextCandidateSourceType;
  readonly label: string;
  readonly path?: string;
  readonly relevance: number;
  readonly estimatedTokenCost: number;
  readonly evidence: readonly ContextEvidenceReference[];
}

export interface ContextFragment {
  readonly contextId: string;
  readonly focus: string;
  readonly level: ContextExpansionLevel;
  readonly candidates: readonly ContextCandidate[];
  readonly estimatedTokens: number;
  readonly content: string;
}

export interface ContextPreparationRequest {
  readonly intent: DeveloperIntent;
  readonly objective: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly intelligence: RepoIntelligence;
  readonly routeDecision: RouteDecision;
  readonly skills: readonly RepoSkill[];
  readonly buildOptions?: ContextBuildOptions;
  readonly sourceRevision?: string;
  readonly decisions?: readonly string[];
  readonly workspace?: ContextWorkspaceState;
  readonly changes?: ContextChangesState;
  readonly diagnostics?: readonly ContextDiagnostic[];
  readonly userContext?: readonly ContextUserContext[];
}

export interface ContextWorkspaceState {
  readonly currentFile?: string;
  readonly languageId?: string;
  readonly selection?: { readonly startLine: number; readonly endLine: number };
  readonly branch?: string;
  readonly statusEntries?: number;
}

export interface ContextChangesState {
  readonly branch?: string;
  readonly status?: string;
  readonly diff?: string;
}

export interface ContextDiagnostic {
  readonly path: string;
  readonly code?: string | number;
  readonly message: string;
  readonly source?: string;
  readonly severity?: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export interface ContextUserContext {
  readonly label: string;
  readonly content: string;
  readonly path?: string;
  readonly source?: string;
}

export interface ContextEngineLogEvent {
  readonly phase: "request" | "candidates-collected" | "package-created" | "expanded";
  readonly message: string;
}

export type ContextEngineLogger = (event: ContextEngineLogEvent) => void;

export interface ContextPreparation {
  readonly contextPack: ContextPack;
  readonly contextPackage: ContextPackage;
}

const PACKAGE_DIRECTORY = ".keystone/context/packages";

/**
 * Orchestrates context preparation over Keystone's existing repository retrieval and
 * ContextPack builder. It does not reason autonomously or call a model.
 */
export class ContextEngine {
  private readonly packages = new Map<string, ContextPackage>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger?: ContextEngineLogger
  ) {}

  async prepareContext(request: ContextPreparationRequest): Promise<ContextPreparation> {
    this.log(
      "request",
      `Context request intent=${request.intent.id} operation=${request.operation} tokenBudget=${request.tokenBudget}.`
    );
    const contextPack = await buildIntentContextPack(
      request.intent,
      request.intelligence,
      request.routeDecision,
      [...request.skills],
      { ...request.buildOptions, delegationTokenBudget: request.tokenBudget }
    );
    const candidates = await collectCandidates(request, contextPack, sourceRevisionFor(request, contextPack));
    const contextPackage = this.createPackage(request, contextPack, candidates);
    this.packages.set(contextPackage.id, contextPackage);
    await this.packageStorage(contextPackage.id).write(contextPackage);
    this.log(
      "candidates-collected",
      `Collected ${contextPackage.allCandidateCount} context candidate(s); ${contextPackage.selectedContext.length} relevant and ${contextPackage.retainedContext.length} retained.`
    );
    this.log(
      "package-created",
      `Context package ${contextPackage.id} created with ${contextPackage.estimatedTransmittedTokens} estimated transmitted token(s).`
    );
    return { contextPack, contextPackage };
  }

  async expandContext(input: {
    contextId: string;
    focus: string;
    level: ContextExpansionLevel;
  }): Promise<ContextFragment> {
    const packageValue = await this.loadPackage(input.contextId);
    if (!packageValue) throw new Error(`Context package ${input.contextId} is not available.`);
    const terms = new Set(
      input.focus
        .toLowerCase()
        .match(/[a-z0-9_./-]+/g)
        ?.filter((term) => term.length > 1) ?? []
    );
    const retained = packageValue.retainedContext.filter((candidate) =>
      matchesFocus(candidate, terms)
    );
    const candidates = (retained.length ? retained : packageValue.retainedContext).slice(
      0,
      expansionLimit(input.level)
    );
    const expanded = await Promise.all(
      candidates.map((candidate) => this.expandCandidate(candidate, input.level))
    );
    const materialized = expanded.filter((candidate): candidate is ContextCandidate =>
      Boolean(candidate)
    );
    const content = materialized.map((candidate) => formatCandidate(candidate)).join("\n\n");
    const fragment: ContextFragment = Object.freeze({
      contextId: packageValue.id,
      focus: input.focus,
      level: input.level,
      candidates: Object.freeze(materialized),
      estimatedTokens: estimateTokens(content),
      content
    });
    this.log(
      "expanded",
      `Expanded context package ${packageValue.id} for focus=${input.focus || "all retained context"} with ${materialized.length} candidate(s).`
    );
    return fragment;
  }

  summarize(contextPackage: ContextPackage): ContextPackageSummary {
    return summarizeContextPackage(contextPackage);
  }

  private createPackage(
    request: ContextPreparationRequest,
    contextPack: ContextPack,
    candidates: readonly ContextCandidate[]
  ): ContextPackage {
    const sourceRevision = makeRevision(
      request.sourceRevision ??
        contextPack.contextManifest?.snapshotDigest ??
        request.intelligence.indexedAt,
      contextPack.contextManifest?.snapshotDigest ? "okf" : "intelligence"
    );
    const frozenCandidates = candidates.map(freezeCandidate);
    const selectedPaths = new Set(contextPack.relevantFiles.map((file) => file.path));
    const transmittedPaths = new Set(
      (contextPack.contextSections ?? []).map((section) => section.path)
    );
    const selectedContext = frozenCandidates.filter((candidate) =>
      isSelectedCandidate(candidate, selectedPaths)
    );
    const transmittedContext = selectedContext.filter(
      (candidate) =>
        candidate.sourceType === "bounded-intelligence" ||
        candidate.category !== "intelligence" ||
        (candidate.payload.path && transmittedPaths.has(String(candidate.payload.path)))
    );
    const retainedContext = frozenCandidates.filter(
      (candidate) => !transmittedContext.some((selected) => selected.id === candidate.id)
    );
    const omittedByBuilder = new Map(
      (contextPack.omittedContext ?? []).map((item) => [item.path, item])
    );
    const omittedContext = retainedContext.map((candidate) => {
      const pathValue = candidate.payload.path ? String(candidate.payload.path) : undefined;
      const omitted = pathValue ? omittedByBuilder.get(pathValue) : undefined;
      return {
        candidateId: candidate.id,
        sourceType: candidate.sourceType,
        label: pathValue ?? String(candidate.payload.label ?? candidate.id),
        ...(pathValue ? { path: pathValue } : {}),
        reason:
          omitted?.reason ??
          (candidate.sourceType === "bounded-intelligence"
            ? "Retained canonical intelligence digest for later expansion."
            : "Known to Keystone but outside the transmitted context budget or relevance selection."),
        estimatedTokenCost: candidate.estimatedTokenCost,
        sourceRevision: candidate.sourceRevision
      } satisfies ContextReference;
    });
    const evidence = dedupeEvidence(transmittedContext.flatMap((candidate) => candidate.evidence));
    const estimatedTransmittedTokens =
      contextPack.contextManifest?.usedTokens ?? contextPack.estimatedPackedTokens;
    return Object.freeze({
      id: contextPack.id,
      intent: Object.freeze({ ...request.intent }),
      objective: request.objective,
      operation: request.operation,
      tokenBudget: request.tokenBudget,
      estimatedTransmittedTokens,
      knownContext: Object.freeze({
        candidateCount: frozenCandidates.length,
        candidateIds: Object.freeze(frozenCandidates.map((candidate) => candidate.id))
      }),
      selectedContext: Object.freeze(selectedContext),
      transmittedContext: Object.freeze(transmittedContext),
      retainedContext: Object.freeze(retainedContext),
      omittedContext: Object.freeze(omittedContext.map((reference) => Object.freeze(reference))),
      sourceRevision: Object.freeze(sourceRevision),
      evidence: Object.freeze(evidence),
      allCandidateCount: frozenCandidates.length,
      createdAt: new Date().toISOString(),
      contextPackId: contextPack.id
    });
  }

  private async loadPackage(contextId: string): Promise<ContextPackage | undefined> {
    const packageId = contextId.split(":packet:")[0];
    const inMemory = this.packages.get(packageId);
    if (inMemory) return inMemory;
    const value = await this.packageStorage(packageId).read();
    if (value) this.packages.set(packageId, value);
    return value;
  }

  private async expandCandidate(
    candidate: ContextCandidate,
    level: ContextExpansionLevel
  ): Promise<ContextCandidate | undefined> {
    if (candidate.content) return trimCandidate(candidate, level);
    const pathValue = candidate.payload.path;
    if (typeof pathValue !== "string") return trimCandidate(candidate, level);
    const content = await readSafe(this.workspaceRoot, pathValue);
    if (!content) return candidate;
    return trimCandidate({ ...candidate, content }, level);
  }

  private packageStorage(id: string): JsonStorage<ContextPackage | undefined> {
    return new JsonStorage<ContextPackage | undefined>(
      this.workspaceRoot,
      `${PACKAGE_DIRECTORY}/${safeId(id)}.json`,
      undefined
    );
  }

  private log(phase: ContextEngineLogEvent["phase"], message: string): void {
    this.logger?.({ phase, message });
  }
}

export function summarizeContextPackage(contextPackage: ContextPackage): ContextPackageSummary {
  const labels: Record<ContextSourceCategory, string> = {
    intent: "Intent",
    decisions: "Decisions",
    intelligence: "Intelligence",
    workspace: "Workspace",
    changes: "Changes",
    diagnostics: "Diagnostics",
    history: "History"
  };
  const sourceCounts = (Object.keys(labels) as ContextSourceCategory[]).map((category) => {
    const count = contextPackage.knownContext.candidateIds.filter((id) =>
      contextPackage.selectedContext.some(
        (candidate) => candidate.id === id && candidate.category === category
      )
    ).length;
    return {
      category,
      label: labels[category],
      count,
      included: count > 0
    } satisfies ContextSourceCount;
  });
  return {
    id: contextPackage.id,
    operation: contextPackage.operation,
    tokenBudget: contextPackage.tokenBudget,
    estimatedTransmittedTokens: contextPackage.estimatedTransmittedTokens,
    allCandidateCount: contextPackage.allCandidateCount,
    selectedCandidateCount: contextPackage.selectedContext.length,
    transmittedCandidateCount: contextPackage.transmittedContext.length,
    retainedCandidateCount: contextPackage.retainedContext.length,
    omittedContextCount: contextPackage.omittedContext.length,
    sourceRevision: contextPackage.sourceRevision.value,
    sourceCounts,
    candidates: contextPackage.selectedContext.slice(0, 32).map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      sourceType: candidate.sourceType,
      label: String(candidate.payload.label ?? candidate.payload.path ?? candidate.id),
      ...(typeof candidate.payload.path === "string" ? { path: candidate.payload.path } : {}),
      relevance: candidate.relevance,
      estimatedTokenCost: candidate.estimatedTokenCost,
      evidence: candidate.evidence.slice(0, 6)
    }))
  };
}

export function operationForIntentType(intentType: string): ContextOperation {
  switch (intentType) {
    case "feature":
    case "test":
      return "IMPLEMENT";
    case "bugfix":
      return "DEBUG";
    case "refactor":
    case "modernization":
      return "PLAN_CHANGE";
    case "security-review":
      return "SECURITY_ANALYSIS";
    case "performance-review":
      return "PERFORMANCE_ANALYSIS";
    case "pr-summary":
      return "REVIEW_CHANGE";
    case "qa-analysis":
      return "ANSWER_QUESTION";
    case "explain":
      return "EXPLAIN";
    default:
      return "UNDERSTAND_INTENT";
  }
}

async function collectCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): Promise<ContextCandidate[]> {
  const { intelligence } = request;
  const candidates = new Map<string, ContextCandidate>();
  const add = (candidate: ContextCandidate): void => {
    const existing = candidates.get(candidate.id);
    if (!existing || candidate.content || candidate.relevance > existing.relevance)
      candidates.set(candidate.id, candidate);
  };
  const selectedSections = new Map(
    (contextPack.contextSections ?? []).map((section) => [section.path, section])
  );
  for (const candidate of intentCandidates(request, contextPack, sourceRevision)) add(candidate);
  for (const candidate of decisionCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of workspaceCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of changeCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of diagnosticCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of userContextCandidates(request, contextPack, sourceRevision)) add(candidate);
  const selectedPaths = new Set(contextPack.relevantFiles.map((file) => file.path));
  const selectedFiles = intelligence.files.filter((file) => selectedPaths.has(file.path));
  for (const file of selectedFiles) {
    const section = selectedSections.get(file.path);
    add(fileCandidate(file, sourceRevision, section));
  }
  for (const symbol of contextPack.relevantSymbols) add(symbolCandidate(symbol, sourceRevision));
  for (const test of contextPack.relatedTests) add(testCandidate(test, sourceRevision));
  for (const api of contextPack.relatedApis) add(apiCandidate(api, sourceRevision));
  for (const service of contextPack.impactedServices) add(serviceCandidate(service, sourceRevision));
  for (const candidate of intelligenceCandidates(request, contextPack, sourceRevision)) add(candidate);
  if (contextPack.boundedIntelligence)
    add({
      id: stableId("bounded-intelligence", contextPack.id),
      category: "intelligence",
      sourceType: "bounded-intelligence",
      content: contextPack.boundedIntelligence,
      payload: { label: "Bounded OKF and graph intelligence" },
      priority: 1,
      relevance: 1,
      estimatedTokenCost: estimateTokens(contextPack.boundedIntelligence),
      sourceRevision,
      confidence: 1,
      evidence: [],
      expandable: true
    });
  for (const candidate of await historyCandidates(request.intent.workspaceRoot, sourceRevision)) add(candidate);
  return [...candidates.values()];
}

function intentCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const result: ContextCandidate[] = [
    basicCandidate("intent", "intent", request.intent.id, "Intent", request.intent.text, request.intent.text, sourceRevision, 1, 1),
    basicCandidate("intent", "objective", request.objective, "Objective", request.objective, request.objective, sourceRevision, 0.98, 0.98)
  ];
  const requirements = [
    ...contextPack.acceptanceCriteria,
    ...contextPack.architectureConstraints,
    ...contextPack.securityConstraints,
    ...contextPack.performanceConstraints,
    ...contextPack.modernizationConstraints,
    ...contextPack.thingsToAvoid,
    request.buildOptions?.codingStandards,
    request.buildOptions?.thingsToAvoid
  ].filter((value): value is string => Boolean(value?.trim()));
  requirements.forEach((content, index) =>
    result.push(
      basicCandidate("intent", `requirement-${index}`, content, "Requirement", content, content, sourceRevision, 0.9, 0.85)
    )
  );
  return result;
}

function decisionCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  return (request.decisions ?? []).filter((decision) => decision.trim()).map((decision, index) =>
    basicCandidate("decisions", `decision-${index}`, decision, "Accepted decision", decision, decision, sourceRevision, 0.86, 0.8)
  );
}

function workspaceCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const workspace = request.workspace;
  if (!workspace) return [];
  const label = workspace.currentFile ? `Active file: ${workspace.currentFile}` : "Workspace state";
  return [
    basicCandidate(
      "workspace",
      "workspace-state",
      label,
      "Workspace state",
      undefined,
      JSON.stringify(workspace),
      sourceRevision,
      0.78,
      0.65,
      workspace.currentFile
    )
  ];
}

function changeCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const changes = request.changes;
  if (!changes) return [];
  const paths = parseChangedPaths(changes.status ?? "", changes.diff ?? "");
  if (!paths.length && !changes.branch) return [];
  const summary = {
    branch: changes.branch,
    changedPaths: paths,
    diffBytes: changes.diff ? Buffer.byteLength(changes.diff, "utf8") : 0,
    diffHash: changes.diff ? crypto.createHash("sha256").update(changes.diff).digest("hex") : undefined
  };
  return [
    basicCandidate("changes", "workspace-changes", "Current workspace changes", "Workspace changes", undefined, JSON.stringify(summary), sourceRevision, 0.8, 0.7),
    ...paths.slice(0, 24).map((filePath) => basicCandidate("changes", `change-${filePath}`, filePath, "Changed file", undefined, JSON.stringify({ path: filePath, branch: changes.branch }), sourceRevision, 0.74, 0.62, filePath))
  ];
}

function diagnosticCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  return (request.diagnostics ?? []).map((diagnostic, index) => {
    const location = diagnostic.startLine === undefined ? "" : `:${diagnostic.startLine + 1}`;
    const label = `${diagnostic.code ?? "diagnostic"} ${diagnostic.path}${location}`;
    return basicCandidate("diagnostics", `diagnostic-${index}-${diagnostic.path}`, label, "Diagnostic", diagnostic.message, JSON.stringify(diagnostic), sourceRevision, 0.88, 0.76, diagnostic.path, diagnostic);
  });
}

function userContextCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const supplied = request.userContext ?? [];
  const skills = contextPack.repoSkills.flatMap((skill) => skill.guidance.map((guidance) => ({ label: skill.name, content: guidance })));
  return [...supplied, ...skills].filter((value) => value.content.trim()).slice(0, 40).map((value, index) =>
    basicCandidate("workspace", `user-context-${index}`, value.label, "Repository guidance", value.content, JSON.stringify(value), sourceRevision, 0.72, 0.62, "path" in value ? value.path : undefined)
  );
}

function intelligenceCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const paths = new Set(contextPack.relevantFiles.map((file) => file.path));
  const canonical = request.buildOptions?.okfSnapshot
    ? selectCanonicalContext(request.buildOptions.okfSnapshot, `${request.intent.text}\n${request.objective}`, {
        preferredPaths: [...paths].slice(0, 24)
      })
    : undefined;
  const result: ContextCandidate[] = [];
  for (const item of canonical?.query.items ?? []) {
    if (!item.path || !paths.has(item.path)) continue;
    result.push({
      id: stableId("intelligence-unit", item.id),
      category: "intelligence",
      sourceType: "intelligence-unit",
      payload: { label: item.label, path: item.path, entityId: item.id, kind: item.kind, summary: item.summary },
      priority: 0.76,
      relevance: 0.68,
      estimatedTokenCost: estimateTokens(item.summary ?? item.label),
      sourceRevision,
      confidence: item.score,
      evidence: [{ kind: item.kind, label: item.label, path: item.path, entityId: item.id, evidenceId: item.id }],
      expandable: true
    });
  }
  if (canonical) {
    const nodes = new Map(canonical.graph.nodes.map((node) => [node.id, node]));
    for (const edge of canonical.graph.edges) {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      const edgePaths = [source?.path, target?.path].filter(
        (value): value is string => Boolean(value)
      );
      if (!edgePaths.some((value) => paths.has(value))) continue;
      const isFlow = canonical.graph.mode === "flows" || /flow|call|read|write|map/i.test(edge.kind);
      result.push({
        id: stableId(isFlow ? "intelligence-flow" : "intelligence-relationship", edge.id),
        category: "intelligence",
        sourceType: isFlow ? "intelligence-flow" : "intelligence-relationship",
        payload: {
          label: edge.kind,
          relationshipId: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          sourceLabel: source?.label,
          targetLabel: target?.label,
          sourcePath: source?.path,
          targetPath: target?.path
        },
        priority: isFlow ? 0.74 : 0.7,
        relevance: isFlow ? 0.66 : 0.6,
        estimatedTokenCost: estimateTokens(JSON.stringify(edge)),
        sourceRevision,
        confidence: edge.confidence,
        evidence: edge.evidenceIds.map((evidenceId) => ({
          kind: isFlow ? "flow" : "relationship",
          label: edge.kind,
          relationshipId: edge.id,
          evidenceId
        })),
        expandable: true
      });
    }
  }
  const selectedPaths = new Set(paths);
  for (const relation of request.intelligence.semanticRelationships ?? []) {
    const relationPaths = [relation.sourcePath, relation.targetPath].filter((value): value is string => Boolean(value));
    if (!relationPaths.some((value) => selectedPaths.has(value))) continue;
    const relationshipId = stableId("relationship", JSON.stringify(relation));
    result.push({
      id: relationshipId,
      category: "intelligence",
      sourceType: "intelligence-relationship",
      payload: { label: relation.kind, relationshipId, sourcePath: relation.sourcePath, targetPath: relation.targetPath, summary: `${relation.sourceName} ${relation.kind} ${relation.targetName}` },
      priority: 0.68,
      relevance: 0.58,
      estimatedTokenCost: estimateTokens(JSON.stringify(relation)),
      sourceRevision,
      confidence: relation.confidence,
      evidence: [{ kind: "relationship", label: relation.kind, relationshipId }],
      expandable: true
    });
  }
  return result.slice(0, 80);
}

function basicCandidate(
  category: ContextSourceCategory,
  seed: string,
  label: string,
  sourceType: string,
  content: string | undefined,
  payloadText: string,
  sourceRevision: ContextSourceRevision,
  priority: number,
  relevance: number,
  pathValue?: string,
  diagnostic?: ContextDiagnostic
): ContextCandidate {
  const source = category === "intent" ? "intent" : category === "decisions" ? "decision" : category === "workspace" ? (sourceType === "Repository guidance" ? "user-context" : "workspace") : category === "changes" ? "change" : category === "diagnostics" ? "diagnostic" : "history";
  const evidence: ContextEvidenceReference[] = [{ kind: sourceType, label, ...(pathValue ? { path: pathValue } : {}) }];
  if (diagnostic?.code !== undefined) evidence[0] = { ...evidence[0], id: String(diagnostic.code), startLine: diagnostic.startLine, endLine: diagnostic.endLine };
  return {
    id: stableId(source, seed),
    category,
    sourceType: source as ContextCandidateSourceType,
    ...(content ? { content } : {}),
    payload: { label, value: payloadText, ...(pathValue ? { path: pathValue } : {}), ...(diagnostic ? { diagnostic } : {}) },
    priority,
    relevance,
    estimatedTokenCost: estimateTokens(content ?? payloadText),
    sourceRevision,
    confidence: 1,
    evidence,
    expandable: Boolean(pathValue)
  };
}

function fileCandidate(
  file: RepoFile,
  sourceRevision: ContextSourceRevision,
  section?: NonNullable<ContextPack["contextSections"]>[number]
): ContextCandidate {
  const sectionScore = section?.score ?? 0;
  const sectionEvidence: ContextEvidenceReference[] = (section?.evidence ?? []).map((item) => ({
    ...(item.okfId ? { id: item.okfId, entityId: item.okfId } : {}),
    kind: item.kind,
    label: item.label,
    path: file.path,
    ...(item.startLine !== undefined ? { startLine: item.startLine } : {}),
    ...(item.endLine !== undefined ? { endLine: item.endLine } : {})
  }));
  const fileEvidence: ContextEvidenceReference[] = file.evidence
    ? [
        {
          kind: file.evidence.source,
          label: file.path,
          path: file.path,
          ...(file.evidence.evidenceLine ? { startLine: file.evidence.evidenceLine } : {})
        },
        ...sectionEvidence
      ]
    : sectionEvidence.length
      ? sectionEvidence
      : [{ kind: "file", label: file.path, path: file.path }];
  return {
    id: stableId("repository-file", file.path),
    category: "intelligence",
    sourceType: "repository-file",
    ...(section ? { content: section.content } : {}),
    payload: {
      path: file.path,
      language: file.language,
      summary: file.summary,
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount
    },
    priority: file.isTest ? 0.55 : file.isGenerated ? 0.15 : 0.65,
    relevance: section ? Math.min(1, 0.55 + Math.max(0, sectionScore) / 20) : 0,
    estimatedTokenCost: section?.estimatedTokens ?? Math.max(1, estimateTokens(file.summary)),
    sourceRevision: file.contentHash ? makeRevision(file.contentHash, "file") : sourceRevision,
    confidence: file.evidence?.confidence,
    evidence: fileEvidence,
    expandable: true
  };
}

function symbolCandidate(
  symbol: CodeSymbol,
  sourceRevision: ContextSourceRevision
): ContextCandidate {
  return {
    id: stableId("symbol", `${symbol.filePath}:${symbol.line}:${symbol.name}`),
    category: "intelligence",
    sourceType: "symbol",
    payload: { label: symbol.name, path: symbol.filePath, line: symbol.line, kind: symbol.kind },
    priority: 0.7,
    relevance: 0.35,
    estimatedTokenCost: estimateTokens(JSON.stringify(symbol)),
    sourceRevision,
    confidence: symbol.evidence?.confidence,
    evidence: [
      { kind: symbol.kind, label: symbol.name, path: symbol.filePath, startLine: symbol.line }
    ],
    expandable: true
  };
}

function testCandidate(test: TestMapping, sourceRevision: ContextSourceRevision): ContextCandidate {
  return {
    id: stableId("test", `${test.testFile}:${test.targetFile ?? ""}`),
    category: "intelligence",
    sourceType: "test",
    payload: {
      label: test.testFile,
      path: test.testFile,
      targetFile: test.targetFile,
      reason: test.reason
    },
    priority: 0.6,
    relevance: test.targetFile ? 0.55 : 0.25,
    estimatedTokenCost: estimateTokens(JSON.stringify(test)),
    sourceRevision,
    confidence: test.confidence,
    evidence: [{ kind: "test", label: test.testFile, path: test.testFile }],
    expandable: true
  };
}

function apiCandidate(
  api: RepoIntelligence["apis"][number],
  sourceRevision: ContextSourceRevision
): ContextCandidate {
  return {
    id: stableId("api", `${api.filePath}:${api.line}:${api.method}:${api.path}`),
    category: "intelligence",
    sourceType: "api",
    payload: { label: `${api.method} ${api.path}`, path: api.filePath, line: api.line },
    priority: 0.65,
    relevance: 0.45,
    estimatedTokenCost: estimateTokens(JSON.stringify(api)),
    sourceRevision,
    evidence: [
      { kind: "api", label: `${api.method} ${api.path}`, path: api.filePath, startLine: api.line }
    ],
    expandable: true
  };
}

function serviceCandidate(
  service: ServiceNode,
  sourceRevision: ContextSourceRevision
): ContextCandidate {
  return {
    id: stableId("service", `${service.filePath}:${service.name}`),
    category: "intelligence",
    sourceType: "service",
    payload: { label: service.name, path: service.filePath, hints: service.hints },
    priority: 0.6,
    relevance: 0.4,
    estimatedTokenCost: estimateTokens(JSON.stringify(service)),
    sourceRevision,
    evidence: [{ kind: "service", label: service.name, path: service.filePath }],
    expandable: true
  };
}

function matchesFocus(candidate: ContextCandidate, terms: ReadonlySet<string>): boolean {
  if (!terms.size) return true;
  const searchable = [
    candidate.id,
    candidate.sourceType,
    candidate.content ?? "",
    ...Object.values(candidate.payload).map((value) => String(value))
  ]
    .join(" ")
    .toLowerCase();
  return [...terms].some((term) => searchable.includes(term));
}

function trimCandidate(
  candidate: ContextCandidate,
  level: ContextExpansionLevel
): ContextCandidate {
  if (!candidate.content) return candidate;
  const limit = level === "summary" ? 800 : level === "standard" ? 3_000 : 12_000;
  return { ...candidate, content: truncate(candidate.content, limit) };
}

function formatCandidate(candidate: ContextCandidate): string {
  const label = String(candidate.payload.path ?? candidate.payload.label ?? candidate.id);
  return `## ${label}\nSource: ${candidate.sourceType}\n\n${candidate.content ?? JSON.stringify(candidate.payload, null, 2)}`;
}

function expansionLimit(level: ContextExpansionLevel): number {
  return level === "summary" ? 1 : level === "standard" ? 6 : 16;
}

function makeRevision(
  value: string,
  source: ContextSourceRevision["source"]
): ContextSourceRevision {
  return { value, source, capturedAt: new Date().toISOString() };
}

function summarizeEvidence(reference: ContextEvidenceReference): string {
  return `${reference.id ?? ""}|${reference.kind}|${reference.label}|${reference.path ?? ""}|${reference.startLine ?? ""}`;
}

function dedupeEvidence(values: readonly ContextEvidenceReference[]): ContextEvidenceReference[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = summarizeEvidence(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceRevisionFor(
  request: ContextPreparationRequest,
  contextPack: ContextPack
): ContextSourceRevision {
  return makeRevision(
    request.sourceRevision ??
      contextPack.contextManifest?.snapshotDigest ??
      request.intelligence.indexedAt,
    contextPack.contextManifest?.snapshotDigest ? "okf" : "intelligence"
  );
}

function isSelectedCandidate(
  candidate: ContextCandidate,
  selectedPaths: ReadonlySet<string>
): boolean {
  if (candidate.category !== "intelligence") return true;
  if (candidate.sourceType === "bounded-intelligence") return true;
  const pathValue = candidate.payload.path;
  return typeof pathValue === "string" && selectedPaths.has(pathValue);
}

function parseChangedPaths(status: string, diff: string): string[] {
  const statusPaths = status
    .split(/\r?\n/)
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .map((value) => (value.includes(" -> ") ? value.split(" -> ").at(-1)! : value));
  const diffPaths = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice(6).trim())
    .filter((value) => value && value !== "/dev/null");
  return [...new Set([...statusPaths, ...diffPaths])].slice(0, 48);
}

async function historyCandidates(
  workspaceRoot: string,
  sourceRevision: ContextSourceRevision
): Promise<ContextCandidate[]> {
  const result: ContextCandidate[] = [];
  const evaluations = await readJsonSafe(workspaceRoot, ".keystone/context/evaluations.json");
  if (Array.isArray(evaluations)) {
    for (const [index, value] of evaluations.slice(-5).entries()) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      result.push(
        basicCandidate(
          "history",
          `evaluation-${index}-${String(entry.timestamp ?? index)}`,
          "Previous context evaluation",
          "History",
          undefined,
          JSON.stringify({
            timestamp: entry.timestamp,
            intentHash: entry.intentHash,
            tokens: entry.tokens,
            retrieval: entry.retrieval
          }),
          sourceRevision,
          0.42,
          0.3
        )
      );
    }
  }
  const resultRoot = path.join(workspaceRoot, ".keystone", "copilot", "results");
  for (const file of (await fs.readdir(resultRoot).catch(() => [])).slice(-3)) {
    if (!file.endsWith(".json")) continue;
    const value = await readJsonSafe(workspaceRoot, `.keystone/copilot/results/${file}`);
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    result.push(
      basicCandidate(
        "history",
        `copilot-${file}`,
        "Previous Copilot interaction",
        "History",
        undefined,
        JSON.stringify({
          artifact: `.keystone/copilot/results/${file}`,
          mode: entry.mode,
          status: entry.status,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt
        }),
        sourceRevision,
        0.46,
        0.34,
        `.keystone/copilot/results/${file}`
      )
    );
  }
  const activity = await readJsonSafe(workspaceRoot, ".keystone/intelligence/activity.json");
  if (Array.isArray(activity)) {
    for (const [index, value] of activity
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .filter((entry) => /context|intent|copilot/i.test(String(entry.type ?? entry.message ?? "")))
      .slice(-5)
      .entries()) {
      result.push(
        basicCandidate(
          "history",
          `activity-${index}-${String(value.timestamp ?? index)}`,
          "Keystone activity",
          "History",
          undefined,
          JSON.stringify({ type: value.type, timestamp: value.timestamp, message: value.message }),
          sourceRevision,
          0.38,
          0.26
        )
      );
    }
  }
  return result;
}

async function readJsonSafe(root: string, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relative), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function stableId(type: string, value: string): string {
  return `ctx-${type}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readSafe(root: string, relative: string): Promise<string> {
  try {
    const target = path.resolve(root, relative);
    const safeRoot = `${path.resolve(root)}${path.sep}`;
    if (!target.startsWith(safeRoot)) return "";
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}

function truncate(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, maxCharacters).trim()}\n… context fragment truncated …`;
}

function freezeCandidate(candidate: ContextCandidate): ContextCandidate {
  return Object.freeze({
    ...candidate,
    payload: Object.freeze({ ...candidate.payload }),
    evidence: Object.freeze(candidate.evidence.map((reference) => Object.freeze({ ...reference }))),
    sourceRevision: Object.freeze({ ...candidate.sourceRevision })
  });
}
