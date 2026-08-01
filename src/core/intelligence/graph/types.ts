import type { KnowledgeGraphStats } from "../../platform/storage/types";

/**
 * Knowledge Graph - Enhanced Types
 *
 * Symbol-level graph with file/class/function granularity.
 * Based on code-review-graph (tree-sitter), codegraph (TypeScript), GitNexus (MCP).
 *
 * Node types: File, Module, Class, Struct, Interface, Trait, Function, Method,
 *            Property, Field, Variable, Constant, Enum, EnumMember, TypeAlias,
 *            Namespace, Parameter, Import, Export, Route, Component
 *
 * Edge types: contains, calls, imports, exports, extends, implements,
 *            references, type_of, returns, instantiates, overrides, decorates
 */

export type NodeKind =
  | 'file'
  | 'module'
  | 'class'
  | 'struct'
  | 'interface'
  | 'trait'
  | 'function'
  | 'method'
  | 'property'
  | 'field'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'enum_member'
  | 'type_alias'
  | 'namespace'
  | 'parameter'
  | 'import'
  | 'export'
  | 'route'
  | 'component'
  // Extended node kinds used by graph builder and query engine
  | 'symbol'
  | 'owner'
  | 'change'
  | 'test'
  | 'package_script'
  | 'package_dependency'
  | 'config_usage'
  | 'runtime_behavior'
  | 'repository'
  | 'directory'
  | 'package_manifest'
  // Schema evolution (from GitNexus) — additional node kinds
  | 'macro'
  | 'typedef'
  | 'union'
  | 'annotation'
  | 'constructor'
  | 'template'
  | 'section'
  | 'tool'
  | 'code_element'
  | 'const'
  | 'static'
  | 'record'
  | 'delegate';

export type EdgeKind =
  | 'contains'      // Parent contains child (file→class, class→method)
  | 'calls'         // Function/method calls another
  | 'imports'       // File imports from another
  | 'exports'       // File exports a symbol
  | 'extends'       // Class/interface extends another
  | 'implements'    // Class implements interface
  | 'references'    // Generic reference to another symbol
  | 'type_of'       // Variable/parameter has type
  | 'returns'       // Function returns type
  | 'instantiates'  // Creates instance of class
  | 'overrides'     // Method overrides parent method
  | 'decorates'
  // Extended edge kinds used by graph builder and query engine
  | 'declares'     // File declares symbols/routes/config
  | 'covers'       // Test covers a file
  | 'observes'     // Runtime observes a file
  | 'owns'         // Owner owns a file
  | 'changes'      // Change affects a file
  // Schema evolution (from GitNexus) — additional edge kinds
  | 'inherits'          // Inherits from parent type
  | 'method_overrides'  // Method overrides parent implementation
  | 'method_implements' // Method implements interface contract
  | 'uses'              // Uses another resource (config, env var)
  | 'defines'           // Defines a symbol from a resource
  | 'has_method'        // Class/module contains a method
  | 'has_property'      // Class/struct contains a property
  | 'accesses'          // Accesses a resource or variable
  | 'member_of'         // Belongs to a containing entity
  | 'step_in_process'   // Step in a workflow or pipeline
  | 'handles_route'     // Handles a specific route
  | 'fetches'           // Fetches data from a source
  | 'handles_tool'      // Handles invocation of a tool
  | 'entry_point_of'    // Entry point of an execution flow
  | 'wraps'             // Wraps another symbol
  | 'queries';          // Queries a data source

// ---------------------------------------------------------------------------
// Co-change coupling (from axoniq / code-review-graph)
// ---------------------------------------------------------------------------

/** Edge kind for files that frequently change together (git co-change analysis) */
export type CouplingEdgeKind = 'coupled_with';

/** A relationship edge representing git co-change coupling between files */
export interface CouplingEdge {
  fileA: string;
  fileB: string;
  coChangeCount: number;
  lastCoChange: number;        // Unix timestamp
  couplingStrength: number;    // 0.0 – 1.0
}

