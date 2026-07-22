import type { TreeSitterNode } from "./TreeSitterNode";

export interface StructuralAnalysis {
  functions: Array<{
    name: string;
    lineRange: [number, number];
    params: string[];
    returnType?: string;
  }>;
  classes: Array<{
    name: string;
    lineRange: [number, number];
    methods: string[];
    properties: string[];
  }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

/**
 * Language-specific extractor that maps a tree-sitter AST to the common
 * StructuralAnalysis / CallGraphEntry types. Mirrors the reference
 * `LanguageExtractor` contract.
 */
export interface LanguageExtractor {
  /** Language IDs this extractor handles (must match LanguageConfig.id). */
  readonly languageIds: string[];
  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis;
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[];
}
