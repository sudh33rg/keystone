import {
  IntelligenceEntityDetailsSchema,
  IntelligenceDiagnosticsRequestSchema,
  IntelligenceDiagnosticsResultSchema,
  IntelligenceNeighborhoodRequestSchema,
  IntelligenceNeighborhoodSchema,
  IntelligenceOverviewSchema,
  IntelligenceSearchRequestSchema,
  IntelligenceSearchResultSchema,
  emptyIntelligenceOverview,
  type IntelligenceDiagnostic,
  type IntelligenceEntityDetails,
  type IntelligenceDiagnosticsRequest,
  type IntelligenceDiagnosticsResult,
  type IntelligenceNeighborhood,
  type IntelligenceOverview,
  type IntelligenceSearchRequest,
  type IntelligenceSearchResult,
  type IntelligenceSnapshot,
  type IntelligenceSymbolRecord,
} from "../../shared/contracts/intelligence";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { ContinuousIntelligenceState } from "./runtime/IntelligenceRuntime";
import {
  AdapterDiagnosticsRequestSchema,
  AdapterDiagnosticsResultSchema,
  TechnologyCoverageRequestSchema,
  TechnologyCoverageResultSchema,
  type AdapterDiagnosticsResult,
  type TechnologyCoverageRequest,
  type TechnologyCoverageResult,
} from "../../shared/contracts/adapters";
import {
  IntelligenceQueryResultSchema,
  QueryCompileRequestSchema,
  QueryExplanationSchema,
  QuerySuggestionRequestSchema,
  QuerySuggestionsResultSchema,
  QueryTemplatesResultSchema,
  UnifiedQueryRequestSchema,
  type IntelligenceQuery,
  type IntelligenceQueryResult,
  type QueryCompilation,
  type QueryExplanation,
} from "../../shared/contracts/query";
import type { CpgQueryService } from "./cpg/CpgQueryService";
import { CompleteQueryEngine } from "./query/QueryEngine";
import { QUERY_TEMPLATES } from "./query/QueryParser";

export class IntelligenceQueryService {
  private readonly complete?: CompleteQueryEngine;
  private readonly recent = new Map<string, IntelligenceQueryResult>();
  constructor(
    private readonly store: IntelligenceSnapshotReader,
    private readonly runtime: { getState(): ContinuousIntelligenceState },
    cpg?: CpgQueryService,
  ) {
    this.complete = cpg ? new CompleteQueryEngine(store, cpg) : undefined;
  }

  compile(raw: unknown): QueryCompilation {
    const request = QueryCompileRequestSchema.parse(raw);
    if (!this.complete)
      return {
        input: request.text,
        parsed: false,
        rule: "query-engine-unavailable",
        diagnostics: [
          {
            code: "query-engine-unavailable",
            severity: "error",
            message: "The complete query engine is not configured.",
          },
        ],
        suggestedTemplates: QUERY_TEMPLATES.slice(0, 10).map((item) => item.template),
      };
    return this.complete.compile(request.text, {
      ...(request.generation ? { generation: request.generation } : {}),
      ...(request.branch ? { branch: request.branch } : {}),
      ...(request.currentFile ? { currentFile: request.currentFile } : {}),
      ...(request.limits ? { limits: request.limits } : {}),
    });
  }

  async unified(
    raw: unknown,
    signal?: AbortSignal,
    queryId?: string,
  ): Promise<IntelligenceQueryResult> {
    const request = UnifiedQueryRequestSchema.parse(raw);
    if (!this.complete)
      return unavailableQueryResult(
        "SEARCH",
        "query-engine-unavailable",
        "The complete query engine is not configured.",
        this.store.getSnapshot(),
      );
    let query: IntelligenceQuery;
    let rule = "structured-query";
    if (request.query) query = request.query;
    else {
      const compilation = this.complete.compile(request.text!, {
        ...(request.currentFile ? { currentFile: request.currentFile } : {}),
      });
      if (!compilation.parsed || !compilation.query)
        return unavailableQueryResult(
          "SEARCH",
          compilation.diagnostics[0]?.code ?? "unsupported-query",
          compilation.diagnostics[0]?.message ?? "The query is unsupported.",
          this.store.getSnapshot(),
          compilation.suggestedTemplates,
        );
      query = compilation.query;
      rule = compilation.rule;
    }
    const result = await this.complete.query(query, signal, rule, queryId);
    this.remember(result);
    return result;
  }

