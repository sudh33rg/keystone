import { performance } from "node:perf_hooks";
import type { CpgDelta, CpgScopeArtifact, CpgSliceQuery, CpgSliceResult } from "../../../shared/contracts/cpg";
import { CPG_PROVIDER_ID, CPG_PROVIDER_VERSION } from "../../../shared/contracts/cpg";
import { CpgBuilder } from "./CpgBuilder";
import type { CpgBuildContext } from "./CpgBuilder";
import type { BuildAnalysisRequest, CodeAnalysisProvider, UpdateAnalysisRequest } from "./CodeAnalysisProvider";
import { ProgramSliceService } from "./ProgramSliceService";

const LANGUAGES = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
export const TYPESCRIPT_CPG_PROVIDER_VERSION = CPG_PROVIDER_VERSION;

export class TypeScriptCpgProvider implements CodeAnalysisProvider {
  readonly id = CPG_PROVIDER_ID;
  readonly version = TYPESCRIPT_CPG_PROVIDER_VERSION;
  private readonly builder = new CpgBuilder();
  private readonly slicer = new ProgramSliceService();
  private readonly cache = new Map<string, CpgScopeArtifact>();
  private scopeIds = new Set<string>();

  capabilities(): readonly string[] { return ["ast", "evaluation-order", "control-flow", "local-data-flow", "calls", "exceptions-basic", "backward-slice", "forward-slice"]; }
  supports(language: string): boolean { return LANGUAGES.has(language); }
  build(request: BuildAnalysisRequest): Promise<CpgDelta> { this.cache.clear(); this.scopeIds.clear(); return this.analyze(request); }
  update(request: UpdateAnalysisRequest): Promise<CpgDelta> { return this.analyze(request); }
  controlFlow(artifact: CpgScopeArtifact): CpgScopeArtifact { return artifact; }
  dataFlow(artifact: CpgScopeArtifact): CpgScopeArtifact { return artifact; }
  slice(artifact: CpgScopeArtifact, query: CpgSliceQuery): CpgSliceResult { return this.slicer.slice(artifact, query); }

  private analyze(request: BuildAnalysisRequest): Promise<CpgDelta> {
    const started = performance.now();
    const previousIds = new Set(this.scopeIds);
    const artifacts: CpgScopeArtifact[] = [];
    const contexts: CpgBuildContext[] = [];
    for (const input of request.files.filter((file) => this.supports(file.language))) {
      const source = request.program.getSourceFiles().find((item) => item.fileName.replace(/\\/g, "/").endsWith(`/${input.relativePath}`));
      if (!source) continue;
      const entityIndex = new Map(request.entities.filter((entity) => entity.fileId === input.fileId).map((entity) => [`${entity.name}:${entity.range.startLine}`, entity.id]));
      const context: CpgBuildContext = { repositoryId: request.repositoryId, generation: request.generation, providerVersion: this.version, program: request.program, input, source, entities: request.entities, entityIndex, relationships: request.relationships, evidence: request.evidence, analysisLevel: request.analysisLevel };
      contexts.push(context); artifacts.push(...this.builder.buildFile(context, this.cache, false));
    }
    this.builder.bindProject(artifacts, contexts);
    this.scopeIds = new Set(artifacts.map((artifact) => artifact.descriptor.id));
    const removedScopeIds = [...previousIds].filter((id) => !this.scopeIds.has(id));
    this.cache.clear(); for (const artifact of artifacts) this.cache.set(artifact.descriptor.id, artifact);
    return Promise.resolve({ semanticGeneration: request.generation, providerId: this.id, providerVersion: this.version, scopes: artifacts, removedScopeIds, buildTimeMs: performance.now() - started });
  }
}

export class CpgDiagnosticsService {
  summarize(artifacts: readonly CpgScopeArtifact[]) { return { failures: artifacts.reduce((count, artifact) => count + artifact.diagnostics.filter((item) => item.severity === "error").length, 0), approximate: artifacts.reduce((count, artifact) => count + artifact.descriptor.summary.approximateFlows, 0), diagnostics: artifacts.flatMap((artifact) => artifact.diagnostics).slice(0, 100) }; }
}

export class CpgProjectionService {
  project(artifact: CpgScopeArtifact) { return { semanticSymbolId: artifact.descriptor.semanticSymbolId, scopeId: artifact.descriptor.id, structuralHash: artifact.descriptor.structuralHash, calculationMethod: `${artifact.descriptor.providerId}@${artifact.descriptor.providerVersion}`, confidence: artifact.descriptor.summary.approximateFlows > 0 ? 0.7 : 1, summary: artifact.descriptor.summary }; }
}