// ---------------------------------------------------------------------------
// Execution flow (from code-review-graph / axoniq)
// ---------------------------------------------------------------------------

/** An execution flow (sequence of function calls forming a logical workflow) */
export interface ExecutionFlow {
  /** Flow name (derived from entry point name) */
  name: string;

  /** Entry-point node IDs */
  entryPointIds: string[];

  /** Node IDs in the flow (in traversal order) */
  nodeIds: string[];

  /** Edge IDs traversed */
  edgeIds: string[];

  /** Aggregated criticality score (0.0–1.0) */
  criticality: number;
}

/** Per-node contribution to the criticality score of an execution flow */
export interface CriticalityContribution {
  nodeId: string;
  filePath: string;
  externalScore: number;
  securityScore: number;
  testGap: number;
  depthScore: number;
}

// ---------------------------------------------------------------------------
// Test impact analysis (from Chisel / code-review-graph)
// ---------------------------------------------------------------------------

/** Risk factor for a changed file */
export interface RiskFactors {
  /** Flow participation score (cap 0.25) */
  flowParticipation: number;
  /** Community crossing penalty (cap 0.15) */
  communityCrossing: number;
  /** Test coverage score (0.30 at zero coverage → 0.05 when well-covered) */
  testCoverage: number;
  /** Security sensitivity (cap 0.20) */
  securitySensitivity: number;
  /** Caller count score (cap 0.10) */
  callerCount: number;
}

/** Detailed risk score for a changed file */
export interface RiskScore {
  /** Overall risk score (0.0 – 1.0) */
  risk: number;
  /** Contributing factors */
  factors: RiskFactors;
  /** Files affected by this change (direct + transitive) */
  affectedFilePaths: string[];
  /** Tests impacted by this change */
  impactedTestFilePaths: string[];
}

/** A test-to-code mapping edge */
export interface TestCodeEdge {
  /** Test file path */
  testFilePath: string;
  /** Code file path */
  codeFilePath: string;
  /** Edge type (covers, calls, imports, etc.) */
  edgeType: EdgeKind;
  /** Weight (0.0–1.0) */
  weight: number;
}

/** Test framework detection result */
export interface TestFramework {
  framework: string;
  patterns: string[];
}

// ---------------------------------------------------------------------------
// Community clustering with edge weights (from code-review-graph / axoniq)
// ---------------------------------------------------------------------------

/** Weight configuration for community detection — edges are weighted for Leiden */
export interface CommunityEdgeWeights {
  [edgeKind: string]: number;
}

/** Default edge weights for community detection (from code-review-graph) */
export const DEFAULT_COMMUNITY_EDGE_WEIGHTS: CommunityEdgeWeights = {
  'calls': 1.0,
  'imports': 0.5,
  'extends': 0.8,
  'implements': 0.7,
  'contains': 0.3,
  'covers': 0.4,
  'changes': 0.6,
  'references': 0.2,
  'returns': 0.6,
  'instantiates': 0.6,
  'overrides': 0.6,
};

// ---------------------------------------------------------------------------
// Discovery skip patterns (from codebase-memory-mcp-main)
// ---------------------------------------------------------------------------

/** Skip directories by category */
export type SkipPatternCategory =
  | 'vcs' | 'ide' | 'python' | 'js' | 'build' | 'language_cache' | 'deploy';

/** A single skip pattern */
export interface SkipPattern {
  /** Pattern name (e.g., "node_modules", ".git") */
  name: string;
  /** Category */
  category: SkipPatternCategory;
  /** Whether this is a directory name or file extension */
  type: 'dir' | 'ext';
}

// ---------------------------------------------------------------------------
// Reference resolution (from codebase-memory-mcp / axoniq)
// ---------------------------------------------------------------------------

/** Resolution strategy priority */
export type ResolutionStrategy =
  | 'module_path'     // Module-path resolution
  | 'namespace_map'   // Namespace-to-file mapping
  | 'symbol_name'     // Symbol-name fallback
  | 'lsp';            // LSP cross-reference (external)

