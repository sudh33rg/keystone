import { z } from "zod";

export const INTELLIGENCE_SCHEMA_VERSION = 1 as const;

export const IntelligenceStatusSchema = z.enum([
  "not-indexed",
  "scanning",
  "ready",
  "partial",
  "failed",
  "storage-unavailable",
]);
export type IntelligenceStatus = z.infer<typeof IntelligenceStatusSchema>;

export const IntelligenceRuntimePhaseSchema = z.enum([
  "ready",
  "stale",
  "reconciling",
  "rebuilding",
  "recovering",
  "failed",
  "paused",
]);
export type IntelligenceRuntimePhase = z.infer<typeof IntelligenceRuntimePhaseSchema>;

export const FileCategorySchema = z.enum([
  "source",
  "test",
  "configuration",
  "manifest",
  "documentation",
  "schema",
  "migration",
  "infrastructure",
  "ci",
  "asset",
  "other",
]);
export type IntelligenceFileCategory = z.infer<typeof FileCategorySchema>;

export const AnalysisLevelSchema = z.enum(["deep", "structural", "metadata-only", "excluded"]);
export type AnalysisLevel = z.infer<typeof AnalysisLevelSchema>;

export const ClassificationDecisionSchema = z
  .object({
    category: FileCategorySchema,
    analysisLevel: AnalysisLevelSchema,
    included: z.boolean(),
    generated: z.boolean(),
    binary: z.boolean(),
    sensitive: z.boolean(),
    ruleId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type ClassificationDecision = z.infer<typeof ClassificationDecisionSchema>;

export const SourceRangeSchema = z
  .object({
    startLine: z.number().int().nonnegative(),
    startColumn: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    endColumn: z.number().int().nonnegative(),
  })
  .strict();
export type SourceRange = z.infer<typeof SourceRangeSchema>;

export const WorkspaceRootRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type WorkspaceRootRecord = z.infer<typeof WorkspaceRootRecordSchema>;

export const RepositoryRecordSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    workspaceRoots: z.array(WorkspaceRootRecordSchema).min(1),
    branch: z.string().min(1).optional(),
    headCommit: z.string().min(1).optional(),
    dirtyFingerprint: z.string().min(1).optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type IntelligenceRepositoryRecord = z.infer<typeof RepositoryRecordSchema>;

export const FileRecordSchema = z
  .object({
    id: z.string().min(1),
    repositoryId: z.string().min(1),
    workspaceRootId: z.string().min(1),
    relativePath: z.string().min(1),
    language: z.string().min(1),
    category: FileCategorySchema,
    analysisLevel: AnalysisLevelSchema,
    byteSize: z.number().int().nonnegative(),
    modifiedAt: z.string().datetime(),
    contentHash: z.string().min(1).optional(),
    structuralHash: z.string().min(1).optional(),
    parserId: z.string().min(1).optional(),
    parserVersion: z.string().min(1).optional(),
    packageId: z.string().min(1).optional(),
    moduleId: z.string().min(1).optional(),
    sourceRoot: z.string().optional(),
    exported: z.boolean().optional(),
    isTest: z.boolean().optional(),
    parseStatus: z
      .enum(["not-applicable", "parsed", "partial", "failed", "unsupported"])
      .optional(),
    shardReferences: z.array(z.string().min(1)).optional(),
    classification: ClassificationDecisionSchema,
    evidenceIds: z.array(z.string().min(1)).min(1),
    generation: z.number().int().positive(),
  })
  .strict();
export type IntelligenceFileRecord = z.infer<typeof FileRecordSchema>;

export const SymbolRecordSchema = z
  .object({
    id: z.string().min(1),
    repositoryId: z.string().min(1),
    fileId: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    qualifiedName: z.string().min(1),
    language: z.string().min(1),
    signature: z.string().min(1).optional(),
    range: SourceRangeSchema,
    nameRange: SourceRangeSchema.optional(),
    parentId: z.string().min(1).optional(),
    visibility: z.enum(["public", "protected", "private", "package", "local"]).optional(),
    exported: z.boolean().optional(),
    defaultExport: z.boolean().optional(),
    static: z.boolean().optional(),
    async: z.boolean().optional(),
    abstract: z.boolean().optional(),
    readonly: z.boolean().optional(),
    parameters: z
      .array(
        z
          .object({
            name: z.string(),
            type: z.string().optional(),
            optional: z.boolean().optional(),
            rest: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    returnType: z.string().optional(),
    typeParameters: z.array(z.string()).optional(),
    decorators: z.array(z.string()).optional(),
    jsDocRange: SourceRangeSchema.optional(),
    deprecated: z.boolean().optional(),
    properties: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
    codeAnalysis: z
      .object({
        scopeId: z.string().min(1),
        structuralHash: z.string().min(1),
        providerId: z.string().min(1),
        providerVersion: z.string().min(1),
        calculationMethod: z.string().min(1),
        confidence: z.number().min(0).max(1),
        evidenceIds: z.array(z.string().min(1)).min(1),
        branches: z.number().int().nonnegative(),
        calls: z.number().int().nonnegative(),
        reads: z.number().int().nonnegative(),
        writes: z.number().int().nonnegative(),
        unresolvedCalls: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    ownerFileId: z.string().min(1).optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidence: z.number().min(0).max(1),
    generation: z.number().int().positive(),
  })
  .strict();
export type IntelligenceSymbolRecord = z.infer<typeof SymbolRecordSchema>;

export const RelationshipRecordSchema = z
  .object({
    id: z.string().min(1),
    repositoryId: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    type: z.string().min(1),
    ownerFileId: z.string().min(1).optional(),
    targetFileId: z.string().min(1).optional(),
    resolution: z
      .enum([
        "exact",
        "compiler",
        "framework",
        "syntactic",
        "convention",
        "candidate",
        "external",
        "unresolved",
      ])
      .optional(),
    properties: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    derivation: z.enum([
      "extracted",
      "resolved",
      "calculated",
      "framework-rule",
      "runtime-observed",
      "user-asserted",
    ]),
    confidence: z.number().min(0).max(1),
    generation: z.number().int().positive(),
  })
  .strict();
export type IntelligenceRelationshipRecord = z.infer<typeof RelationshipRecordSchema>;

export const EvidenceRecordSchema = z
  .object({
    id: z.string().min(1),
    subjectId: z.string().min(1),
    sourceKind: z.enum([
      "workspace-inventory",
      "source-file",
      "language-provider",
      "typescript-compiler",
      "framework-rule",
      "manifest",
      "configuration",
      "adapter",
      "documentation",
      "schema",
      "database",
      "ci",
      "infrastructure",
    ]),
    workspaceRootId: z.string().min(1),
    relativePath: z.string(),
    ownerFileId: z.string().min(1).optional(),
    range: SourceRangeSchema.optional(),
    extractorId: z.string().min(1),
    extractorVersion: z.string().min(1),
    derivation: z.enum([
      "extracted",
      "resolved",
      "calculated",
      "framework-rule",
      "runtime-observed",
      "user-asserted",
    ]),
    contentHash: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    generation: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    statement: z.string().min(1),
  })
  .strict();
export type IntelligenceEvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const IntelligenceDiagnosticSchema = z
  .object({
    id: z.string().min(1).optional(),
    code: z.string().min(1),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1),
    workspaceRootId: z.string().min(1).optional(),
    relativePath: z.string().optional(),
    range: SourceRangeSchema.optional(),
    extractorId: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
    ownerFileId: z.string().min(1).optional(),
    adapterId: z.string().min(1).optional(),
    technologyId: z.string().min(1).optional(),
    limitation: z.boolean().optional(),
    ambiguity: z.boolean().optional(),
  })
  .strict();
export type IntelligenceDiagnostic = z.infer<typeof IntelligenceDiagnosticSchema>;

export const IntelligenceDiagnosticsRequestSchema = z
  .object({
    codes: z.array(z.string().min(1)).max(50).optional(),
    codePrefix: z.string().min(1).max(128).optional(),
    severities: z
      .array(z.enum(["info", "warning", "error"]))
      .max(3)
      .optional(),
    relativePath: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
  })
  .strict();
export type IntelligenceDiagnosticsRequest = z.input<typeof IntelligenceDiagnosticsRequestSchema>;
export const IntelligenceDiagnosticsResultSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    items: z.array(IntelligenceDiagnosticSchema).max(100),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type IntelligenceDiagnosticsResult = z.infer<typeof IntelligenceDiagnosticsResultSchema>;

export const IntelligenceManifestSchema = z
  .object({
    schemaVersion: z.literal(INTELLIGENCE_SCHEMA_VERSION),
    generation: z.number().int().positive(),
    scanRevision: z.number().int().positive(),
    repositoryId: z.string().min(1),
    status: z.enum(["ready", "partial"]),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    extractorVersions: z.record(z.string(), z.string()),
  })
  .strict();
export type IntelligenceManifest = z.infer<typeof IntelligenceManifestSchema>;

export const FileContributionSchema = z
  .object({
    fileId: z.string().min(1),
    sourceHash: z.string().min(1).optional(),
    structuralHash: z.string().min(1).optional(),
    parserId: z.string().min(1).optional(),
    parserVersion: z.string().min(1).optional(),
    entityIds: z.array(z.string().min(1)),
    relationshipIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    diagnosticIds: z.array(z.string().min(1)),
    dependencyFileIds: z.array(z.string().min(1)),
    generation: z.number().int().positive(),
  })
  .strict();
export type FileContribution = z.infer<typeof FileContributionSchema>;

const StringIndexSchema = z.record(z.string(), z.array(z.string().min(1)));
export const IntelligenceIndexesSchema = z
  .object({
    byName: StringIndexSchema,
    byQualifiedName: StringIndexSchema,
    byPath: StringIndexSchema,
    byType: StringIndexSchema,
    byLanguage: StringIndexSchema,
    incoming: StringIndexSchema,
    outgoing: StringIndexSchema,
    routeHandlers: StringIndexSchema,
    testTargets: StringIndexSchema,
    packageMembership: StringIndexSchema,
    configurationUsage: StringIndexSchema,
  })
  .strict();
export type IntelligenceIndexes = z.infer<typeof IntelligenceIndexesSchema>;

export const IntelligenceSnapshotSchema = z
  .object({
    manifest: IntelligenceManifestSchema,
    repository: RepositoryRecordSchema,
    files: z.array(FileRecordSchema),
    symbols: z.array(SymbolRecordSchema),
    relationships: z.array(RelationshipRecordSchema),
    evidence: z.array(EvidenceRecordSchema),
    diagnostics: z.array(IntelligenceDiagnosticSchema),
    contributions: z.array(FileContributionSchema).optional(),
    indexes: IntelligenceIndexesSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
    const requireEvidence = (
      subject: { id: string; evidenceIds: string[] },
      path: (string | number)[],
    ): void => {
      for (const id of subject.evidenceIds) {
        const evidence = evidenceById.get(id);
        if (!evidence)
          context.addIssue({ code: "custom", message: `Missing evidence ${id}`, path });
        else if (evidence.subjectId !== subject.id)
          context.addIssue({
            code: "custom",
            message: `Evidence ${id} supports another subject`,
            path,
          });
      }
    };
    requireEvidence(snapshot.repository, ["repository", "evidenceIds"]);
    snapshot.repository.workspaceRoots.forEach((root, index) =>
      requireEvidence(root, ["repository", "workspaceRoots", index, "evidenceIds"]),
    );
    snapshot.files.forEach((file, index) => requireEvidence(file, ["files", index, "evidenceIds"]));
    snapshot.symbols.forEach((symbol, index) =>
      requireEvidence(symbol, ["symbols", index, "evidenceIds"]),
    );
    snapshot.relationships.forEach((relationship, index) =>
      requireEvidence(relationship, ["relationships", index, "evidenceIds"]),
    );
    const entityIds = new Set([
      snapshot.repository.id,
      ...snapshot.files.map((item) => item.id),
      ...snapshot.symbols.map((item) => item.id),
    ]);
    snapshot.relationships.forEach((relationship, index) => {
      if (!entityIds.has(relationship.sourceId))
        context.addIssue({
          code: "custom",
          message: "Unresolved relationship source",
          path: ["relationships", index, "sourceId"],
        });
      if (!entityIds.has(relationship.targetId))
        context.addIssue({
          code: "custom",
          message: "Unresolved relationship target",
          path: ["relationships", index, "targetId"],
        });
    });
    const fileIds = new Set(snapshot.files.map((item) => item.id));
    snapshot.contributions?.forEach((contribution, index) => {
      if (!fileIds.has(contribution.fileId))
        context.addIssue({
          code: "custom",
          message: "Contribution owner file is missing",
          path: ["contributions", index, "fileId"],
        });
    });
  });
export type IntelligenceSnapshot = z.infer<typeof IntelligenceSnapshotSchema>;

const BoundedCountSchema = z
  .object({ key: z.string(), count: z.number().int().nonnegative() })
  .strict();

export const IntelligenceRuntimeOverviewSchema = z
  .object({
    phase: IntelligenceRuntimePhaseSchema,
    queueDepth: z.number().int().nonnegative(),
    activeWorkers: z.number().int().nonnegative(),
    workerCapacity: z.number().int().nonnegative(),
    pendingFiles: z.number().int().nonnegative(),
    completedJobs: z.number().int().nonnegative(),
    failedJobs: z.number().int().nonnegative(),
    staleResultsDiscarded: z.number().int().nonnegative(),
    workerRestarts: z.number().int().nonnegative(),
    throughputFilesPerSecond: z.number().nonnegative(),
    currentFiles: z.array(z.string()).max(20),
    health: z.enum(["healthy", "missing", "damaged", "recovering", "building", "failed"]),
    healthMessage: z.string().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        technicalDetails: z.string().optional(),
        recommendedAction: z.string().optional(),
      })
      .strict()
      .optional(),
    trigger: z
      .enum(["manual", "file", "active-editor", "git", "startup", "storage-recovery", "workspace"])
      .optional(),
    progress: z
      .object({
        stage: z.enum(["inventory", "symbols", "publishing"]),
        fileCount: z.number().int().nonnegative(),
        totalFiles: z.number().int().nonnegative(),
        currentFiles: z.array(z.string()).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();
export type IntelligenceRuntimeOverview = z.infer<typeof IntelligenceRuntimeOverviewSchema>;

export const IntelligenceOverviewSchema = z
  .object({
    status: IntelligenceStatusSchema,
    pendingUpdate: z.boolean(),
    generation: z.number().int().nonnegative(),
    repository: z
      .object({
        id: z.string().min(1),
        displayName: z.string().min(1),
        workspaceRoots: z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(32),
        branch: z.string().optional(),
        headCommit: z.string().optional(),
      })
      .strict()
      .optional(),
    updatedAt: z.string().datetime().optional(),
    runtime: IntelligenceRuntimeOverviewSchema,
    counts: z
      .object({
        files: z.number().int().nonnegative(),
        symbols: z.number().int().nonnegative(),
        relationships: z.number().int().nonnegative(),
        evidence: z.number().int().nonnegative(),
        packages: z.number().int().nonnegative(),
        tests: z.number().int().nonnegative(),
        routes: z.number().int().nonnegative(),
        externalDependencies: z.number().int().nonnegative(),
        parseFailures: z.number().int().nonnegative(),
        unresolvedReferences: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
        sensitive: z.number().int().nonnegative(),
        diagnostics: z.number().int().nonnegative(),
      })
      .strict(),
    languages: z.array(BoundedCountSchema).max(20),
    categories: z.array(BoundedCountSchema).max(20),
    symbolTypes: z.array(BoundedCountSchema).max(20),
    relationshipTypes: z.array(BoundedCountSchema).max(20),
    confidence: z.array(BoundedCountSchema).max(10),
    technologyCoverage: z
      .array(
        z
          .object({
            technologyId: z.string(),
            adapterId: z.string(),
            capabilityLevel: z.enum([
              "deep",
              "semantic",
              "structural",
              "metadata-only",
              "unsupported",
            ]),
            filesDiscovered: z.number().int().nonnegative(),
            filesParsed: z.number().int().nonnegative(),
            filesFailed: z.number().int().nonnegative(),
            freshness: z.string(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    cpg: z
      .object({
        scopes: z.number().int().nonnegative(),
        scopesBuilt: z.number().int().nonnegative(),
        scopesReused: z.number().int().nonnegative(),
        buildTimeMs: z.number().nonnegative(),
        shardBytes: z.number().int().nonnegative(),
        analysisFailures: z.number().int().nonnegative(),
        approximateResults: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    diagnostics: z
      .object({
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
        items: z.array(IntelligenceDiagnosticSchema).max(20),
      })
      .strict(),
  })
  .strict();
export type IntelligenceOverview = z.infer<typeof IntelligenceOverviewSchema>;

export const emptyIntelligenceOverview = (
  status: IntelligenceStatus,
  pendingUpdate = false,
): IntelligenceOverview => ({
  status,
  pendingUpdate,
  generation: 0,
  runtime: {
    phase: "ready",
    queueDepth: 0,
    activeWorkers: 0,
    workerCapacity: 0,
    pendingFiles: 0,
    completedJobs: 0,
    failedJobs: 0,
    staleResultsDiscarded: 0,
    workerRestarts: 0,
    throughputFilesPerSecond: 0,
    currentFiles: [],
    health: "healthy",
  },
  counts: {
    files: 0,
    symbols: 0,
    relationships: 0,
    evidence: 0,
    packages: 0,
    tests: 0,
    routes: 0,
    externalDependencies: 0,
    parseFailures: 0,
    unresolvedReferences: 0,
    excluded: 0,
    sensitive: 0,
    diagnostics: 0,
  },
  languages: [],
  categories: [],
  symbolTypes: [],
  relationshipTypes: [],
  confidence: [],
  diagnostics: { total: 0, truncated: false, items: [] },
});

export const IntelligenceSearchRequestSchema = z
  .object({
    query: z.string().max(256),
    entityTypes: z.array(z.string().min(1)).max(20).optional(),
    languages: z.array(z.string().min(1)).max(20).optional(),
    packageIds: z.array(z.string().min(1)).max(20).optional(),
    moduleIds: z.array(z.string().min(1)).max(20).optional(),
    limit: z.number().int().min(1).max(50).default(25),
    cursor: z.string().max(64).optional(),
  })
  .strict();
export type IntelligenceSearchRequest = z.input<typeof IntelligenceSearchRequestSchema>;

export const IntelligenceSearchItemSchema = z
  .object({
    id: z.string().min(1),
    fileId: z.string().min(1).optional(),
    type: z.string().min(1),
    name: z.string().min(1),
    qualifiedName: z.string().min(1),
    language: z.string().min(1),
    relativePath: z.string(),
    signature: z.string().optional(),
    confidence: z.number().min(0).max(1),
    generation: z.number().int().positive(),
  })
  .strict();

export const IntelligenceSearchResultSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    items: z.array(IntelligenceSearchItemSchema).max(50),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type IntelligenceSearchResult = z.infer<typeof IntelligenceSearchResultSchema>;

export const IntelligenceEntityRequestSchema = z.object({ id: z.string().min(1) }).strict();
export const IntelligenceRelationshipViewSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    direction: z.enum(["incoming", "outgoing"]),
    entityId: z.string(),
    entityName: z.string(),
    confidence: z.number().min(0).max(1),
    derivation: z.string(),
    evidenceIds: z.array(z.string()).max(20),
  })
  .strict();
export const IntelligenceEntityDetailsSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    entity: IntelligenceSearchItemSchema.extend({
      parentId: z.string().optional(),
      sourceRange: SourceRangeSchema.optional(),
      properties: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
        .optional(),
    }).strict(),
    incoming: z.array(IntelligenceRelationshipViewSchema).max(50),
    outgoing: z.array(IntelligenceRelationshipViewSchema).max(50),
    evidence: z.array(EvidenceRecordSchema).max(50),
    diagnostics: z.array(IntelligenceDiagnosticSchema).max(50),
    truncated: z.boolean(),
  })
  .strict();
export type IntelligenceEntityDetails = z.infer<typeof IntelligenceEntityDetailsSchema>;

export const IntelligenceNeighborhoodRequestSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(5),
    direction: z.enum(["incoming", "outgoing", "both"]).default("both"),
    relationshipTypes: z.array(z.string().min(1)).max(20).optional(),
    entityTypes: z.array(z.string().min(1)).max(20).optional(),
    maxDepth: z.number().int().min(1).max(3).default(1),
    maxNodes: z.number().int().min(1).max(100).default(40),
    minimumConfidence: z.number().min(0).max(1).default(0),
  })
  .strict();
export const IntelligenceNeighborhoodSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    nodes: z.array(IntelligenceSearchItemSchema).max(100),
    relationships: z.array(RelationshipRecordSchema).max(300),
    truncated: z.boolean(),
  })
  .strict();
export type IntelligenceNeighborhood = z.infer<typeof IntelligenceNeighborhoodSchema>;
