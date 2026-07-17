import { IntelligenceQuerySchema, QueryCompilationSchema, QueryLimitsSchema, type IntelligenceQuery, type QueryCompilation, type QueryOperation } from "../../../shared/contracts/query";

export const QUERY_TEMPLATES: ReadonlyArray<{ id: string; label: string; template: string; operation: QueryOperation }> = [
  { id: "find", label: "Find entity", template: "find <entity>", operation: "SEARCH" },
  { id: "used", label: "Find usages", template: "where is <entity> used", operation: "USAGES" },
  { id: "callers", label: "Show callers", template: "what calls <entity>", operation: "DEPENDENTS" },
  { id: "callees", label: "Show callees", template: "what does <entity> call", operation: "DEPENDENCIES" },
  { id: "dependencies", label: "Dependencies", template: "dependencies of <entity>", operation: "DEPENDENCIES" },
  { id: "dependents", label: "Dependents", template: "dependents of <entity>", operation: "DEPENDENTS" },
  { id: "path", label: "Find path", template: "path from <entity> to <entity>", operation: "PATH" },
  { id: "impact", label: "Analyze impact", template: "what is impacted by <entity>", operation: "IMPACT" },
  { id: "tests", label: "Tests for entity", template: "tests for <entity>", operation: "TESTS_FOR" },
  { id: "untested", label: "Untested symbols", template: "untested methods in <module>", operation: "UNTESTED" },
  { id: "flow", label: "Show flow", template: "show <feature> flow", operation: "FLOW" },
  { id: "architecture", label: "Show architecture", template: "show architecture of <module>", operation: "ARCHITECTURE" },
  { id: "cycles", label: "Dependency cycles", template: "show dependency cycles", operation: "CYCLES" },
  { id: "configuration", label: "Configuration usage", template: "where is <configuration-key> used", operation: "CONFIGURATION_USAGE" },
  { id: "reads", label: "Table readers", template: "what reads <table>", operation: "DATA_USAGE" },
  { id: "writes", label: "Table writers", template: "what writes <table>", operation: "DATA_USAGE" },
  { id: "changes", label: "Entity changes", template: "changes to <entity>", operation: "CHANGES_TO" },
  { id: "difference", label: "Compare branches", template: "difference between <branch-a> and <branch-b>", operation: "DIFFERENCE_BETWEEN" },
  { id: "backward", label: "Backward slice", template: "backward slice from <node>", operation: "BACKWARD_SLICE" },
  { id: "forward", label: "Forward slice", template: "forward slice from <node>", operation: "FORWARD_SLICE" },
  { id: "conditions", label: "Guarding conditions", template: "conditions for <call-or-write>", operation: "CONDITIONS_FOR" }
];