/** Confidence floor for LSP cross-reference resolution */
export const LSP_CONFIDENCE_FLOOR = 0.6;

/** Resolved call from cross-file resolution */
export interface ResolvedCall {
  /** Qualified name of the caller */
  callerQn: string;
  /** Short name of the callee */
  calleeShortName: string;
  /** Qualified name of the resolved callee (if found) */
  calleeQn?: string;
  /** Confidence score (0.0 – 1.0) */
  confidence: number;
  /** Which strategy resolved this */
  strategy: ResolutionStrategy;
  /** Resolved line number (if available) */
  line?: number;
}

/** LSP definition for cross-file resolution */
export interface LSPDefinition {
  qualifiedName: string;
  shortName: string;
  label: 'class' | 'interface' | 'trait' | 'enum' | 'type' | 'protocol'
    | 'function' | 'method';
  receiverType?: string;
  returnTypes?: string[];
  embeddedTypes?: string[];
  defModuleQn?: string;
}

// ---------------------------------------------------------------------------
// Context compression (from headroom / caveman / ponytail)
// ---------------------------------------------------------------------------

/** Content type detected for compression routing */
export type CompressedContentType =
  | 'json_array'
  | 'source_code'
  | 'log_output'
  | 'grep_output'
  | 'unified_diff'
  | 'plain_text';

/** Configuration for context compression pipeline */
export interface CompressConfig {
  /** Maximum items to keep in a JSON array (default: 50) */
  maxItems?: number;
  /** Target ratio to keep (default: 0.15 = 15% of original) */
  targetRatio?: number;
  /** Don't compress last N messages (default: 4) */
  protectRecent?: number;
  /** Minimum tokens before compression kicks in (default: 250) */
  minTokensToCompress?: number;
  /** Use CCR (reversible compression) markers */
  useCcr?: boolean;
  /** CCR store TTL in seconds (default: 300) */
  ccrTtlSeconds?: number;
  /** Cache alignment enabled (default: true) */
  enableCacheAligner?: boolean;
}

/** Result of a compression operation */
export interface CompressionResult {
  /** The compressed content */
  content: string;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (0.0 = no savings, 1.0 = 100% removed) */
  compressionRatio: number;
  /** Transforms that were applied */
  transformsApplied: string[];
  /** CCR markers (if reversible compression used) */
  ccrMarkers?: string[];
}

/** CCR store for reversible compression */
export interface CcrStore {
  /** Store original content under a hash key */
  put(hash: string, payload: string): void;
  /** Retrieve original content by hash */
  get(hash: string): string | undefined;
  /** Clear expired entries */
  cleanup?(): void;
}

// ---------------------------------------------------------------------------
// Memory document (from the-librarian-main)
// ---------------------------------------------------------------------------

/** Memory status */
export type MemoryStatus = 'active' | 'proposed' | 'archived';

/** Memory confidence level */
export type MemoryConfidence = 'high' | 'medium' | 'low';

/** A memory document (from the-librarian's vault pattern) */
export interface MemoryDocument {
  /** Unique identifier */
  id: string;
  /** Title of the memory */
  title: string;
  /** Body content (markdown) */
  body: string;
  /** Which agent created this memory */
  agentId?: string;
  /** Current status */
  status: MemoryStatus;
  /** Confidence in this memory's accuracy */
  confidence: MemoryConfidence;
  /** Tags for categorization */
  tags: string[];
  /** Entities this memory applies to */
  appliesTo: string[];
  /** Memory IDs this memory supersedes */
  supersedes: string[];
  /** Memory IDs that conflict with this one */
  conflictsWith: string[];
  /** When the memory was created (ISO timestamp) */
  createdAt: string;
  /** When the memory was last updated (ISO timestamp) */
  updatedAt: string;
  /** Provenance note from curator operations */
  curatorNote?: string;
  /** Whether visible to all agents */
  isGlobal: boolean;
  /** Whether this needs human review before applying */
  requiresApproval: boolean;
  /** Agent flags for review routing */
  flags: string[];
}

