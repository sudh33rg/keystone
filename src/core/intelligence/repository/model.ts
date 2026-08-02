export type RepositoryType = "git" | "local" | "archive" | "remote";

export interface GitMetadata {
  readonly branch?: string;
  readonly revision?: string;
  readonly remote?: string;
}

export interface LanguageSummary {
  readonly language: string;
  readonly files: number;
  readonly bytes: number;
}

export interface FrameworkSummary {
  readonly name: string;
  readonly category: "frontend" | "backend" | "testing" | "build" | "database" | "unknown";
  readonly evidence: readonly string[];
}

export interface RepositoryModel {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly type: RepositoryType;
  readonly version: string;
  readonly createdAt: string;
  readonly git?: GitMetadata;
  readonly modules: readonly RepositoryModule[];
  readonly packages: readonly RepositoryPackage[];
  readonly projects: readonly RepositoryProject[];
  readonly directories: readonly RepositoryDirectory[];
  readonly files: readonly SourceFile[];
  readonly symbols: readonly RepositorySymbol[];
  readonly dependencies: readonly RepositoryDependency[];
  readonly languages: readonly LanguageSummary[];
  readonly frameworks: readonly FrameworkSummary[];
  readonly buildMetadata: readonly BuildDefinition[];
  readonly documentation: readonly RepositoryDocumentation[];
}

export interface RepositoryModule {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface RepositoryPackage {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly version?: string;
  readonly packageManager?: string;
}

export interface RepositoryProject {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: string;
}

export interface RepositoryDirectory {
  readonly id: string;
  readonly path: string;
  readonly parentPath?: string;
}

export interface SourceFile {
  readonly id: string;
  readonly repositoryId: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly language: string;
  readonly checksum: string;
  readonly size: number;
  readonly lineCount: number;
  readonly symbols: readonly RepositorySymbol[];
  readonly imports: readonly RepositoryImport[];
}

export type RepositorySymbolKind =
  | "package"
  | "namespace"
  | "class"
  | "interface"
  | "enum"
  | "method"
  | "function"
  | "variable"
  | "constant"
  | "annotation"
  | "decorator"
  | "type";

export interface RepositorySymbol {
  readonly id: string;
  readonly repositoryId: string;
  readonly fileId: string;
  readonly name: string;
  readonly kind: RepositorySymbolKind;
  readonly location: {
    readonly path: string;
    readonly line: number;
    readonly column: number;
  };
}

export interface RepositoryImport {
  readonly id: string;
  readonly sourceFileId: string;
  readonly sourcePath: string;
  readonly target: string;
  readonly line: number;
}

export interface RepositoryDependency {
  readonly id: string;
  readonly repositoryId: string;
  readonly sourceAssetId: string;
  readonly target: string;
  readonly dependencyType: "package" | "import" | "framework" | "unknown";
  readonly scope: "runtime" | "development" | "peer" | "optional" | "unknown";
  readonly evidence: readonly string[];
}

export interface BuildDefinition {
  readonly id: string;
  readonly command: string;
  readonly description: string;
  readonly source: string;
}

export interface RepositoryDocumentation {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly checksum: string;
}

export interface SymbolQuery {
  readonly repositoryId?: string;
  readonly name?: string;
  readonly kind?: RepositorySymbolKind;
  readonly filePath?: string;
}

export interface RepositoryEventPayload {
  readonly repositoryId: string;
  readonly modelVersion?: string;
  readonly files?: number;
  readonly symbols?: number;
}

export interface WorkspaceGraph {
  readonly repositoryId: string;
  readonly nodes: readonly WorkspaceGraphNode[];
  readonly edges: readonly WorkspaceGraphEdge[];
}

export interface WorkspaceGraphNode {
  readonly id: string;
  readonly type: "repository" | "module" | "package" | "project" | "directory" | "file" | "symbol";
  readonly label: string;
  readonly path?: string;
}

export interface WorkspaceGraphEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationship: "contains" | "defines" | "imports" | "depends-on";
}

export interface RepositoryHealth {
  readonly repositoryId: string;
  readonly score: number;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly dependencyCount: number;
  readonly documentationCount: number;
  readonly issues: readonly string[];
}

export interface IncrementalIndexPlan {
  readonly repositoryId: string;
  readonly changedFiles: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly dependencyImpacts: readonly RepositoryDependency[];
  readonly cacheKeys: readonly string[];
}

export interface ArchitectureDiscovery {
  readonly repositoryId: string;
  readonly services: readonly RepositorySymbol[];
  readonly apis: readonly RepositorySymbol[];
  readonly databases: readonly RepositoryDependency[];
  readonly events: readonly RepositorySymbol[];
  readonly dependencyGraph: WorkspaceGraph;
  readonly circularDependencies: readonly string[][];
}

export interface RepositoryAnalysisQuality {
  readonly repositoryId: string;
  readonly deterministic: boolean;
  readonly languageCoverage: number;
  readonly symbolCoverage: number;
  readonly dependencyCoverage: number;
  readonly frameworkEvidenceCoverage: number;
  readonly issues: readonly string[];
}
