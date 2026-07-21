import type {
  AdapterCapability,
  AdapterCoverage,
  AdapterDetection,
  AdapterDiagnostic,
  AdapterOutput,
  AdapterRegistryState,
} from "../../../shared/contracts/adapters";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import type { SemanticProjectRequest } from "../semantic/SemanticModel";
import { AdapterRegistry } from "./AdapterRegistry";
import {
  DeterministicBuildPackageAdapter,
  DeterministicCiAdapter,
  DeterministicConfigurationAdapter,
  DeterministicInfrastructureAdapter,
  UniversalFallbackAdapter,
} from "./BuildInfrastructureAdapters";
import { CrossTechnologyLinker } from "./CrossTechnologyLinker";
import {
  DeterministicDatabaseAdapter,
  DeterministicOrmAdapter,
  DeterministicTestFrameworkAdapter,
} from "./DataDeliveryAdapters";
import type { AdapterContext } from "./IntelligenceAdapter";
import {
  DeterministicContractAdapter,
  DeterministicDocumentationAdapter,
  DeterministicFrameworkAdapter,
  StructuralLanguageAdapter,
} from "./UniversalAdapters";

export interface UniversalAnalysisResult {
  entities: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  diagnostics: AdapterDiagnostic[];
  adapterState: AdapterRegistryState;
}

export class UniversalAdapterEngine {
  private readonly cache = new Map<string, Map<string, AdapterCacheEntry>>();
  private readonly registry = new AdapterRegistry([
    ...(
      [
        "java",
        "python",
        "csharp",
        "go",
        "rust",
        "c",
        "cpp",
        "ruby",
        "php",
        "kotlin",
        "swift",
        "shell",
      ] as const
    ).map((technology) => new StructuralLanguageAdapter(technology)),
    new DeterministicDocumentationAdapter(),
    new DeterministicContractAdapter(),
    new DeterministicFrameworkAdapter(),
    new DeterministicDatabaseAdapter(),
    new DeterministicOrmAdapter(),
    new DeterministicTestFrameworkAdapter(),
    new DeterministicBuildPackageAdapter(),
    new DeterministicCiAdapter(),
    new DeterministicInfrastructureAdapter(),
    new DeterministicConfigurationAdapter(),
    new UniversalFallbackAdapter(),
  ]);
  private readonly linker = new CrossTechnologyLinker();

  async analyze(
    request: SemanticProjectRequest,
    existingEntities: readonly IntelligenceSymbolRecord[],
    existingRelationships: readonly IntelligenceRelationshipRecord[],
  ): Promise<UniversalAnalysisResult> {
    this.hydrate(request);
    const detections = [
      ...nativeDetections(request),
      ...this.registry.detect(request.changedFiles),
    ].sort((left, right) => left.technologyId.localeCompare(right.technologyId));
    const context: AdapterContext = {
      repositoryId: request.repositoryId,
      generation: request.generation,
      jobRevision: request.jobRevision,
      ...(request.branch ? { branch: request.branch } : {}),
      ...(request.commit ? { commit: request.commit } : {}),
      allFiles: request.changedFiles,
      detections,
    };
    const outputs: AdapterOutput[] = [];
    const projectCache = this.cache.get(request.projectKey) ?? new Map<string, AdapterCacheEntry>();
    this.cache.set(request.projectKey, projectCache);
    for (const adapter of this.registry.all()) {
      const selectedIds = new Set(
        detections.filter((item) => item.adapterId === adapter.id).flatMap((item) => item.fileIds),
      );
      const key = cacheKey(
        adapter.version,
        Object.fromEntries(
          request.changedFiles
            .filter((file) => selectedIds.has(file.fileId))
            .map((file) => [file.fileId, file.contentHash]),
        ),
      );
      const cached = projectCache.get(adapter.id);
      if (cached?.key === key)
        outputs.push(
          rebaseOutput(cached.output, request.generation, request.jobRevision, selectedIds.size),
        );
      else {
        const output = await adapter.analyze({ files: request.changedFiles, context });
        projectCache.set(adapter.id, { key, output });
        outputs.push(output);
      }
    }
    const crossLinks = this.linker.link(context, outputs, existingEntities, existingRelationships);
    outputs.push(crossLinks);
    const capabilities = [
      ...nativeCapabilities(),
      ...this.registry.capabilities(),
      crossLinkCapability(this.linker.id, this.linker.version),
    ].sort((left, right) => left.adapterId.localeCompare(right.adapterId));
    const coverage = buildCoverage(
      detections,
      capabilities,
      outputs,
      existingEntities,
      existingRelationships,
    );
    return {
      entities: dedupe(outputs.flatMap((output) => output.entities)),
      relationships: dedupe(outputs.flatMap((output) => output.relationships)),
      evidence: dedupe(outputs.flatMap((output) => output.evidence)),
      diagnostics: outputs.flatMap((output) => output.diagnostics),
      adapterState: {
        schemaVersion: 1,
        generation: request.generation,
        updatedAt: new Date().toISOString(),
        capabilities,
        detections,
        coverage,
        metrics: outputs.map((output) => output.metrics),
      },
    };
  }