// ---------------------------------------------------------------------------
// Temporal Edge Types (inspired by Graphiti's temporal knowledge graphs)
// ---------------------------------------------------------------------------

/**
 * Represents a time period with validity windows for temporal knowledge graphs.
 * Inspired by Graphiti's episodic node/edge model with valid_at/invalid_at.
 */
export interface TemporalEdge {
  /** Edge ID */
  edgeId: string;

  /** When this fact became valid (Unix timestamp in ms) */
  validAt?: number;

  /** When this fact became invalid (Unix timestamp in ms). If null/undefined, fact is currently valid. */
  invalidAt?: number;

  /** Whether the fact is currently valid */
  isValid(time?: number): boolean;

  /** The raw temporal bounds as a tuple */
  getBounds(): { validAt?: number; invalidAt?: number };
}

/**
 * An edge that carries temporal metadata about when it was true.
 * Modeled after Graphiti's EntityEdge with valid_at/invalid_at for contradiction detection.
 */
export interface TemporalKGEdge extends KGEdge {
  /** When this relationship became valid (Unix timestamp in ms) */
  validAt?: number;

  /** When this relationship became invalid (Unix timestamp in ms). Null means currently valid. */
  invalidAt?: number;

  /** Evidence/episode that established this temporal fact */
  episodeId?: string;

  /** Whether the fact was detected as contradictory (old facts invalidated) */
  invalidated?: boolean;
}

/**
 * An episodic ingestion unit that flows through extraction → resolution → save.
 * Inspired by Graphiti's EpisodeType (message, json, text).
 */
export type EpisodeType = 'message' | 'json' | 'text';

/**
 * An episode (raw ingestion) that produces nodes and edges.
 */
export interface Episode {
  /** Unique episode identifier */
  id: string;

  /** Type of episode source */
  type: EpisodeType;

  /** Content of the episode */
  content: string;

  /** When the episode was created */
  createdAt: number;

  /** Optional source reference (e.g., source revision hash, review identifier) */
  source?: string;

  /** The nodes extracted from this episode */
  extractedNodes: string[];

  /** The edges extracted from this episode */
  extractedEdges: string[];
}

export type GraphConfidence =
  | 'deterministic'  // Extracted from AST with certainty
  | 'inferred'       // Inferred from patterns (imports, naming)
  | 'heuristic';     // Heuristic matching (bare names, type inference)

export type Language =
  | 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'go' | 'rust'
  | 'java' | 'c' | 'cpp' | 'csharp' | 'php' | 'ruby' | 'swift' | 'kotlin'
  | 'dart' | 'svelte' | 'vue' | 'yaml' | 'scala' | 'lua' | 'luau' | 'objc'
  | 'perl' | 'elixir' | 'bash' | 'solidity' | 'verilog' | 'rescript'
  | 'notebook' | 'sql' | 'jsx' | 'vue' | 'svelte' | 'zig' | 'powershell'
  | 'r' | 'lua' | 'luau' | 'ocaml' | 'scheme' | 'racket' | 'nim' | 'crystal'
  | 'ada' | 'fortran' | 'julia' | 'haskell' | 'erlang' | 'clojure'
  | 'hcl' | 'terraform' | 'docker' | 'kubernetes' | 'makefile' | 'cmake'
  | 'graphql' | 'protobuf' | 'thrift' | 'wire' | 'asn1' | 'opa' | 'rego'
  | 'json' | 'aj' | 'clojure' | 'erlang' | 'haskell' | 'nim' | 'crystal'
  | 'ada' | 'fortran' | 'julia' | 'ocaml' | 'racket' | 'scheme'
  | 'solidity' | 'verilog' | 'rescript' | 'notebook' | 'sql'
  | 'powershell' | 'zig' | 'perl' | 'elixir' | 'bash' | 'rescript'
  | 'pascal' | 'd' | 'fortran' | 'julia' | 'lua' | 'luau'
  | 'unknown';

/**
 * A node in the knowledge graph representing a code symbol.
 */
