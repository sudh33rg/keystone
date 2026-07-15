import type ts from "typescript";
import type { CpgDelta, CpgScopeArtifact, CpgSliceQuery, CpgSliceResult } from "../../../shared/contracts/cpg";
import type { IntelligenceEvidenceRecord, IntelligenceRelationshipRecord, IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";

export interface BuildAnalysisRequest {
  repositoryId: string;
  generation: number;
  program: ts.Program;
  files: SemanticSourceFileInput[];
  entities: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  analysisLevel: "basic" | "enriched";
}

export interface UpdateAnalysisRequest extends BuildAnalysisRequest {
  changedFileIds: string[];
  removedFileIds: string[];
}

export interface CodeAnalysisProvider {
  readonly id: string;
  readonly version: string;
  capabilities(): readonly string[];
  supports(language: string): boolean;
  build(request: BuildAnalysisRequest): Promise<CpgDelta>;
  update(request: UpdateAnalysisRequest): Promise<CpgDelta>;
  controlFlow(artifact: CpgScopeArtifact): CpgScopeArtifact;
  dataFlow(artifact: CpgScopeArtifact): CpgScopeArtifact;
  slice(artifact: CpgScopeArtifact, query: CpgSliceQuery): CpgSliceResult;
}

export class CpgProviderRegistry {
  private readonly providers: CodeAnalysisProvider[] = [];

  register(provider: CodeAnalysisProvider): void {
    if (this.providers.some((item) => item.id === provider.id)) throw new Error(`CPG provider ${provider.id} is already registered.`);
    this.providers.push(provider);
  }

  providerFor(language: string): CodeAnalysisProvider | undefined {
    return this.providers.find((provider) => provider.supports(language));
  }

  all(): readonly CodeAnalysisProvider[] { return this.providers; }
}
