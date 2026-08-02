import fs from "node:fs/promises";
import { createHash } from "node:crypto";

import { languageForPath, scanFiles } from "./fileScanner";
import { IntelligenceStore } from "./intelligenceStore";
import { detectModernizationCandidates } from "./modernizationCandidateDetector";
import { detectPerformanceSensitivePath } from "./performancePathDetector";
import { detectSecuritySensitiveArea } from "./securityZoneDetector";
import { mapService } from "./serviceMapper";
import { isTestPath, mapTests } from "./testMapper";
import type {
  ApiEndpoint,
  CodeSymbol,
  DependencyEdge,
  EvidenceMetadata,
  RepoFile,
  RepoIntelligence,
  RepositoryLanguageSupport,
  SemanticCall,
  ServiceNode,
  TestMapping,
  ControlFlowFact,
  DataFlowFact,
  TypeRelationshipFact
} from "../../domain/types";
import { repoIntelligenceToOkf } from "../okf/fromRepoIntelligence";
import { analyzeLanguageFile, type LanguageAnalysisResult } from "../languages/languageAnalysis";
import { LANGUAGE_DEFINITIONS } from "../languages/languageRegistry";
import type {
  SemanticEnrichmentProvider,
  SemanticEnrichmentResult
} from "../languages/semanticEnrichment";
import { OkfSnapshotStore } from "../okf/store";

export interface RepoIndexOptions {
  persist?: boolean;
  signal?: AbortSignal;
  onDiscovery?: (discovered: number, path: string) => void;
  onFile?: (indexed: number, total: number, path: string) => void;
  onPersistence?: (event: RepoIndexPersistenceEvent) => void;
  semanticEnricher?: SemanticEnrichmentProvider;
}

export interface RepoIndexPersistenceEvent {
  phase: "structural-store" | "okf-read" | "okf-build" | "okf-store" | "okf-complete";
  message: string;
}