export interface KGNode {
  /** Unique identifier (hash of file path + qualified name) */
  id: string;

  /** Type of code element */
  kind: NodeKind;

  /** Simple name (e.g., "calculateTotal") */
  name: string;

  /** Fully qualified name (e.g., "src/utils.ts::MathHelper.calculateTotal") */
  qualifiedName: string;

  /** File path relative to project root */
  filePath: string;

  /** Programming language */
  language: Language;

  /** Starting line number (1-indexed) */
  startLine: number;

  /** Ending line number (1-indexed) */
  endLine: number;

  /** Starting column (0-indexed) */
  startColumn: number;

  /** Ending column (0-indexed) */
  endColumn: number;

  /** Documentation string if present */
  docstring?: string;

  /** Function/method signature */
  signature?: string;

  /** Visibility modifier */
  visibility?: 'public' | 'private' | 'protected' | 'internal';

  /** Whether symbol is exported */
  isExported?: boolean;

  /** Whether symbol is async */
  isAsync?: boolean;

  /** Whether symbol is static */
  isStatic?: boolean;

  /** Whether symbol is abstract */
  isAbstract?: boolean;

  /** Decorators/annotations applied */
  decorators?: string[];

  /** Generic type parameters */
  typeParameters?: string[];

  /** Return type (for functions) */
  returnType?: string;

  /** Arbitrary metadata for extended node information (e.g., role, path, method) */
  metadata: Record<string, unknown>;

  /** Parent class/module name */
  parentName?: string;

  /** When the node was last indexed */
  indexedAt: number;

  // Extended fields used by graph builder
  workspaceId?: string;
  repoId?: string;
  source?: string;
}

/**
 * An edge representing a relationship between two nodes.
 */
export interface KGEdge {
  /** Unique edge identifier */
  id: string;

  /** Source node ID */
  source: string;

  /** Target node ID */
  target: string;

  /** Source node ID (alias for compatibility with graph builder) */
  fromNodeId?: string;

  /** Target node ID (alias for compatibility with graph builder) */
  toNodeId?: string;

  /** Type of relationship */
  kind: EdgeKind;

  /** Additional context about the relationship */
  metadata?: Record<string, unknown>;

  /** Line number where relationship occurs (e.g., call site) */
  line?: number;

  /** Column number where relationship occurs */
  column?: number;

  /** How this edge was created */
  provenance?: 'tree-sitter' | 'heuristic' | 'semantic';

  /** Confidence level (0.0 - 1.0 or string label like "deterministic") */
  confidence: number | string;

  // Temporal fields (inspired by Graphiti's temporal knowledge graphs)
  /** When this relationship became valid (Unix timestamp in ms) */
  validAt?: number;

  /** When this relationship became invalid (Unix timestamp in ms). Null means currently valid. */
  invalidAt?: number;

  /** Evidence/episode that established this temporal fact */
  episodeId?: string;

  /** Whether the fact was detected as contradictory (old facts invalidated) */
  invalidated?: boolean;

  // Extended fields used by graph builder
  workspaceId?: string;
  repoId?: string;
}

/**
 * Metadata about a tracked file.
 */
export interface FileRecord {
  /** File path relative to project root */
  path: string;

  /** Content hash for change detection */
  contentHash: string;

  /** Detected language */
  language: Language;

  /** File size in bytes */
  size: number;

  /** Last modification timestamp */
  modifiedAt: number;

  /** When last indexed */
  indexedAt: number;

  /** Number of nodes extracted */
  nodeCount: number;

  /** Any extraction errors */
  errors?: string[];
}

/**
 * Result from parsing a source file.
 */
export interface ExtractionResult {
  /** Extracted nodes */
  nodes: KGNode[];

  /** Extracted edges */
  edges: KGEdge[];

  /** References that couldn't be resolved yet */
  unresolvedReferences: UnresolvedReference[];

  /** Any errors during extraction */
  errors: string[];

  /** Extraction duration in milliseconds */
  durationMs: number;
}

