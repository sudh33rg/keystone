export type CpgNodeKind = "file" | "syntax" | "declaration";

export type CpgEdgeKind = "ast" | "eog" | "cfg" | "dfg" | "cdg" | "call";

export interface CpgLocation {
  readonly path: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface CpgNode {
  readonly id: string;
  readonly kind: CpgNodeKind;
  readonly language: string;
  readonly syntaxKind: string;
  readonly name?: string;
  readonly location: CpgLocation;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Canonical OKF unit represented by this CPG node, when resolvable. */
  readonly okfId?: string;
}

export interface CpgEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: CpgEdgeKind;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly okfSourceId?: string;
  readonly okfTargetId?: string;
}

export interface CpgCapabilities {
  /** Whether edges are compiler-bound or deterministic structural approximations. */
  readonly analysisLevel: "compiler" | "structural";
  readonly ast: boolean;
  readonly eog: boolean;
  readonly cfg: boolean;
  readonly dfg: boolean;
  readonly cdg: boolean;
  readonly typeResolution: boolean;
}

export interface CodePropertyGraph {
  readonly schemaVersion: 1;
  readonly language: string;
  readonly sourcePath: string;
  readonly contentHash: string;
  readonly capabilities: CpgCapabilities;
  readonly nodes: readonly CpgNode[];
  readonly edges: readonly CpgEdge[];
}
