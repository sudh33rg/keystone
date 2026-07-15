export interface SemanticExtractionContext {
  extractSymbols(): void;
  extractImportsAndExports(): void;
  resolveReferences(): void;
  resolveCalls(): void;
  resolveTypes(): void;
  extractReact(): void;
  extractRoutes(): void;
  extractTests(): void;
  extractPackages(): void;
  extractConfiguration(): void;
}

export interface SemanticExtractionStage { readonly id: string; extract(context: SemanticExtractionContext): void }

export class SymbolExtractor implements SemanticExtractionStage { readonly id = "symbols"; extract(context: SemanticExtractionContext): void { context.extractSymbols(); } }
export class ImportExportExtractor implements SemanticExtractionStage { readonly id = "imports-exports"; extract(context: SemanticExtractionContext): void { context.extractImportsAndExports(); } }
export class ReferenceResolver implements SemanticExtractionStage { readonly id = "references"; extract(context: SemanticExtractionContext): void { context.resolveReferences(); } }
export class CallResolver implements SemanticExtractionStage { readonly id = "calls"; extract(context: SemanticExtractionContext): void { context.resolveCalls(); } }
export class TypeRelationshipResolver implements SemanticExtractionStage { readonly id = "types"; extract(context: SemanticExtractionContext): void { context.resolveTypes(); } }
export class ReactExtractor implements SemanticExtractionStage { readonly id = "react"; extract(context: SemanticExtractionContext): void { context.extractReact(); } }
export class RouteExtractor implements SemanticExtractionStage { readonly id = "routes"; extract(context: SemanticExtractionContext): void { context.extractRoutes(); } }
export class TestExtractor implements SemanticExtractionStage { readonly id = "tests"; extract(context: SemanticExtractionContext): void { context.extractTests(); } }
export class PackageMetadataExtractor implements SemanticExtractionStage { readonly id = "packages"; extract(context: SemanticExtractionContext): void { context.extractPackages(); } }
export class ConfigurationReferenceExtractor implements SemanticExtractionStage { readonly id = "configuration"; extract(context: SemanticExtractionContext): void { context.extractConfiguration(); } }

export const semanticExtractionStages: readonly SemanticExtractionStage[] = [
  new PackageMetadataExtractor(),
  new SymbolExtractor(),
  new ImportExportExtractor(),
  new TypeRelationshipResolver(),
  new TestExtractor(),
  new RouteExtractor(),
  new CallResolver(),
  new ReferenceResolver(),
  new ReactExtractor(),
  new ConfigurationReferenceExtractor()
];