export async function indexRepository(
  workspaceRoot: string,
  options: RepoIndexOptions = {}
): Promise<RepoIntelligence> {
  const store = new IntelligenceStore(workspaceRoot);
  const previous = await store.read();
  const previousFiles = new Map(previous.files.map((file) => [file.path, file]));
  const scanned = await scanFiles(workspaceRoot, options.signal, (progress) =>
    options.onDiscovery?.(progress.discoveredFiles, progress.currentPath)
  );
  const files: RepoFile[] = [];
  const symbols = [];
  const dependencies = [];
  const apis = [];
  const services = [];
  const calls = [];
  const controlFlows = [];
  const dataFlows = [];
  const typeRelationships = [];
  const securitySensitiveAreas = new Set<string>();
  const performanceSensitivePaths = new Set<string>();
  const modernizationCandidates = new Set<string>();
  const frameworkHints = new Set<string>();
  const ownershipHints = new Set<string>();
  let reusedFiles = 0;
  const languageSupport = new Map<string, MutableLanguageSupport>();

  for (const [fileIndex, file] of scanned.entries()) {
    options.signal?.throwIfAborted();
    if (fileIndex > 0 && fileIndex % 100 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));

    const previousFile = previousFiles.get(file.path);
    const metadataReusable = Boolean(
      previousFile?.contentHash &&
      previousFile.structuralHash &&
      previousFile.sizeBytes === file.sizeBytes &&
      previousFile.modifiedTimeMs === file.modifiedTimeMs &&
      previousFile.frameworkHints &&
      previousFile.ownershipHints &&
      previousFile.securitySensitiveAreas &&
      previousFile.performanceSensitivePaths &&
      previousFile.modernizationCandidates
    );
    const text = metadataReusable ? undefined : await fs.readFile(file.absolutePath, "utf8");
    const lineCount = metadataReusable
      ? previousFile!.lineCount
      : text!.length === 0
        ? 0
        : text!.split(/\r?\n/).length;
    const language = languageForPath(file.path);
    const contentHash = metadataReusable ? previousFile!.contentHash! : hash(text!);
    const reusable =
      metadataReusable ||
      Boolean(previousFile?.contentHash === contentHash && previousFile.structuralHash);
    const languageAnalysis = analyzeLanguageFile(file.path, reusable ? "" : text!);
    const support = supportFor(languageSupport, languageAnalysis);
    let semantic: SemanticEnrichmentResult | undefined;

    if (
      !reusable &&
      options.semanticEnricher &&
      languageAnalysis.language.semanticEnrichment === "vscode-language-service"
    ) {
      try {
        semantic = await options.semanticEnricher.enrich({
          workspaceRoot,
          absolutePath: file.absolutePath,
          relativePath: file.path,
          languageId: languageAnalysis.language.id,
          text: text!,
          signal: options.signal
        });
        if (semantic?.capabilities.documentSymbols) support.semanticFiles += 1;
        else support.deterministicFiles += 1;
        if (semantic) mergeSupportCapabilities(support, semantic);
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError"))
          throw error;
        support.failedSemanticFiles += 1;
        support.deterministicFiles += 1;
        support.warnings.add(
          `Semantic enrichment failed for ${file.path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (languageAnalysis.language.parser === "typescript") {
      support.semanticFiles += 1;
      support.capabilities.symbols = true;
      support.capabilities.definitions = true;
      support.capabilities.references = true;
      support.capabilities.implementations = true;
      support.capabilities.calls = true;
      support.capabilities.controlFlow = true;
      support.capabilities.dataFlow = true;
      support.capabilities.cpg = true;
    } else {
      support.deterministicFiles += 1;
    }

    const fileSymbols = (
      reusable
        ? previous.symbols.filter((symbol) => symbol.filePath === file.path)
        : mergeSymbols(languageAnalysis.symbols, semantic?.symbols ?? [])
    ).map((symbol) => withSymbolEvidence(symbol, file.path, languageAnalysis.language.id));
    const fileDependencies = (
      reusable
        ? previous.dependencies.filter((edge) => edge.from === file.path)
        : mergeDependencies(languageAnalysis.dependencies, semantic?.dependencies ?? [])
    ).map((edge) => withDependencyEvidence(edge, file.path, languageAnalysis.language.id));
    const fileApis = (
      reusable
        ? previous.apis.filter((api) => api.filePath === file.path)
        : mergeApis(languageAnalysis.apis, semantic?.apis ?? [])
    ).map((api) => withApiEvidence(api, file.path, languageAnalysis.language.id));
    const fileCalls = reusable
      ? (previous.calls ?? []).filter((call) => call.filePath === file.path)
      : mergeCalls(
          languageAnalysis.calls.map((call) => ({
            ...call,
            filePath: file.path,
            evidence: evidence("heuristic", 0.72, file.path, call.line, [
              "Deterministic call-site extraction; dynamic dispatch may remain unresolved."
            ])
          })),
          semantic?.calls ?? []
        );
    const fileControlFlows = reusable
      ? (previous.controlFlows ?? []).filter((flow) => flow.filePath === file.path)
      : mergeControlFlows(
          languageAnalysis.controlFlow.map((flow) => ({
            ...flow,
            filePath: file.path,
            evidence: evidence("heuristic", 0.78, file.path, flow.line)
          })),
          semantic?.controlFlows ?? []
        );
    const fileDataFlows = reusable
      ? (previous.dataFlows ?? []).filter((flow) => flow.filePath === file.path)
      : mergeDataFlows(
          languageAnalysis.dataFlow.map((flow) => ({
            ...flow,
            filePath: file.path,
            evidence: evidence("heuristic", 0.68, file.path, flow.line, [
              "Lexical data-flow extraction; interprocedural flow uses available language-service enrichment."
            ])
          })),
          semantic?.dataFlows ?? []
        );
    const fileTypeRelationships = reusable
      ? (previous.typeRelationships ?? []).filter(
          (relationship) => relationship.filePath === file.path
        )
      : mergeTypeRelationships(
          languageAnalysis.typeRelationships.map((relationship) => ({
            ...relationship,
            filePath: file.path,
            evidence: evidence("heuristic", 0.82, file.path, relationship.line, [
              "Deterministic inheritance extraction; installed language services can add semantic implementation evidence."
            ])
          })),
          semantic?.typeRelationships ?? []
        );

    const fileFrameworks = reusable
      ? (previousFile!.frameworkHints ?? [])
      : detectFrameworks(file.path, text!);
    const fileOwnership = reusable
      ? (previousFile!.ownershipHints ?? [])
      : detectOwnership(file.path, text!);
    const fileSecurity = reusable
      ? (previousFile!.securitySensitiveAreas ?? [])
      : detectSecuritySensitiveArea(file.path, text!).map((keyword) => `${file.path}: ${keyword}`);
    const filePerformance = reusable
      ? (previousFile!.performanceSensitivePaths ?? [])
      : detectPerformanceSensitivePath(file.path, text!).map(
          (keyword) => `${file.path}: ${keyword}`
        );
    const fileModernization = reusable
      ? (previousFile!.modernizationCandidates ?? [])
      : detectModernizationCandidates(file.path, text!, lineCount);

    if (reusable) reusedFiles += 1;
    const repoFile: RepoFile = {
      path: file.path,
      language,
      sizeBytes: file.sizeBytes,
      modifiedTimeMs: file.modifiedTimeMs,
      lineCount,
      isTest: isTestPath(file.path),
      isGenerated: /generated|\.gen\.|\.generated\./i.test(file.path),
      summary: reusable ? previousFile!.summary : summarizeFile(file.path, text!),
      contentHash,
      evidence: evidence("filesystem", 1, file.path),
      structuralHash: reusable
        ? previousFile!.structuralHash
        : hash(
            JSON.stringify({
              symbols: fileSymbols
                .map((symbol) => [symbol.name, symbol.kind, symbol.exportStatus])
                .sort(),
              dependencies: fileDependencies.map((edge) => [edge.to, edge.kind]).sort(),
              apis: fileApis.map((api) => [api.method, api.path]).sort()
            })
          ),
      frameworkHints: fileFrameworks,
      ownershipHints: fileOwnership,
      securitySensitiveAreas: fileSecurity,
      performanceSensitivePaths: filePerformance,
      modernizationCandidates: fileModernization
    };
    files.push(repoFile);
    symbols.push(...fileSymbols);
    dependencies.push(...fileDependencies);
    apis.push(...fileApis);
    calls.push(...fileCalls);
    controlFlows.push(...fileControlFlows);
    dataFlows.push(...fileDataFlows);
    typeRelationships.push(...fileTypeRelationships);

    const service = mapService(file.path);
    if (service) services.push(withServiceEvidence(service, file.path));
    fileSecurity.forEach((item) => securitySensitiveAreas.add(item));
    filePerformance.forEach((item) => performanceSensitivePaths.add(item));
    fileModernization.forEach((item) => modernizationCandidates.add(item));
    fileFrameworks.forEach((item) => frameworkHints.add(item));
    fileOwnership.forEach((item) => ownershipHints.add(item));
    options.onFile?.(files.length, scanned.length, file.path);
  }

  const resolvedDependencies = resolveLocalDependencies(dependencies, files);
  const intelligence: RepoIntelligence = {
    workspaceRoot,
    indexedAt: new Date().toISOString(),
    files,
    symbols,
    dependencies: resolvedDependencies,
    tests: improveTestMappings(mapTests(files), resolvedDependencies).map(withTestEvidence),
    apis,
    services,
    calls,
    controlFlows,
    dataFlows,
    typeRelationships,
    ownershipHints: [...ownershipHints].sort(),
    frameworkHints: [...frameworkHints].sort(),
    securitySensitiveAreas: [...securitySensitiveAreas].sort(),
    performanceSensitivePaths: [...performanceSensitivePaths].sort(),
    modernizationCandidates: [...modernizationCandidates].sort(),
    languageSupport: [...languageSupport.values()]
      .map(finalizeSupport)
      .sort((left, right) => left.label.localeCompare(right.label)),
    incrementalStats: { reusedFiles, analyzedFiles: files.length - reusedFiles }
  };

  if (options.persist !== false) {
    options.onPersistence?.({
      phase: "structural-store",
      message: "Persisting the structural repository index..."
    });
    await store.write(intelligence);
    const okfStore = new OkfSnapshotStore(workspaceRoot);
    options.onPersistence?.({
      phase: "okf-read",
      message: "Loading the previous OKF snapshot for incremental reconciliation..."
    });
    const previousOkf = await okfStore.read();
    options.onPersistence?.({
      phase: "okf-build",
      message: "Building the canonical OKF knowledge snapshot..."
    });
    const okfSnapshot = repoIntelligenceToOkf(intelligence, { previousSnapshot: previousOkf });
    options.onPersistence?.({
      phase: "okf-store",
      message: `Writing OKF units, relationships, evidence, and projections (${okfSnapshot.units.length} units)...`
    });
    await okfStore.write(okfSnapshot, {
      onProgress: (message) => options.onPersistence?.({ phase: "okf-store", message })
    });
    options.onPersistence?.({
      phase: "okf-complete",
      message: "Canonical OKF snapshot and portable bundle promoted successfully."
    });
  }
  return intelligence;
}

function evidence(
  source: EvidenceMetadata["source"],
  confidence: number,
  evidencePath: string,
  evidenceLine?: number,
  warnings?: string[]
): EvidenceMetadata {
  return {
    source,
    confidence,
    evidencePath,
    ...(evidenceLine === undefined ? {} : { evidenceLine }),
    extractorVersion: "repo-indexer:v2",
    ...(warnings?.length ? { warnings } : {})
  };
}

function withSymbolEvidence(symbol: CodeSymbol, filePath: string, languageId?: string): CodeSymbol {
  return {
    ...symbol,
    evidence:
      symbol.evidence ??
      evidence(
        languageId === "typescript" || languageId === "javascript" ? "typescript-ast" : "heuristic",
        languageId ? 0.82 : 0.65,
        filePath,
        symbol.line,
        [
          "Deterministic language adapter extraction; dynamic/runtime declarations may require enrichment."
        ]
      )
  };
}

function withDependencyEvidence(
  edge: DependencyEdge,
  filePath: string,
  languageId?: string
): DependencyEdge {
  return {
    ...edge,
    evidence:
      edge.evidence ??
      evidence("heuristic", edge.kind === "local" ? 0.86 : 0.8, filePath, undefined, [
        `${languageId ?? "generic"} adapter dependency extraction; aliases and dynamic loading may require resolver enrichment.`
      ])
  };
}

function withApiEvidence(api: ApiEndpoint, filePath: string, languageId?: string): ApiEndpoint {
  return {
    ...api,
    evidence:
      api.evidence ??
      evidence("heuristic", 0.78, filePath, api.line, [
        `${languageId ?? "generic"} adapter route extraction; generated routes may require framework enrichment.`
      ])
  };
}

function withServiceEvidence(service: ServiceNode, filePath: string): ServiceNode {
  return {
    ...service,
    evidence:
      service.evidence ??
      evidence("heuristic", 0.55, filePath, undefined, [
        "Service boundaries are inferred from path/name conventions."
      ])
  };
}

function withTestEvidence(mapping: TestMapping): TestMapping {
  const direct = mapping.reason.includes("directly imports");
  const confidence = direct ? 0.95 : mapping.confidence;
  return {
    ...mapping,
    confidence,
    evidence:
      mapping.evidence ??
      evidence(
        "heuristic",
        confidence,
        mapping.testFile,
        undefined,
        direct ? undefined : ["Test mapping is inferred from naming/path conventions."]
      )
  };
}

type MutableLanguageSupport = {
  id: string;
  label: string;
  files: number;
  baseline: RepositoryLanguageSupport["baseline"];
  semanticProvider: RepositoryLanguageSupport["semanticProvider"];
  semanticFiles: number;
  deterministicFiles: number;
  failedSemanticFiles: number;
  capabilities: RepositoryLanguageSupport["capabilities"];
  warnings: Set<string>;
};
function supportFor(
  store: Map<string, MutableLanguageSupport>,
  analysis: LanguageAnalysisResult
): MutableLanguageSupport {
  const id = analysis.language.id;
  let value = store.get(id);
  if (!value) {
    value = {
      id,
      label: analysis.language.label,
      files: 0,
      baseline: analysis.language.baseline,
      semanticProvider: analysis.language.parser === "typescript" ? "typescript-compiler" : "none",
      semanticFiles: 0,
      deterministicFiles: 0,
      failedSemanticFiles: 0,
      capabilities: {
        symbols: true,
        definitions: analysis.language.parser === "typescript",
        references: analysis.language.parser === "typescript",
        implementations: analysis.language.parser === "typescript",
        calls: true,
        controlFlow: true,
        dataFlow: true,
        cpg: true
      },
      warnings: new Set()
    };
    store.set(id, value);
  }
  value.files += 1;
  return value;
}
function mergeSupportCapabilities(
  target: MutableLanguageSupport,
  result: SemanticEnrichmentResult
): void {
  target.semanticProvider = "vscode-language-service";
  target.capabilities.symbols ||= result.capabilities.documentSymbols;
  target.capabilities.definitions ||= result.capabilities.definitions;
  target.capabilities.references ||= result.capabilities.references;
  target.capabilities.implementations ||= result.capabilities.implementations;
  target.capabilities.calls ||= result.capabilities.callHierarchy || Boolean(result.calls?.length);
  target.capabilities.cpg = true;
  for (const warning of result.warnings ?? []) target.warnings.add(warning);
}
function finalizeSupport(value: MutableLanguageSupport): RepositoryLanguageSupport {
  return { ...value, warnings: [...value.warnings].slice(0, 50) };
}
function mergeSymbols(left: readonly CodeSymbol[], right: readonly CodeSymbol[]): CodeSymbol[] {
  return uniqueBy(
    [...right, ...left],
    (value) => `${value.kind}:${value.name}:${value.filePath}:${value.line}`
  );
}
function mergeDependencies(
  left: readonly DependencyEdge[],
  right: readonly DependencyEdge[]
): DependencyEdge[] {
  return uniqueBy([...right, ...left], (value) => `${value.from}:${value.to}:${value.kind}`);
}
function mergeApis(left: readonly ApiEndpoint[], right: readonly ApiEndpoint[]): ApiEndpoint[] {
  return uniqueBy(
    [...right, ...left],
    (value) => `${value.method}:${value.path}:${value.filePath}:${value.line}`
  );
}
function mergeCalls(left: readonly SemanticCall[], right: readonly SemanticCall[]): SemanticCall[] {
  return uniqueBy(
    [...right, ...left],
    (value) => `${value.filePath}:${value.line}:${value.caller ?? ""}:${value.callee}`
  );
}
function mergeControlFlows(
  left: readonly ControlFlowFact[],
  right: readonly ControlFlowFact[]
): ControlFlowFact[] {
  return uniqueBy([...right, ...left], (value) => `${value.filePath}:${value.line}:${value.kind}`);
}
function mergeDataFlows(
  left: readonly DataFlowFact[],
  right: readonly DataFlowFact[]
): DataFlowFact[] {
  return uniqueBy(
    [...right, ...left],
    (value) => `${value.filePath}:${value.line}:${value.source}:${value.target}`
  );
}
function mergeTypeRelationships(
  left: readonly TypeRelationshipFact[],
  right: readonly TypeRelationshipFact[]
): TypeRelationshipFact[] {
  return uniqueBy(
    [...right, ...left],
    (value) => `${value.filePath}:${value.line}:${value.kind}:${value.source}:${value.target}`
  );
}
function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveLocalDependencies(edges: DependencyEdge[], files: RepoFile[]): DependencyEdge[] {
  const paths = new Set(files.map((file) => file.path));
  const extensions = [
    "",
    ...new Set(LANGUAGE_DEFINITIONS.flatMap((definition) => [...definition.extensions]))
  ];
  const resolved = edges.map((edge) => {
    if (edge.kind !== "local") return edge;
    const bases = /\.(?:js|jsx|mjs|cjs)$/.test(edge.to)
      ? [edge.to, edge.to.replace(/\.(?:js|jsx|mjs|cjs)$/, "")]
      : [edge.to];
    const candidates = [
      ...bases.flatMap((base) => extensions.map((extension) => `${base}${extension}`)),
      ...bases.flatMap((base) =>
        extensions.slice(1).map((extension) => `${base}/index${extension}`)
      )
    ];
    return { ...edge, to: candidates.find((candidate) => paths.has(candidate)) ?? edge.to };
  });
  const seen = new Set<string>();
  return resolved.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function improveTestMappings(
  mappings: TestMapping[],
  dependencies: DependencyEdge[]
): TestMapping[] {
  return mappings.map((mapping) => {
    const importedTargets = dependencies
      .filter((edge) => edge.from === mapping.testFile && edge.kind === "local")
      .map((edge) => edge.to)
      .filter((target) => !isTestPath(target));
    if (importedTargets.length === 1) {
      return {
        ...mapping,
        targetFile: importedTargets[0],
        confidence: 0.95,
        reason: "test directly imports source file"
      };
    }
    return mapping;
  });
}

function summarizeFile(filePath: string, text: string): string {
  const markers = [
    /payment/i.test(`${filePath}\n${text}`) ? "payment" : "",
    /audit/i.test(`${filePath}\n${text}`) ? "audit" : "",
    /auth|permission|role/i.test(`${filePath}\n${text}`) ? "authorization" : "",
    /test|spec/i.test(filePath) ? "test" : "",
    /router|controller|handler/i.test(`${filePath}\n${text}`) ? "api/controller" : ""
  ].filter(Boolean);
  return markers.length > 0 ? `Heuristic ${markers.join(", ")} file` : "Repository file";
}

function detectFrameworks(filePath: string, text: string): string[] {
  const hints: string[] = [];
  if (/express|router\./i.test(text)) hints.push("express-style-api");
  if (/react|tsx/i.test(`${filePath}\n${text}`)) hints.push("react");
  if (/vitest|describe\(|it\(/i.test(text)) hints.push("vitest-or-jest");
  if (/vscode/i.test(text)) hints.push("vscode-extension");
  return hints;
}

function detectOwnership(filePath: string, text: string): string[] {
  const match = text.match(/@owner\s+([A-Za-z0-9_.@/-]+)/i);
  return match ? [`${filePath}: ${match[1]}`] : [];
}