/**
 * A reference that couldn't be resolved during extraction.
 */
export interface UnresolvedReference {
  /** ID of the node containing the reference */
  fromNodeId: string;

  /** Name being referenced */
  referenceName: string;

  /** Type of reference */
  referenceKind: EdgeKind;

  /** Location of the reference */
  line: number;
  column: number;
}

/**
 * A subgraph containing a subset of the knowledge graph.
 */
export interface Subgraph {
  /** Nodes in this subgraph */
  nodes: Map<string, KGNode>;

  /** Edges in this subgraph */
  edges: KGEdge[];

  /** Root node IDs (entry points) */
  roots: string[];
}

/**
 * Graph statistics.
 */
export interface GraphStats {
  /** Total number of nodes */
  nodeCount: number;

  /** Total number of edges */
  edgeCount: number;

  /** Number of tracked files */
  fileCount: number;

  /** Node counts by kind */
  nodesByKind: Record<NodeKind, number>;

  /** Edge counts by kind */
  edgesByKind: Record<EdgeKind, number>;

  /** File counts by language */
  filesByLanguage: Record<Language, number>;

  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Context information for code understanding.
 */
export interface Context {
  /** Primary node being examined */
  focal: KGNode;

  /** Nodes containing the focal node (file, class, etc.) */
  ancestors: KGNode[];

  /** Nodes directly contained by focal node */
  children: KGNode[];

  /** Incoming references (who calls/uses this) */
  incomingRefs: Array<{ node: KGNode; edge: KGEdge }>;

  /** Outgoing references (what this calls/uses) */
  outgoingRefs: Array<{ node: KGNode; edge: KGEdge }>;

  /** Related type information */
  types: KGNode[];

  /** Relevant imports */
  imports: KGNode[];
}

/**
 * A block of code with context.
 */
export interface CodeBlock {
  /** The code content */
  content: string;

  /** File path */
  filePath: string;

  /** Starting line */
  startLine: number;

  /** Ending line */
  endLine: number;

  /** Language for syntax highlighting */
  language: Language;

  /** Associated node if extracted */
  node?: KGNode;
}

/**
 * Task context for building relevant code context.
 */
export interface TaskContext {
  /** The original query/task */
  query: string;

  /** Subgraph of relevant nodes and edges */
  subgraph: Subgraph;

  /** Entry point nodes (from semantic search) */
  entryPoints: KGNode[];

  /** Code blocks extracted from key nodes */
  codeBlocks: CodeBlock[];

  /** Files involved in this context */
  relatedFiles: string[];

  /** Brief summary of the context */
  summary: string;

  /** Statistics about the context */
  stats: {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    codeBlockCount: number;
    totalCodeSize: number;
  };
}

/**
 * Options for building task context.
 */
export interface BuildContextOptions {
  /** Maximum number of nodes to include (default: 50) */
  maxNodes?: number;

  /** Maximum number of code blocks to include (default: 10) */
  maxCodeBlocks?: number;

  /** Maximum characters per code block (default: 2000) */
  maxCodeBlockSize?: number;

  /** Whether to include code blocks (default: true) */
  includeCode?: boolean;

  /** Output format (default: 'markdown') */
  format?: 'markdown' | 'json';

  /** Number of semantic search results (default: 5) */
  searchLimit?: number;

  /** Graph traversal depth from entry points (default: 2) */
  traversalDepth?: number;

  /** Minimum semantic similarity score (default: 0.3) */
  minScore?: number;
}

/**
 * Options for graph traversal.
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number;

  /** Edge types to follow (default: all) */
  edgeKinds?: EdgeKind[];

  /** Node types to include (default: all) */
  nodeKinds?: NodeKind[];

  /** Direction of traversal */
  direction?: 'outgoing' | 'incoming' | 'both';

  /** Maximum nodes to return */
  limit?: number;

  /** Whether to include the starting node */
  includeStart?: boolean;
}

/**
 * Backward compatibility aliases for old type names.
 * These are kept for compatibility with existing modules.
 */
