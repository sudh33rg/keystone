import type { ApiEndpoint, CodeSymbol, ControlFlowFact, DataFlowFact, DependencyEdge, SemanticCall, TypeRelationshipFact } from '../../domain/types';

export interface SemanticEnrichmentRequest {
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly languageId: string;
  readonly text: string;
  readonly signal?: AbortSignal;
}

export interface SemanticProviderCapabilities {
  readonly documentSymbols: boolean;
  readonly definitions: boolean;
  readonly references: boolean;
  readonly implementations: boolean;
  readonly callHierarchy: boolean;
}

export interface SemanticEnrichmentResult {
  readonly provider: string;
  readonly providerLanguageId?: string;
  readonly capabilities: SemanticProviderCapabilities;
  readonly symbols: readonly CodeSymbol[];
  readonly dependencies?: readonly DependencyEdge[];
  readonly calls?: readonly SemanticCall[];
  readonly controlFlows?: readonly ControlFlowFact[];
  readonly dataFlows?: readonly DataFlowFact[];
  readonly typeRelationships?: readonly TypeRelationshipFact[];
  readonly apis?: readonly ApiEndpoint[];
  readonly referenceCount?: number;
  readonly warnings?: readonly string[];
}

export interface SemanticEnrichmentProvider {
  enrich(request: SemanticEnrichmentRequest): Promise<SemanticEnrichmentResult | undefined>;
}

export interface LanguageSupportSummary {
  readonly id: string;
  readonly label: string;
  readonly files: number;
  readonly baseline: 'compiler' | 'deterministic-structural' | 'structural-artifact' | 'universal-text';
  readonly semanticProvider: 'typescript-compiler' | 'vscode-language-service' | 'none';
  readonly semanticFiles: number;
  readonly deterministicFiles: number;
  readonly failedSemanticFiles: number;
  readonly capabilities: {
    readonly symbols: boolean;
    readonly definitions: boolean;
    readonly references: boolean;
    readonly implementations: boolean;
    readonly calls: boolean;
    readonly controlFlow: boolean;
    readonly dataFlow: boolean;
    readonly cpg: boolean;
  };
  readonly warnings: readonly string[];
}