  async execute(query: IntelligenceQuery, signal?: AbortSignal): Promise<IntelligenceQueryResult> {
    return this.unified({ query }, signal);
  }

  async suggestions(raw: unknown, signal?: AbortSignal) {
    const request = QuerySuggestionRequestSchema.parse(raw);
    const snapshot = this.store.getSnapshot();
    const input = request.input.trim();
    const templates = QUERY_TEMPLATES.filter(
      (item) =>
        item.template.toLowerCase().startsWith(input.toLowerCase()) ||
        item.label.toLowerCase().includes(input.toLowerCase()),
    )
      .slice(0, request.limit)
      .map((item) => ({
        value: item.template,
        label: item.label,
        kind: "template" as const,
        detail: item.operation,
      }));
    const entities = input
      ? (
          await this.search(
            {
              query: input,
              limit: request.limit,
              ...(request.entityTypes ? { entityTypes: request.entityTypes } : {}),
            },
            signal,
          )
        ).items.map((item) => ({
          value: item.qualifiedName,
          label: item.name,
          kind: "entity" as const,
          detail: `${item.type} · ${item.relativePath}`,
          entityId: item.id,
        }))
      : [];
    return QuerySuggestionsResultSchema.parse({
      generation: snapshot?.manifest.generation ?? 0,
      items: [...entities, ...templates].slice(0, request.limit),
    });
  }

  templates() {
    return QueryTemplatesResultSchema.parse({ templates: QUERY_TEMPLATES });
  }
  explanation(queryId: string): QueryExplanation | undefined {
    const value = this.recent.get(queryId)?.explanation;
    return value ? QueryExplanationSchema.parse(value) : undefined;
  }
  queryMetrics() {
    return this.complete?.metrics() ?? { queryCount: 0, averageLatencyMs: 0, cacheEntries: 0 };
  }
  private remember(result: IntelligenceQueryResult): void {
    this.recent.set(result.queryId, result);
    while (this.recent.size > 100) this.recent.delete(this.recent.keys().next().value as string);
  }

  async overview(): Promise<IntelligenceOverview> {
    const runtime = this.runtime.getState();
    if (!this.store.isStorageAvailable()) {
      const overview = emptyIntelligenceOverview("storage-unavailable", false);
      overview.runtime = runtimeOverview(runtime);
      return overview;
    }
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      const overview = emptyIntelligenceOverview(runtime.status, runtime.pendingUpdate);
      overview.runtime = runtimeOverview(runtime);
      if (runtime.error) {
        const item: IntelligenceDiagnostic = {
          code: runtime.error.code,
          severity: "error",
          message: runtime.error.message,
        };
        overview.diagnostics = { total: 1, truncated: false, items: [item] };
        overview.counts.diagnostics = 1;
      }
      return IntelligenceOverviewSchema.parse(overview);
    }