export type GraphNode = KGNode;
export type GraphEdge = KGEdge;
export type KnowledgeGraph = {
  nodes: KGNode[];
  edges: KGEdge[];
  workspaceId?: string;
  repoId?: string;
  stats?: KnowledgeGraphStats;
};
export type GraphNodeKind = NodeKind;

// Add old node/edge kinds for backward compatibility
export type OldNodeKind =
  | 'repository'
  | 'directory'
  | 'file'
  | 'package_manifest'
  | 'package_script'
  | 'package_dependency'
  | 'test'
  | 'route'
  | 'config_usage'
  | 'runtime_behavior'
  | 'owner'
  | 'change'
  | 'symbol';

export type OldEdgeKind = 'contains' | 'declares' | 'imports' | 'calls' | 'covers' | 'observes' | 'owns' | 'changes';

/**
 * Options for searching the graph.
 */
export interface SearchOptions {
  /** Node types to search */
  kinds?: NodeKind[];

  /** Languages to include */
  languages?: Language[];

  /** File path patterns to include */
  includePatterns?: string[];

  /** File path patterns to exclude */
  excludePatterns?: string[];

  /** Maximum results to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Whether search is case-sensitive */
  caseSensitive?: boolean;
}

/**
 * A search result with relevance scoring.
 */
export interface KGSearchResult {
  /** Matching node */
  node: KGNode;

  /** Relevance score (0-1) */
  score: number;

  /** Matched text snippets for highlighting */
  highlights?: string[];
}

// ---------------------------------------------------------------------------
// Schema Evolution (from GitNexus)
// ---------------------------------------------------------------------------

/**
 * Evidence trace for an edge — tracks which extraction signals contributed
 * to creating this edge, with per-signal weights and notes.
 * Based on GitNexus's GraphRelationship.evidence field.
 */
export interface EvidenceTrace {
  /** Signal kind (e.g., "imports", "calls", "lint", "semantic") */
  kind: string;
  /** Weight/contribution of this signal (0-1) */
  weight: number;
  /** Optional human-readable note about this evidence */
  note?: string;
}

/**
 * GitNexus relationship type names (uppercase constants).
 * Maps to EdgeKind values but provides a stable API for MCP tools.
 */
export const RELATIONSHIP_TYPES = {
  CONTAINS: 'contains',
  CALLS: 'calls',
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  EXTENDS: 'extends',
  IMPLEMENTS: 'implements',
  REFERENCES: 'references',
  TYPE_OF: 'type_of',
  RETURNS: 'returns',
  INSTANTIATES: 'instantiates',
  OVERRIDES: 'overrides',
  DECORATES: 'decorates',
  DECLARES: 'declares',
  COVERS: 'covers',
  OBSERVES: 'observes',
  OWNS: 'owns',
  CHANGES: 'changes',
  INHERITS: 'inherits',
  METHOD_OVERRIDES: 'method_overrides',
  METHOD_IMPLEMENTS: 'method_implements',
  USES: 'uses',
  DEFINES: 'defines',
  HAS_METHOD: 'has_method',
  HAS_PROPERTY: 'has_property',
  ACCESSES: 'accesses',
  MEMBER_OF: 'member_of',
  STEP_IN_PROCESS: 'step_in_process',
  HANDLES_ROUTE: 'handles_route',
  FETCHES: 'fetches',
  HANDLES_TOOL: 'handles_tool',
  ENTRY_POINT_OF: 'entry_point_of',
  WRAPS: 'wraps',
  QUERIES: 'queries',
} as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[keyof typeof RELATIONSHIP_TYPES];

/**
 * Pipeline phase names for incremental indexing.
 * From GitNexus pipeline.ts.
 */
export const PIPELINE_PHASES = {
  DISCOVERY: 'discovery',
  EXTRACTION: 'extraction',
  STORAGE: 'storage',
  INDEXING: 'indexing',
  ANALYSIS: 'analysis',
  QUERY: 'query',
} as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[keyof typeof PIPELINE_PHASES];
