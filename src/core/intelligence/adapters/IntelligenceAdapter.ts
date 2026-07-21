import type {
  AdapterCapability,
  AdapterDetection,
  AdapterDiagnostic,
  AdapterOutput,
} from "../../../shared/contracts/adapters";
import type { SemanticProjectRequest, SemanticSourceFileInput } from "../semantic/SemanticModel";

export interface AdapterContext {
  repositoryId: string;
  generation: number;
  jobRevision: number;
  branch?: string;
  commit?: string;
  allFiles: readonly SemanticSourceFileInput[];
  detections: readonly AdapterDetection[];
}

export interface AdapterInput {
  files: readonly SemanticSourceFileInput[];
  context: AdapterContext;
}

export interface IntelligenceAdapter {
  readonly id: string;
  readonly version: string;
  capability(): AdapterCapability;
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[];
  analyze(input: AdapterInput): Promise<AdapterOutput>;
}

export type LanguageAdapter = IntelligenceAdapter & { readonly family?: "language" };
export type FrameworkAdapter = IntelligenceAdapter & { readonly family?: "framework" };
export type TestFrameworkAdapter = IntelligenceAdapter & { readonly family?: "test" };
export type DocumentationAdapter = IntelligenceAdapter & { readonly family?: "documentation" };
export type DatabaseAdapter = IntelligenceAdapter & { readonly family?: "database" };
export type OrmAdapter = IntelligenceAdapter & { readonly family?: "orm" };
export type ContractAdapter = IntelligenceAdapter & { readonly family?: "contract" };
export type BuildAdapter = IntelligenceAdapter & { readonly family?: "build" };
export type PackageManagerAdapter = IntelligenceAdapter & { readonly family?: "package-manager" };
export type InfrastructureAdapter = IntelligenceAdapter & { readonly family?: "infrastructure" };
export type ConfigurationAdapter = IntelligenceAdapter & { readonly family?: "configuration" };
export type FallbackAdapter = IntelligenceAdapter & { readonly family?: "fallback" };

export interface UniversalAdapterResult {
  request: SemanticProjectRequest;
  outputs: AdapterOutput[];
  detections: AdapterDetection[];
  diagnostics: AdapterDiagnostic[];
}