    const runtimeDiagnostics: IntelligenceDiagnostic[] = runtime.error
      ? [{ code: runtime.error.code, severity: "warning", message: runtime.error.message }]
      : [];
    const allDiagnostics = [...runtimeDiagnostics, ...snapshot.diagnostics];
    const items = allDiagnostics.slice(0, 20);
    let excluded = 0;
    let sensitive = 0;
    const includedFiles = [];
    for (let index = 0; index < snapshot.files.length; index++) {
      const file = snapshot.files[index];
      if (!file) continue;
      if (file.classification.included) includedFiles.push(file);
      else excluded += 1;
      if (file.classification.sensitive) sensitive += 1;
      if ((index + 1) % 500 === 0) await yieldToHost();
    }
    const [languages, categories, symbolTypes, relationshipTypes, confidence] = await Promise.all([
      countBy(includedFiles, (file) => file.language),
      countBy(snapshot.files, (file) => file.category),
      countBy(snapshot.symbols, (symbol) => symbol.type),
      countBy(snapshot.relationships, (relationship) => relationship.type),
      countBy(snapshot.relationships, (relationship) => confidenceBucket(relationship.confidence)),
    ]);
    const cpg = this.store.getCpgManifest?.();
    const adapterState = this.store.getAdapterState?.();
    return IntelligenceOverviewSchema.parse({
      status: runtime.status,
      pendingUpdate: runtime.pendingUpdate,
      generation: snapshot.manifest.generation,
      repository: {
        id: snapshot.repository.id,
        displayName: snapshot.repository.displayName,
        workspaceRoots: snapshot.repository.workspaceRoots.map((root) => ({
          id: root.id,
          name: root.name,
        })),
        ...(snapshot.repository.branch ? { branch: snapshot.repository.branch } : {}),
        ...(snapshot.repository.headCommit ? { headCommit: snapshot.repository.headCommit } : {}),
      },
      updatedAt: snapshot.manifest.completedAt,
      runtime: {
        phase: runtime.phase,
        queueDepth: runtime.queueDepth,
        activeWorkers: runtime.activeWorkers,
        workerCapacity: runtime.workerCapacity,
        pendingFiles: runtime.pendingFiles,
        completedJobs: runtime.completedJobs,
        failedJobs: runtime.failedJobs,
        staleResultsDiscarded: runtime.staleResultsDiscarded,
        workerRestarts: runtime.workerRestarts,
        throughputFilesPerSecond: runtime.throughputFilesPerSecond,
        currentFiles: runtime.currentFiles,
        health: runtime.health,
        ...(runtime.healthMessage ? { healthMessage: runtime.healthMessage } : {}),
        ...(runtime.error ? { error: runtime.error } : {}),
        ...(runtime.trigger ? { trigger: runtime.trigger } : {}),
        ...(runtime.progress ? { progress: runtime.progress } : {}),
      },
      counts: {
        files: snapshot.files.length,
        symbols: snapshot.symbols.length,
        relationships: snapshot.relationships.length,
        evidence: snapshot.evidence.length,
        packages: countType(snapshot, "keystone.core.Package"),
        tests: snapshot.symbols.filter(
          (item) =>
            item.type === "keystone.core.TestSuite" || item.type === "keystone.core.TestCase",
        ).length,
        routes: snapshot.symbols.filter(
          (item) =>
            item.type === "keystone.core.Route" ||
            item.type === "keystone.core.Endpoint" ||
            item.type === "keystone.core.Command",
        ).length,
        externalDependencies: countType(snapshot, "keystone.core.ExternalDependency"),
        parseFailures: snapshot.diagnostics.filter((item) => item.code === "parse-failure").length,
        unresolvedReferences: snapshot.diagnostics.filter(
          (item) => item.code.startsWith("unresolved-") || item.code === "ambiguous-symbol",
        ).length,
        excluded,
        sensitive,
        diagnostics: allDiagnostics.length,
      },
      languages,
      categories,
      symbolTypes,
      relationshipTypes,
      confidence,
      ...(adapterState
        ? {
            technologyCoverage: adapterState.coverage.slice(0, 20).map((item) => ({
              technologyId: item.technologyId,
              adapterId: item.adapterId,
              capabilityLevel: item.capabilityLevel,
              filesDiscovered: item.filesDiscovered,
              filesParsed: item.filesParsed,
              filesFailed: item.filesFailed,
              freshness: item.freshness,
            })),
          }
        : {}),
      ...(cpg
        ? {
            cpg: {
              scopes: cpg.scopes.length,
              scopesBuilt: cpg.metrics.scopesBuilt,
              scopesReused: cpg.metrics.scopesReused,
              buildTimeMs: cpg.metrics.buildTimeMs,
              shardBytes: cpg.metrics.shardBytes,
              analysisFailures: cpg.metrics.analysisFailures,
              approximateResults: cpg.metrics.approximateResults,
            },
          }
        : {}),
      diagnostics: {
        total: allDiagnostics.length,
        truncated: allDiagnostics.length > items.length,
        items,
      },
    });
  }

  async search(
    request: IntelligenceSearchRequest,
    signal?: AbortSignal,
  ): Promise<IntelligenceSearchResult> {
    const query = IntelligenceSearchRequestSchema.parse(request);
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return { generation: 0, items: [], total: 0 };
    const needle = query.query.trim().toLowerCase();
    const candidates = [];
    const searchable = allSearchItems(snapshot);
    for (let index = 0; index < searchable.length; index++) {
      const entity = searchable[index];
      if (!entity) continue;
      if ((index + 1) % 500 === 0) {
        throwIfCancelled(signal);
        await yieldToHost();
      }
      if (query.entityTypes?.length && !query.entityTypes.includes(entity.type)) continue;
      if (query.languages?.length && !query.languages.includes(entity.language)) continue;
      const file = snapshot.files.find(
        (item) => item.id === entity.id || item.id === entity.fileId,
      );
      if (
        query.packageIds?.length &&
        (!file?.packageId || !query.packageIds.includes(file.packageId))
      )
        continue;
      if (query.moduleIds?.length && (!file?.moduleId || !query.moduleIds.includes(file.moduleId)))
        continue;
      if (
        !needle ||
        entity.name.toLowerCase().includes(needle) ||
        entity.qualifiedName.toLowerCase().includes(needle) ||
        entity.relativePath.toLowerCase().includes(needle)
      )
        candidates.push(entity);
    }
    candidates.sort(
      (left, right) =>
        rank(left, needle) - rank(right, needle) ||
        left.qualifiedName.localeCompare(right.qualifiedName) ||
        left.id.localeCompare(right.id),
    );
    throwIfCancelled(signal);
    await yieldToHost();
    const offset = parseCursor(query.cursor);
    const items = candidates.slice(offset, offset + query.limit);
    return IntelligenceSearchResultSchema.parse({
      generation: snapshot.manifest.generation,
      items,
      total: candidates.length,
      ...(offset + items.length < candidates.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    });
  }

  async diagnostics(
    raw: IntelligenceDiagnosticsRequest,
    signal?: AbortSignal,
  ): Promise<IntelligenceDiagnosticsResult> {
    const request = IntelligenceDiagnosticsRequestSchema.parse(raw);
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return { generation: 0, items: [], total: 0 };
    const matches: IntelligenceDiagnostic[] = [];
    for (let index = 0; index < snapshot.diagnostics.length; index++) {
      const diagnostic = snapshot.diagnostics[index];
      if (!diagnostic) continue;
      if ((index + 1) % 500 === 0) {
        throwIfCancelled(signal);
        await yieldToHost();
      }
      if (request.codes?.length && !request.codes.includes(diagnostic.code)) continue;
      if (request.codePrefix && !diagnostic.code.startsWith(request.codePrefix)) continue;
      if (request.severities?.length && !request.severities.includes(diagnostic.severity)) continue;
      if (request.relativePath && diagnostic.relativePath !== request.relativePath) continue;
      matches.push(diagnostic);
    }
    const offset = parseCursor(request.cursor);
    const items = matches.slice(offset, offset + request.limit);
    return IntelligenceDiagnosticsResultSchema.parse({
      generation: snapshot.manifest.generation,
      items,
      total: matches.length,
      ...(offset + items.length < matches.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    });
  }

  async entity(id: string, signal?: AbortSignal): Promise<IntelligenceEntityDetails | undefined> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return undefined;
    const entity = snapshot.symbols.find((item) => item.id === id);
    const file = snapshot.files.find((item) => item.id === id);
    if (!entity && !file) return undefined;
    await yieldToHost();
    const subjectId = entity?.id ?? file!.id;
    const incoming = await relationshipViews(snapshot, subjectId, "incoming", signal);
    const outgoing = await relationshipViews(snapshot, subjectId, "outgoing", signal);
    const evidenceIds = new Set([
      ...(entity?.evidenceIds ?? file!.evidenceIds),
      ...incoming.flatMap((item) => item.evidenceIds),
      ...outgoing.flatMap((item) => item.evidenceIds),
    ]);
    const evidence = snapshot.evidence.filter((item) => evidenceIds.has(item.id)).slice(0, 50);
    const diagnostics = snapshot.diagnostics
      .filter(
        (item) => item.entityId === subjectId || item.ownerFileId === (entity?.fileId ?? file!.id),
      )
      .slice(0, 50);
    return IntelligenceEntityDetailsSchema.parse({
      generation: snapshot.manifest.generation,
      entity: entity
        ? {
            ...searchItem(snapshot, entity),
            ...(entity.parentId ? { parentId: entity.parentId } : {}),
            sourceRange: entity.range,
            properties: entityProperties(entity),
          }
        : {
            ...fileSearchItem(file!),
            properties: {
              category: file!.category,
              analysisLevel: file!.analysisLevel,
              parseStatus: file!.parseStatus ?? "not-applicable",
            },
          },
      incoming: incoming.slice(0, 50),
      outgoing: outgoing.slice(0, 50),
      evidence,
      diagnostics,
      truncated: incoming.length > 50 || outgoing.length > 50 || evidenceIds.size > 50,
    });
  }

  async neighborhood(raw: unknown, signal?: AbortSignal): Promise<IntelligenceNeighborhood> {
    const request = IntelligenceNeighborhoodRequestSchema.parse(raw);
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return { generation: 0, nodes: [], relationships: [], truncated: false };
    const itemById = new Map(allSearchItems(snapshot).map((item) => [item.id, item]));
    const selected = new Set(request.ids.filter((id) => itemById.has(id)));
    const relationships: typeof snapshot.relationships = [];
    let frontier = [...selected];
    let truncated = false;
    for (let depth = 0; depth < request.maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      const frontierIds = new Set(frontier);
      for (let index = 0; index < snapshot.relationships.length; index++) {
        const relationship = snapshot.relationships[index];
        if (!relationship) continue;
        if ((index + 1) % 500 === 0) {
          throwIfCancelled(signal);
          await yieldToHost();
        }
        if (
          relationship.confidence < request.minimumConfidence ||
          (request.relationshipTypes?.length &&
            !request.relationshipTypes.includes(relationship.type))
        )
          continue;
        const outgoing = request.direction !== "incoming" && frontierIds.has(relationship.sourceId);
        const incoming = request.direction !== "outgoing" && frontierIds.has(relationship.targetId);
        if (!outgoing && !incoming) continue;
        const target = outgoing ? relationship.targetId : relationship.sourceId;
        const entity = itemById.get(target);
        if (!entity || (request.entityTypes?.length && !request.entityTypes.includes(entity.type)))
          continue;
        if (!relationships.some((item) => item.id === relationship.id))
          relationships.push(relationship);
        if (!selected.has(target)) {
          if (selected.size >= request.maxNodes) {
            truncated = true;
            continue;
          }
          selected.add(target);
          next.push(target);
        }
      }
      frontier = next;
      throwIfCancelled(signal);
      await yieldToHost();
    }
    return IntelligenceNeighborhoodSchema.parse({
      generation: snapshot.manifest.generation,
      nodes: [...selected].flatMap((id) => {
        const entity = itemById.get(id);
        return entity ? [entity] : [];
      }),
      relationships: relationships.slice(0, 300),
      truncated: truncated || relationships.length > 300,
    });
  }

  async technologies(
    raw: TechnologyCoverageRequest,
    signal?: AbortSignal,
  ): Promise<TechnologyCoverageResult> {
    const request = TechnologyCoverageRequestSchema.parse(raw);
    const state = this.store.getAdapterState?.();
    if (!state)
      return {
        generation: this.store.getSnapshot()?.manifest.generation ?? 0,
        items: [],
        detections: [],
        total: 0,
      };
    throwIfCancelled(signal);
    const filtered = state.coverage.filter(
      (item) =>
        (!request.technologyIds?.length || request.technologyIds.includes(item.technologyId)) &&
        (!request.levels?.length || request.levels.includes(item.capabilityLevel)),
    );
    const offset = parseCursor(request.cursor);
    const items = filtered.slice(offset, offset + request.limit);
    await yieldToHost();
    return TechnologyCoverageResultSchema.parse({
      generation: state.generation,
      items,
      detections: state.detections
        .filter((item) => items.some((coverage) => coverage.technologyId === item.technologyId))
        .slice(0, 100),
      total: filtered.length,
      ...(offset + items.length < filtered.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    });
  }

  async adapterDiagnostics(raw: unknown, signal?: AbortSignal): Promise<AdapterDiagnosticsResult> {
    const request = AdapterDiagnosticsRequestSchema.parse(raw);
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return { generation: 0, items: [], total: 0 };
    const filtered = snapshot.diagnostics.filter(
      (item) =>
        item.adapterId &&
        (!request.adapterIds?.length || request.adapterIds.includes(item.adapterId)) &&
        (!request.technologyIds?.length ||
          (item.technologyId && request.technologyIds.includes(item.technologyId))),
    );
    throwIfCancelled(signal);
    const offset = parseCursor(request.cursor);
    const items = filtered.slice(offset, offset + request.limit);
    await yieldToHost();
    return AdapterDiagnosticsResultSchema.parse({
      generation: snapshot.manifest.generation,
      items,
      total: filtered.length,
      ...(offset + items.length < filtered.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    });
  }
}

function unavailableQueryResult(
  operation: IntelligenceQueryResult["operation"],
  code: string,
  message: string,
  snapshot: IntelligenceSnapshot | undefined,
  templates: string[] = [],
): IntelligenceQueryResult {
  return IntelligenceQueryResultSchema.parse({
    queryId: crypto.randomUUID(),
    operation,
    generation: snapshot?.manifest.generation ?? 0,
    repositoryState: {
      repositoryId: snapshot?.repository.id ?? "unavailable",
      ...(snapshot?.repository.branch ? { branch: snapshot.repository.branch } : {}),
      ...(snapshot?.repository.headCommit ? { headCommit: snapshot.repository.headCommit } : {}),
      generation: snapshot?.manifest.generation ?? 0,
    },
    executionTimeMs: 0,
    resolvedSeeds: [],
    plan: {
      operation,
      resolvedSeedIds: [],
      ambiguousCandidateIds: [],
      indexesSelected: [],
      relationshipFamilies: [],
      traversalDirection: "both",
      maximumDepth: 0,
      confidenceThreshold: 0,
      capabilityThresholds: ["deep", "semantic", "structural", "metadata-only", "unsupported"],
      cpgRequired: false,
      resultLimits: {
        results: 25,
        nodes: 100,
        edges: 300,
        paths: 5,
        depth: 3,
        evidence: 30,
        timeBudgetMs: 1000,
      },
      evidenceRequired: true,
      timeBudgetMs: 1000,
    },
    data: {
      kind: "unsupported",
      items: [],
      nodes: [],
      relationships: [],
      paths: [],
      sections: {},
      metrics: {},
    },
    evidence: [],
    diagnostics: [
      {
        code,
        severity: "error",
        message,
        limitation: true,
        ...(templates[0] ? { template: templates[0] } : {}),
      },
    ],
    explanation: {
      parsedAs: "unsupported",
      parserRule: "unsupported",
      indexesUsed: [],
      relationshipFamilies: [],
      confidenceThreshold: 0,
      rankingRules: [],
      truncationReasons: [],
      capabilityBoundaries: [],
      steps: templates.map((item) => `Supported template: ${item}`).slice(0, 20),
    },
    truncated: false,
    cacheState: "bypassed",
  });
}

async function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Promise<Array<{ key: string; count: number }>> {
  const counts = new Map<string, number>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item !== undefined) {
      const value = key(item);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if ((index + 1) % 500 === 0) await yieldToHost();
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ key: value, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, 20);
}

function countType(snapshot: IntelligenceSnapshot, type: string): number {
  return snapshot.symbols.filter((item) => item.type === type).length;
}
function confidenceBucket(value: number): string {
  return value === 1 ? "exact" : value >= 0.8 ? "high" : value >= 0.5 ? "medium" : "candidate";
}
function fileFor(snapshot: IntelligenceSnapshot, fileId: string) {
  return snapshot.files.find((item) => item.id === fileId);
}
function searchItem(snapshot: IntelligenceSnapshot, entity: IntelligenceSymbolRecord) {
  return {
    id: entity.id,
    fileId: entity.fileId,
    type: entity.type,
    name: entity.name,
    qualifiedName: entity.qualifiedName,
    language: entity.language,
    relativePath: fileFor(snapshot, entity.fileId)?.relativePath ?? "",
    ...(entity.signature ? { signature: entity.signature } : {}),
    confidence: entity.confidence,
    generation: entity.generation,
  };
}
function fileSearchItem(file: IntelligenceSnapshot["files"][number]) {
  return {
    id: file.id,
    fileId: file.id,
    type: "keystone.core.File",
    name: file.relativePath.split("/").at(-1) ?? file.relativePath,
    qualifiedName: file.relativePath,
    language: file.language,
    relativePath: file.relativePath,
    confidence: 1,
    generation: file.generation,
  };
}
function allSearchItems(snapshot: IntelligenceSnapshot) {
  return [
    ...snapshot.symbols.map((entity) => searchItem(snapshot, entity)),
    ...snapshot.files.map(fileSearchItem),
  ];
}
function rank(entity: { name: string; qualifiedName: string }, needle: string): number {
  if (!needle) return 2;
  if (entity.qualifiedName.toLowerCase() === needle) return 0;
  if (entity.name.toLowerCase() === needle) return 1;
  return 2;
}
function parseCursor(value: string | undefined): number {
  return value && /^\d+$/.test(value) ? Number(value) : 0;
}

async function relationshipViews(
  snapshot: IntelligenceSnapshot,
  id: string,
  direction: "incoming" | "outgoing",
  signal?: AbortSignal,
) {
  const values = [];
  for (let index = 0; index < snapshot.relationships.length; index++) {
    if ((index + 1) % 500 === 0) {
      throwIfCancelled(signal);
      await yieldToHost();
    }
    const item = snapshot.relationships[index];
    if (!item || !(direction === "incoming" ? item.targetId === id : item.sourceId === id))
      continue;
    const otherId = direction === "incoming" ? item.sourceId : item.targetId;
    const other =
      snapshot.symbols.find((entity) => entity.id === otherId) ??
      snapshot.files.find((file) => file.id === otherId);
    values.push({
      id: item.id,
      type: item.type,
      direction,
      entityId: otherId,
      entityName:
        other && "qualifiedName" in other ? other.qualifiedName : (other?.relativePath ?? otherId),
      confidence: item.confidence,
      derivation: item.derivation,
      evidenceIds: item.evidenceIds.slice(0, 20),
    });
  }
  return values;
}

function entityProperties(
  entity: IntelligenceSymbolRecord,
): Record<string, string | number | boolean | string[]> {
  const values: Record<string, string | number | boolean | string[]> = {
    ...(entity.properties ?? {}),
  };
  for (const key of [
    "visibility",
    "exported",
    "defaultExport",
    "static",
    "async",
    "abstract",
    "readonly",
    "returnType",
    "deprecated",
  ] as const) {
    const value = entity[key];
    if (value !== undefined) values[key] = value;
  }
  if (entity.parameters)
    values.parameters = entity.parameters.map(
      (item) => `${item.name}${item.type ? `: ${item.type}` : ""}`,
    );
  if (entity.typeParameters) values.typeParameters = entity.typeParameters;
  if (entity.codeAnalysis) {
    values.cpgScopeId = entity.codeAnalysis.scopeId;
    values.cpgConfidence = entity.codeAnalysis.confidence;
    values.branchCount = entity.codeAnalysis.branches;
    values.cpgCallCount = entity.codeAnalysis.calls;
    values.readCount = entity.codeAnalysis.reads;
    values.writeCount = entity.codeAnalysis.writes;
    values.unresolvedCallCount = entity.codeAnalysis.unresolvedCalls;
  }
  return values;
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The intelligence query was cancelled.");
  error.name = "AbortError";
  throw error;
}

function runtimeOverview(runtime: ContinuousIntelligenceState): IntelligenceOverview["runtime"] {
  return {
    phase: runtime.phase,
    queueDepth: runtime.queueDepth,
    activeWorkers: runtime.activeWorkers,
    workerCapacity: runtime.workerCapacity,
    pendingFiles: runtime.pendingFiles,
    completedJobs: runtime.completedJobs,
    failedJobs: runtime.failedJobs,
    staleResultsDiscarded: runtime.staleResultsDiscarded,
    workerRestarts: runtime.workerRestarts,
    throughputFilesPerSecond: runtime.throughputFilesPerSecond,
    currentFiles: runtime.currentFiles,
    health: runtime.health,
    ...(runtime.healthMessage ? { healthMessage: runtime.healthMessage } : {}),
    ...(runtime.error ? { error: runtime.error } : {}),
    ...(runtime.trigger ? { trigger: runtime.trigger } : {}),
    ...(runtime.progress ? { progress: runtime.progress } : {}),
  };
}