interface Rule { id: string; expression: RegExp; compile(match: RegExpMatchArray): IntelligenceQuery }
const selector = (value: string, kind: "name" | "configuration" | "database" | "package" | "cpg-node" = "name") => ({ value: value.trim(), kind });
const base = (operation: QueryOperation, seeds?: IntelligenceQuery["seeds"]): IntelligenceQuery => ({ operation, ...(seeds ? { seeds } : {}), limits: QueryLimitsSchema.parse({}) });
const callTypes = ["keystone.core.CALLS", "keystone.core.INSTANTIATES"];
const dependencyTypes = ["keystone.core.IMPORTS", "keystone.core.REFERENCES", "keystone.core.CALLS", "keystone.core.DEPENDS_ON", "keystone.core.USES"];
const rules: Rule[] = [
  { id: "find", expression: /^find\s+(.+)$/i, compile: (m) => base("SEARCH", [selector(m[1]!)]) },
  { id: "where-used", expression: /^where\s+is\s+(.+?)\s+(?:used|configured)$/i, compile: (m) => { const value = m[1]!.trim(); return /^[A-Z][A-Z0-9_.-]+$/.test(value) ? base("CONFIGURATION_USAGE", [selector(value, "configuration")]) : base("USAGES", [selector(value)]); } },
  { id: "what-calls", expression: /^what\s+calls\s+(.+)$/i, compile: (m) => ({ ...base("DEPENDENTS", [selector(m[1]!)]), filters: { relationshipTypes: callTypes, confidenceAtLeast: 0 } }) },
  { id: "what-does-call", expression: /^what\s+does\s+(.+?)\s+call$/i, compile: (m) => ({ ...base("DEPENDENCIES", [selector(m[1]!)]), filters: { relationshipTypes: callTypes, confidenceAtLeast: 0 } }) },
  { id: "dependencies", expression: /^dependencies\s+of\s+(.+)$/i, compile: (m) => ({ ...base("DEPENDENCIES", [selector(m[1]!)]), filters: { relationshipTypes: dependencyTypes, confidenceAtLeast: 0 } }) },
  { id: "dependents", expression: /^dependents\s+of\s+(.+)$/i, compile: (m) => ({ ...base("DEPENDENTS", [selector(m[1]!)]), filters: { relationshipTypes: dependencyTypes, confidenceAtLeast: 0 } }) },
  { id: "path", expression: /^path\s+from\s+(.+?)\s+to\s+(.+)$/i, compile: (m) => ({ ...base("PATH", [selector(m[1]!), selector(m[2]!)]), traversal: { direction: "outgoing", maxDepth: 8, pathMode: "shortest" } }) },
  { id: "impact", expression: /^(?:what\s+is\s+impacted\s+by|impact\s+of(?:\s+changing)?)\s+(.+)$/i, compile: (m) => base("IMPACT", [selector(m[1]!)]) },
  { id: "tests", expression: /^tests\s+for\s+(.+)$/i, compile: (m) => base("TESTS_FOR", [selector(m[1]!)]) },
  { id: "untested", expression: /^untested\s+(?:methods|symbols)\s+in\s+(.+)$/i, compile: (m) => ({ ...base("UNTESTED", [selector(m[1]!, "package")]), filters: { publicOnly: true, confidenceAtLeast: 0 } }) },
  { id: "flow", expression: /^show\s+(.+?)\s+flow$/i, compile: (m) => base("FLOW", [selector(m[1]!)]) },
  { id: "architecture", expression: /^show\s+architecture\s+of\s+(.+)$/i, compile: (m) => base("ARCHITECTURE", [selector(m[1]!, "package")]) },
  { id: "cycles", expression: /^show\s+(?:dependency\s+)?cycles$/i, compile: () => base("CYCLES") },
  { id: "configuration", expression: /^where\s+is\s+(.+?)\s+used$/i, compile: (m) => base("CONFIGURATION_USAGE", [selector(m[1]!, "configuration")]) },
  { id: "reads", expression: /^what\s+reads\s+(.+)$/i, compile: (m) => ({ ...base("DATA_USAGE", [selector(m[1]!, "database")]), filters: { relationshipTypes: ["keystone.core.READS_FROM"], confidenceAtLeast: 0 } }) },
  { id: "writes", expression: /^what\s+writes\s+(.+)$/i, compile: (m) => ({ ...base("DATA_USAGE", [selector(m[1]!, "database")]), filters: { relationshipTypes: ["keystone.core.WRITES_TO", "keystone.core.PERSISTS"], confidenceAtLeast: 0 } }) },
  { id: "changes", expression: /^changes\s+to\s+(.+)$/i, compile: (m) => base("CHANGES_TO", [selector(m[1]!)]) },
  { id: "difference", expression: /^difference\s+between\s+(.+?)\s+and\s+(.+)$/i, compile: (m) => ({ ...base("DIFFERENCE_BETWEEN"), filters: { branch: m[1]!.trim(), compareTo: m[2]!.trim(), confidenceAtLeast: 0 } }) },
  { id: "backward-slice", expression: /^backward\s+slice\s+from\s+(.+)$/i, compile: (m) => base("BACKWARD_SLICE", [selector(m[1]!, "cpg-node")]) },
  { id: "forward-slice", expression: /^forward\s+slice\s+from\s+(.+)$/i, compile: (m) => base("FORWARD_SLICE", [selector(m[1]!, "cpg-node")]) },
  { id: "conditions", expression: /^conditions\s+for\s+(.+)$/i, compile: (m) => base("CONDITIONS_FOR", [selector(m[1]!, "cpg-node")]) }
];

export class QueryParser {
  parse(input: string, context: { generation?: number; branch?: string; currentFile?: string; limits?: Partial<ReturnType<typeof QueryLimitsSchema.parse>> } = {}): QueryCompilation {
    const text = normalize(input);
    if (/<[^>]+>/.test(text)) return QueryCompilationSchema.parse({ input, parsed: false, rule: "incomplete-template", diagnostics: [{ code: "query-placeholder-required", severity: "error", message: "Replace every template placeholder with a concrete repository value before running the query.", limitation: true }], suggestedTemplates: [] });
    for (const rule of rules) {
      const match = text.match(rule.expression); if (!match) continue;
      const raw = rule.compile(match);
      const query = IntelligenceQuerySchema.parse({ ...raw, ...(context.generation ? { generation: context.generation } : {}), ...(context.branch ? { branch: context.branch } : {}), filters: { ...(raw.filters ?? {}), ...(context.currentFile ? { currentFile: context.currentFile } : {}) }, limits: { ...(raw.limits ?? {}), ...(context.limits ?? {}) } });
      return QueryCompilationSchema.parse({ input, parsed: true, rule: rule.id, query, diagnostics: [], suggestedTemplates: [] });
    }
    return QueryCompilationSchema.parse({ input, parsed: false, rule: "unsupported", diagnostics: [{ code: "unsupported-query", severity: "error", message: "The input does not match Keystone's deterministic query grammar.", limitation: true }], suggestedTemplates: QUERY_TEMPLATES.slice(0, 10).map((item) => item.template) });
  }
}

export class QueryCompiler {
  constructor(private readonly parser = new QueryParser()) {}
  compile(input: string, context?: Parameters<QueryParser["parse"]>[1]): QueryCompilation { return this.parser.parse(input, context); }
  validate(query: IntelligenceQuery): ReturnType<typeof IntelligenceQuerySchema.parse> { return IntelligenceQuerySchema.parse(query); }
}

function normalize(value: string): string { return value.trim().replace(/[?]+$/, "").replace(/\s+/g, " "); }