  private hydrate(request: SemanticProjectRequest): void {
    if (!request.adapterCacheSeeds?.length) return;
    const registered = new Map(this.registry.all().map((adapter) => [adapter.id, adapter.version]));
    const projectCache = this.cache.get(request.projectKey) ?? new Map<string, AdapterCacheEntry>();
    for (const output of request.adapterCacheSeeds) {
      const version = registered.get(output.adapterId);
      if (!version || version !== output.adapterVersion) continue;
      projectCache.set(output.adapterId, {
        key: cacheKey(version, output.sourceContentHashes),
        output,
      });
    }
    this.cache.set(request.projectKey, projectCache);
  }
}

function nativeDetections(request: SemanticProjectRequest): AdapterDetection[] {
  const technologies: Array<[string, string[]]> = [
    ["typescript", ["typescript", "typescriptreact"]],
    ["javascript", ["javascript", "javascriptreact"]],
  ];
  return technologies.flatMap(([technology, languages]) => {
    const files = request.changedFiles.filter((file) => languages.includes(file.language));
    return files.length
      ? [
          {
            technologyId: technology,
            confidence: 1,
            adapterId: "keystone.typescript",
            capabilityLevel: "semantic" as const,
            evidence: files.slice(0, 20).map((file) => ({
              kind: "extension" as const,
              relativePath: file.relativePath,
              statement: "The TypeScript compiler adapter supports this source language.",
            })),
            conflicts: [],
            unsupportedFeatures: [
              "Reflective and dynamic dispatch targets are unresolved rather than guessed.",
            ],
            fileIds: files.map((file) => file.fileId),
          },
        ]
      : [];
  });
}
function nativeCapabilities(): AdapterCapability[] {
  return [
    {
      adapterId: "keystone.typescript",
      version: "3.0.0",
      family: "language",
      technologies: ["typescript", "javascript", "tsx", "jsx"],
      filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx"],
      manifestIndicators: ["tsconfig.json", "jsconfig.json"],
      dependencyIndicators: ["typescript"],
      syntaxIndicators: ["import", "export"],
      tier: "tier-2",
      level: "semantic",
      entityTypes: ["keystone.core.Class", "keystone.core.Function", "keystone.core.Method"],
      relationshipTypes: [
        "keystone.core.IMPORTS",
        "keystone.core.EXPORTS",
        "keystone.core.REFERENCES",
        "keystone.core.CALLS",
      ],
      outputKind: "semantic",
      incremental: true,
      threadSafe: false,
      maxInputBytes: 1048576,
      limitations: ["Dynamic dispatch and reflection are unresolved rather than guessed."],
    },
  ];
}
function crossLinkCapability(id: string, version: string): AdapterCapability {
  return {
    adapterId: id,
    version,
    family: "framework",
    technologies: ["cross-technology-linking"],
    filePatterns: [],
    manifestIndicators: [],
    dependencyIndicators: [],
    syntaxIndicators: [],
    tier: "tier-4",
    level: "structural",
    entityTypes: [],
    relationshipTypes: [
      "keystone.core.IMPLEMENTS_CONTRACT_OPERATION",
      "keystone.core.MAPS_TO",
      "keystone.core.EXECUTES",
      "keystone.core.REFERENCES",
    ],
    outputKind: "calculated",
    incremental: true,
    threadSafe: true,
    maxInputBytes: 1048576,
    limitations: [
      "Links require exact normalized keys or an explicitly documented convention; ambiguous links are omitted.",
    ],
  };
}
function buildCoverage(
  detections: AdapterDetection[],
  capabilities: AdapterCapability[],
  outputs: AdapterOutput[],
  nativeEntities: readonly IntelligenceSymbolRecord[],
  nativeRelationships: readonly IntelligenceRelationshipRecord[],
): AdapterCoverage[] {
  const capabilityByAdapter = new Map(capabilities.map((item) => [item.adapterId, item]));
  const outputByAdapter = new Map(outputs.map((item) => [item.adapterId, item]));
  return detections
    .map((item) => {
      const output = outputByAdapter.get(item.adapterId);
      const selected = new Set(item.fileIds);
      const diagnostics =
        output?.diagnostics.filter(
          (diagnostic) => !diagnostic.ownerFileId || selected.has(diagnostic.ownerFileId),
        ) ?? [];
      const entities =
        item.adapterId === "keystone.typescript"
          ? nativeEntities.filter((entity) => selected.has(entity.fileId))
          : (output?.entities.filter((entity) => selected.has(entity.fileId)) ?? []);
      const relationships =
        item.adapterId === "keystone.typescript"
          ? nativeRelationships.filter(
              (relationship) => !relationship.ownerFileId || selected.has(relationship.ownerFileId),
            )
          : (output?.relationships.filter(
              (relationship) => !relationship.ownerFileId || selected.has(relationship.ownerFileId),
            ) ?? []);
      const capability = capabilityByAdapter.get(item.adapterId);
      return {
        technologyId: item.technologyId,
        adapterId: item.adapterId,
        adapterVersion: capability?.version ?? "runtime",
        capabilityLevel: item.capabilityLevel,
        filesDiscovered: item.fileIds.length,
        filesParsed: Math.max(
          0,
          item.fileIds.length -
            diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
        ),
        filesFailed: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
        filesMetadataOnly: item.capabilityLevel === "metadata-only" ? item.fileIds.length : 0,
        entitiesExtracted: entities.length,
        relationshipsResolved: relationships.length,
        unresolvedReferences: diagnostics.filter((diagnostic) =>
          /unresolved|missing-adapter/.test(diagnostic.code),
        ).length,
        unsupportedConstructs:
          diagnostics.filter((diagnostic) => diagnostic.limitation).length +
          item.unsupportedFeatures.length,
        lastSuccessfulUpdate: new Date().toISOString(),
        freshness: "current" as const,
      };
    })
    .sort((left, right) => left.technologyId.localeCompare(right.technologyId));
}
function dedupe<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((item) => [item.id, item])).values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}
function rebaseOutput(
  output: AdapterOutput,
  generation: number,
  jobRevision: number,
  cacheReused: number,
): AdapterOutput {
  return {
    ...output,
    generationCompatibility: generation,
    jobRevision,
    entities: output.entities.map((item) => ({ ...item, generation })),
    relationships: output.relationships.map((item) => ({ ...item, generation })),
    evidence: output.evidence.map((item) => ({ ...item, generation })),
    metrics: { ...output.metrics, executionTimeMs: 0, cacheReused },
  };
}
function cacheKey(version: string, hashes: Record<string, string>): string {
  return [
    version,
    ...Object.entries(hashes)
      .map(([id, hash]) => `${id}:${hash}`)
      .sort(),
  ].join("|");
}

interface AdapterCacheEntry {
  key: string;
  output: AdapterOutput;
}
