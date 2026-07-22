/**
 * Minimal structural type for a web-tree-sitter AST node, typed enough for the
 * extractors without importing the WASM runtime at module load time.
 */
export interface TreeSitterNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly childCount: number;
  readonly parent: TreeSitterNode | null;
  readonly children: TreeSitterNode[];
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
}
