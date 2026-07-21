/**
 * QueryPhraseDictionary (spec §7).
 *
 * Centralized, extensible phrase dictionary. NOT spread across UI components.
 * Project-specific aliases are loaded from local configuration (merge into `aliases`).
 *
 * Deterministic phrase -> intent + direction + type hints used by the parser (§6).
 */
import type { PhraseEntry } from "../../../shared/contracts/engineeringQuery";

export interface ProjectAliases {
  alias: string;
  canonical: string;
}

const BUILT_IN_ENTRIES: ReadonlyArray<PhraseEntry> = [
  // ---- Call relationships (§7) ----
  {
    patterns: ["calls", "caller", "called by", "invokes", "invoked by"],
    intent: "show-callers",
    direction: "inbound",
  },
  {
    patterns: ["calls", "callee", "invoked by", "invokes", "who calls", "callers of"],
    intent: "show-callers",
    direction: "inbound",
  },
  {
    patterns: ["what does", "does .* call", "callees of", "methods called by"],
    intent: "show-callees",
    direction: "outbound",
  },

  // ---- Usages / references ----
  {
    patterns: [
      "usages of",
      "used by",
      "uses",
      "references",
      "where is .* used",
      "where is .* referenced",
    ],
    intent: "show-usages",
    direction: "both",
  },
  {
    patterns: ["references", "all references", "referenced by"],
    intent: "show-references",
    direction: "both",
  },

  // ---- Dependencies (§7) ----
  {
    patterns: ["depends on", "dependencies of", "dependency", "imports", "what does .* depend on"],
    intent: "show-dependencies",
    direction: "outbound",
  },
  {
    patterns: [
      "imported by",
      "consumers",
      "dependent modules",
      "dependents of",
      "what depends on",
      "who depends on",
      "what modules depend on",
    ],
    intent: "show-dependents",
    direction: "inbound",
  },

  // ---- Implementations / inheritance ----
  {
    patterns: ["implementations of", "implementations", "who implements", "classes that implement"],
    intent: "show-implementations",
    direction: "both",
    subjectTypeHint: "keystone.core.Interface",
  },
  {
    patterns: ["inherits", "subclasses", "extends", "inheritance", "who extends"],
    intent: "show-inheritance",
    direction: "both",
  },

  // ---- Tests (§7) ----
  {
    patterns: [
      "tests for",
      "related tests",
      "test coverage",
      "covered by",
      "which tests cover",
      "which tests are impacted",
      "impacted tests",
      "affected tests",
    ],
    intent: "show-related-tests",
    direction: "both",
    subjectTypeHint: "test",
  },
  {
    patterns: ["code covered by", "covered code", "what does this test cover"],
    intent: "show-covered-code",
    direction: "both",
  },
  {
    patterns: ["unmapped tests", "tests not mapped", "tests without coverage"],
    intent: "show-related-tests",
    direction: "both",
  },

  // ---- Impact (§7) ----
  {
    patterns: [
      "impacted by",
      "affected by",
      "breaks",
      "what breaks",
      "what changes if",
      "risk of changing",
      "blast radius",
      "downstream",
      "impact of",
      "what is impacted",
    ],
    intent: "show-impact",
    direction: "both",
  },

  // ---- Flows / paths (§7) ----
  {
    patterns: ["flow from", "flow to", "complete flow", "data flow", "show flow"],
    intent: "show-flow",
    direction: "both",
  },
  {
    patterns: [
      "path from",
      "path to",
      "show path",
      "route from",
      "reaches",
      "from .* to",
      "ends at",
    ],
    intent: "show-path",
    direction: "both",
  },
  {
    patterns: [
      "api to storage",
      "api to database",
      "route to table",
      "storage path",
      "writes to table",
    ],
    intent: "show-api-storage-path",
    direction: "outbound",
  },

  // ---- Data (§7) ----
  {
    patterns: ["reads from", "data reads", "read by", "what reads"],
    intent: "show-data-reads",
    direction: "both",
  },
  {
    patterns: ["writes to", "data writes", "what writes", "where is .* written"],
    intent: "show-data-writes",
    direction: "both",
  },

  // ---- Entry points / side effects / architecture (§7) ----
  {
    patterns: ["entry points", "entrypoints", "public surface"],
    intent: "show-entry-points",
    direction: "inbound",
  },
  {
    patterns: ["side effects", "what does .* affect", "mutates"],
    intent: "show-side-effects",
    direction: "outbound",
  },
  {
    patterns: [
      "architecture around",
      "architecture of",
      "module structure",
      "surrounding components",
      "boundaries",
      "overview of",
    ],
    intent: "show-architecture",
    direction: "both",
  },

  // ---- Evidence ----
  {
    patterns: ["evidence for", "relationship evidence", "why does", "how does", "prove that"],
    intent: "show-evidence",
    direction: "both",
  },
  {
    patterns: ["unresolved relationships", "low confidence relationships", "weak relationships"],
    intent: "show-evidence",
    direction: "both",
  },

  // ---- Configuration / events ----
  {
    patterns: [
      "configuration used",
      "config usage",
      "where is .* configured",
      "uses configuration",
    ],
    intent: "show-configuration-usage",
    direction: "both",
  },
  {
    patterns: [
      "event handlers",
      "handlers for",
      "who handles",
      "subscribes to",
      "what handles event",
    ],
    intent: "show-event-handlers",
    direction: "both",
    subjectTypeHint: "keystone.core.Event",
  },

  // ---- Compare ----
  {
    patterns: ["compare", "difference between", "diff between"],
    intent: "compare-entities",
    direction: "both",
  },

  // ---- Describe / find ----
  {
    patterns: ["describe", "what is", "explain", "tell me about"],
    intent: "describe-entity",
    direction: "both",
  },
  { patterns: ["find", "locate", "search for entity"], intent: "find-entity", direction: "both" },
];

export class QueryPhraseDictionary {
  private readonly entries: PhraseEntry[];
  private readonly aliasMap: Map<string, string>;

  constructor(projectAliases: ProjectAliases[] = []) {
    this.entries = [...BUILT_IN_ENTRIES];
    this.aliasMap = new Map(projectAliases.map((a) => [a.alias.toLowerCase(), a.canonical]));
  }

  /** Add project-specific phrase entries (e.g. loaded from settings). */
  register(entries: PhraseEntry[]): void {
    this.entries.push(...entries);
  }

  resolveAlias(value: string): string {
    return this.aliasMap.get(value.trim().toLowerCase()) ?? value;
  }

  entries_(): ReadonlyArray<PhraseEntry> {
    return this.entries;
  }
}
