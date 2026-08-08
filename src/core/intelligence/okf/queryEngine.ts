import type {
  KeystoneKnowledgeRelationship,
  KeystoneKnowledgeUnit,
  KeystoneOkfSnapshot,
  OkfEvidence
} from "./types";
import { analyzeOkfStructure } from "./structuralAnalysis";

/** The shared graph-backed operations used by the cockpit and Copilot delegation. */
export type OkfIntelligenceOperation = "query" | "path" | "explain" | "flow" | "impact" | "reuse";

export interface OkfOperationRequest {
  readonly operation: OkfIntelligenceOperation;
  readonly query: string;
  readonly from?: string;
  readonly to?: string;
  readonly changedPaths?: readonly string[];
  readonly limit?: number;
}

export interface OkfOperationEvidence {
  readonly evidenceIds: readonly string[];
  readonly paths: readonly string[];
  readonly lines: readonly number[];
}

export interface OkfPathStep {
  readonly nodeId: string;
  readonly label: string;
  readonly kind: string;
  readonly relationshipFromPrevious?: string;
  readonly confidence: number;
  readonly provenance: string;
  readonly evidence: OkfOperationEvidence;
}

export interface OkfPathResult {
  readonly operation: "path";
  readonly from: string;
  readonly to: string;
  readonly found: boolean;
  readonly nodes: readonly OkfPathStep[];
  readonly alternativePath: boolean;
  readonly confidence: number;
  readonly evidence: OkfOperationEvidence;
  readonly warnings: readonly string[];
}

export interface OkfExplainResult {
  readonly operation: "explain";
  readonly subject?: OkfQueryItem;
  readonly role?: string;
  readonly community?: { id: string; label: string };
  readonly architectureAnchor?: { weightedDegree: number; reason: string };
  readonly callers: readonly OkfQueryItem[];
  readonly callees: readonly OkfQueryItem[];
  readonly dependencies: readonly OkfQueryItem[];
  readonly contracts: readonly OkfQueryItem[];
  readonly flows: readonly OkfQueryItem[];
  readonly evidence: OkfOperationEvidence;
  readonly warnings: readonly string[];
}

export interface OkfFlowResult {
  readonly operation: "flow";
  readonly query: string;
  readonly nodes: readonly OkfPathStep[];
  readonly relationships: readonly OkfQueryTraversal[];
  readonly evidence: OkfOperationEvidence;
  readonly warnings: readonly string[];
}

export interface OkfImpactItem extends OkfQueryItem {
  readonly impact: "direct" | "probable" | "possible";
}

export interface OkfImpactResult {
  readonly operation: "impact";
  readonly target: string;
  readonly direct: readonly OkfImpactItem[];
  readonly probable: readonly OkfImpactItem[];
  readonly possible: readonly OkfImpactItem[];
  readonly evidence: OkfOperationEvidence;
  readonly warnings: readonly string[];
}

export interface OkfReuseCandidate {
  readonly candidate: OkfQueryItem;
  readonly whyItMatches: readonly string[];
  readonly whereUsed: readonly OkfQueryItem[];
  readonly relationships: readonly OkfQueryTraversal[];
  readonly evidence: OkfOperationEvidence;
}

export interface OkfReuseResult {
  readonly operation: "reuse";
  readonly intent: string;
  readonly candidates: readonly OkfReuseCandidate[];
  readonly warnings: readonly string[];
}

export type OkfOperationResult =
  | OkfQueryResult
  | OkfPathResult
  | OkfExplainResult
  | OkfFlowResult
  | OkfImpactResult
  | OkfReuseResult;

export type OkfQueryIntent =
  | "definition"
  | "callers"
  | "callees"
  | "dependencies"
  | "dependents"
  | "tests"
  | "impact"
  | "api"
  | "flow"
  | "security"
  | "performance"
  | "data"
  | "configuration"
  | "documentation"
  | "technology"
  | "generic"
  | "compound";

export interface OkfQueryItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly path?: string;
  readonly line?: number;
  readonly summary: string;
  readonly reason: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly relationshipPath: readonly string[];
}

export interface OkfQueryTraversal {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationship: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
}
export interface OkfQueryPlan {
  readonly terms: readonly string[];
  readonly seedIds: readonly string[];
  readonly seedLabels: readonly string[];
  readonly relationshipKinds: readonly string[];
  readonly maxDepth: number;
  readonly strategy: string;
}

export interface OkfQueryResult {
  readonly query: string;
  readonly intent: OkfQueryIntent;
  readonly answer: string;
  readonly confidence: number;
  readonly items: readonly OkfQueryItem[];
  readonly traversedRelationships: number;
  readonly warnings: readonly string[];
  readonly plan: OkfQueryPlan;
  readonly traversals: readonly OkfQueryTraversal[];
}

const STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "change",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "show",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "would"
]);
const FILE_LIKE = new Set(["file", "test", "documentation", "configuration"]);

export function queryOkfSnapshot(
  snapshot: KeystoneOkfSnapshot,
  query: string,
  limit = 50
): OkfQueryResult {
  const normalized = query.trim();
  if (!normalized)
    return {
      query,
      intent: "generic",
      answer: "Enter a repository intelligence question.",
      confidence: 0,
      items: [],
      traversedRelationships: 0,
      warnings: [],
      plan: {
        terms: [],
        seedIds: [],
        seedLabels: [],
        relationshipKinds: [],
        maxDepth: 0,
        strategy: "No query supplied."
      },
      traversals: []
    };
  const intents = classifyAll(normalized);
  const intent: OkfQueryIntent = intents.length > 1 ? "compound" : intents[0];
  const terms = tokenize(normalized);
  const activeUnits = snapshot.units.filter((unit) => unit.lifecycle === "active");
  const activeRelationships = snapshot.relationships.filter((rel) => rel.lifecycle === "active");
  const byId = new Map(activeUnits.map((unit) => [unit.id, unit]));
  const testUnitsByPath = new Map(
    activeUnits
      .filter((unit) => unit.kind === "test")
      .map((unit) => [unitPath(unit) ?? unit.name, unit])
  );
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const seedScores = new Map<string, number>();

  for (const unit of activeUnits) {
    const score = unitScore(unit, normalized, terms, intent);
    if (score > 0) seedScores.set(unit.id, score);
  }

  const seeds = [...seedScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([id]) => id);
  const candidates = new Map<string, { score: number; reasons: Set<string>; path: string[] }>();
  const add = (id: string, score: number, reason: string, relPath: string[] = []) => {
    if (!byId.has(id)) return;
    const current = candidates.get(id) ?? { score: 0, reasons: new Set<string>(), path: [] };
    current.score = Math.max(current.score, score);
    current.reasons.add(reason);
    if (!current.path.length || (relPath.length && relPath.length < current.path.length))
      current.path = relPath;
    candidates.set(id, current);
  };

  for (const seed of seeds) add(seed, seedScores.get(seed) ?? 0, "direct repository match");

  let traversed = 0;
  const traversals: OkfQueryTraversal[] = [];
  const outgoing = new Map<string, KeystoneKnowledgeRelationship[]>();
  const incoming = new Map<string, KeystoneKnowledgeRelationship[]>();
  for (const rel of activeRelationships) {
    const out = outgoing.get(rel.sourceId) ?? [];
    out.push(rel);
    outgoing.set(rel.sourceId, out);
    const inc = incoming.get(rel.targetId) ?? [];
    inc.push(rel);
    incoming.set(rel.targetId, inc);
  }

  const follow = (
    from: string,
    rel: KeystoneKnowledgeRelationship,
    next: string,
    score: number,
    reason: string,
    pathPrefix: string[]
  ) => {
    traversed += 1;
    const sourceId = rel.sourceId,
      targetId = rel.targetId;
    if (traversals.length < 250)
      traversals.push({
        sourceId,
        targetId,
        relationship: rel.kind,
        sourceLabel: label(byId.get(sourceId)),
        targetLabel: label(byId.get(targetId))
      });
    add(next, score, reason, [
      ...pathPrefix,
      `${label(byId.get(from))} -[${rel.kind}]-> ${label(byId.get(next))}`
    ]);
  };

  for (const seed of seeds.slice(0, 10)) {
    const seedScore = seedScores.get(seed) ?? 1;
    const out = outgoing.get(seed) ?? [];
    const inc = incoming.get(seed) ?? [];
    const seedUnit = byId.get(seed)!;

    for (const queryIntent of intents) {
      if (queryIntent === "callers") {
        for (const rel of inc.filter((rel) => rel.kind === "calls")) {
          follow(
            seed,
            rel,
            rel.sourceId,
            seedScore + 4,
            "caller via repository call relationship",
            []
          );
          // A CPG-derived call-flow can represent a test caller without itself being the
          // user-facing test concept. Promote the canonical test unit so compound
          // questions such as “what calls X and which tests cover it?” surface the test.
          if (intents.includes("tests")) {
            const caller = byId.get(rel.sourceId);
            const callerPath = caller ? (unitPath(caller) ?? "") : "";
            const testUnit = callerPath ? testUnitsByPath.get(callerPath) : undefined;
            if (testUnit)
              add(testUnit.id, seedScore + 5, "mapped test caller via persisted call flow", [
                `${label(caller)} -[calls]-> ${label(seedUnit)}`
              ]);
          }
        }
      } else if (queryIntent === "callees") {
        for (const rel of out.filter((rel) => rel.kind === "calls"))
          follow(
            seed,
            rel,
            rel.targetId,
            seedScore + 4,
            "callee via repository call relationship",
            []
          );
      } else if (queryIntent === "dependencies") {
        for (const rel of out.filter((rel) =>
          ["imports", "depends-on", "configured-by", "maps-to"].includes(rel.kind)
        ))
          follow(seed, rel, rel.targetId, seedScore + 3, `dependency via ${rel.kind}`, []);
      } else if (queryIntent === "dependents") {
        for (const rel of inc.filter((rel) =>
          ["imports", "depends-on", "configured-by", "maps-to"].includes(rel.kind)
        ))
          follow(seed, rel, rel.sourceId, seedScore + 3, `dependent via ${rel.kind}`, []);
      } else if (queryIntent === "tests") {
        for (const rel of inc.filter((rel) => rel.kind === "tests" || rel.kind === "covers"))
          follow(seed, rel, rel.sourceId, seedScore + 5, `test evidence via ${rel.kind}`, []);
        if (seedUnit.kind === "test")
          for (const rel of out.filter((rel) => rel.kind === "tests" || rel.kind === "covers"))
            follow(seed, rel, rel.targetId, seedScore + 3, `tested target via ${rel.kind}`, []);
      } else if (queryIntent === "impact") {
        traverseImpact(seed, seedScore, 3, byId, incoming, outgoing, follow);
      } else if (queryIntent === "flow") {
        for (const rel of [...out, ...inc].filter(
          (rel) =>
            rel.kind === "flows-to" ||
            rel.kind === "calls" ||
            rel.kind === "reads" ||
            rel.kind === "writes"
        )) {
          const next = rel.sourceId === seed ? rel.targetId : rel.sourceId;
          follow(seed, rel, next, seedScore + 2.5, `flow evidence via ${rel.kind}`, []);
        }
      } else if (queryIntent === "data") {
        for (const rel of [...out, ...inc].filter((rel) =>
          ["reads", "writes", "maps-to", "flows-to", "depends-on"].includes(rel.kind)
        )) {
          const next = rel.sourceId === seed ? rel.targetId : rel.sourceId;
          follow(seed, rel, next, seedScore + 3, `data evidence via ${rel.kind}`, []);
        }
      } else if (queryIntent === "generic" || queryIntent === "definition") {
        for (const rel of [...out, ...inc]
          .filter((rel) =>
            [
              "defines",
              "contains",
              "imports",
              "depends-on",
              "calls",
              "tests",
              "covers",
              "exposes",
              "configured-by",
              "flows-to",
              "may-impact",
              "maps-to"
            ].includes(rel.kind)
          )
          .slice(0, 40)) {
          const next = rel.sourceId === seed ? rel.targetId : rel.sourceId;
          follow(seed, rel, next, seedScore + 1.2, `related via ${rel.kind}`, []);
        }
      }
    }
  }

  // Intent-specific global evidence should be discoverable even when the user asks a broad question.
  for (const category of intents.filter(
    (value): value is "security" | "performance" => value === "security" || value === "performance"
  )) {
    for (const unit of activeUnits.filter(
      (unit) =>
        unit.kind === "risk-area" &&
        String(unit.properties.category ?? "").toLowerCase() === category
    )) {
      add(unit.id, 8, `${category} risk-area evidence`);
      for (const rel of outgoing.get(unit.id) ?? [])
        if (rel.kind === "may-impact")
          follow(unit.id, rel, rel.targetId, 7, `${category} impact evidence`, []);
    }
  }
  if (intents.includes("api"))
    for (const unit of activeUnits.filter((unit) => unit.kind === "api"))
      if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2)
        add(unit.id, 6, "API contract evidence");
  if (intents.includes("configuration"))
    for (const unit of activeUnits.filter((unit) => unit.kind === "configuration"))
      if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2)
        add(unit.id, 6, "configuration evidence");
  if (intents.includes("documentation"))
    for (const unit of activeUnits.filter((unit) => unit.kind === "documentation"))
      if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2)
        add(unit.id, 6, "documentation evidence");
  if (intents.includes("data"))
    for (const unit of activeUnits.filter((unit) =>
      ["database", "table", "orm-entity", "query", "data-entity"].includes(unit.kind)
    ))
      if (unitScore(unit, normalized, terms, "data") > 0 || terms.length <= 2)
        add(unit.id, 6, "data model evidence");

  // Broad discovery questions should return the repository's actual system concepts, not
  // incidental symbol/path text that happens to contain a matching word.
  const broadTechnology = intents.includes("technology") && /\b(?:architecture|services?|components?|entry points?|modules?)\b/i.test(normalized);
  if (broadTechnology)
    for (const unit of activeUnits.filter((item) => [
      "repository", "workspace", "module", "package", "service", "api", "route", "component",
      "architecture-boundary", "configuration", "contract", "event", "build-system", "package-manager"
    ].includes(item.kind)))
      add(unit.id, 60 - systemConceptPriority(unit.kind), "system architecture evidence");
  const broadData = intents.includes("data") && /\b(?:data stores?|persistence|database|schema|tables?)\b/i.test(normalized);
  if (broadData)
    for (const unit of activeUnits.filter((item) => ["database", "table", "orm-entity", "entity", "repository", "migration", "data-entity"].includes(item.kind)))
      add(unit.id, 60 - dataConceptPriority(unit.kind), "data and persistence evidence");

  const ranked = [...candidates.entries()]
    .map(([id, value]) => ({ unit: byId.get(id)!, ...value }))
    .filter((item) => resultAllowedAny(intents, item.unit))
    .filter((item) => !shouldSuppressSeed(intents, seeds, item.unit.id, item.reasons))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.unit.confidence.score - a.unit.confidence.score ||
        a.unit.canonicalKey.localeCompare(b.unit.canonicalKey)
    )
    .slice(0, Math.max(1, Math.min(limit, 100)));

  const items = ranked.map((item) =>
    toItem(item.unit, item.score, [...item.reasons], item.path, evidenceById)
  );
  const confidence = items.length
    ? Math.min(
        1,
        items.slice(0, 5).reduce((sum, item) => sum + item.confidence, 0) /
          Math.min(items.length, 5)
      )
    : 0;
  const relationshipKinds = [...new Set(traversals.map((item) => item.relationship))].sort();
  const maxDepth = intents.includes("impact") ? 3 : intents.includes("flow") ? 2 : 1;
  const strategy = `Match repository names and paths, follow the relevant ${intents.join(" + ")} relationship traversal${intents.length > 1 ? "s" : ""}, then rank evidence by match strength and confidence.`;
  return {
    query,
    intent,
    answer: summarizeIntents(intents, items),
    confidence,
    items,
    traversedRelationships: traversed,
    warnings: items.length
      ? []
      : [
          "No repository item matched the question. Try a symbol, file, API route, service, test, or configuration name."
        ],
    plan: {
      terms,
      seedIds: seeds,
      seedLabels: seeds.map((id) => label(byId.get(id))),
      relationshipKinds,
      maxDepth,
      strategy
    },
    traversals
  };
}

function traverseImpact(
  seed: string,
  base: number,
  maxDepth: number,
  byId: Map<string, KeystoneKnowledgeUnit>,
  incoming: Map<string, KeystoneKnowledgeRelationship[]>,
  outgoing: Map<string, KeystoneKnowledgeRelationship[]>,
  follow: (
    from: string,
    rel: KeystoneKnowledgeRelationship,
    next: string,
    score: number,
    reason: string,
    pathPrefix: string[]
  ) => void
): void {
  const queue: Array<{ id: string; depth: number; path: string[] }> = [
    { id: seed, depth: 0, path: [] }
  ];
  const seen = new Set<string>([seed]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const inbound = (incoming.get(current.id) ?? []).filter((rel) =>
      ["imports", "depends-on", "calls", "tests", "covers", "may-impact", "maps-to"].includes(
        rel.kind
      )
    );
    for (const rel of inbound) {
      const next = rel.sourceId;
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      const score = base + Math.max(0.5, 4 - current.depth);
      follow(current.id, rel, next, score, `reverse impact via ${rel.kind}`, current.path);
      queue.push({
        id: next,
        depth: current.depth + 1,
        path: [
          ...current.path,
          `${label(byId.get(next))} -> ${label(byId.get(current.id))} (${rel.kind})`
        ]
      });
    }
    // A changed file also impacts symbols/flows it defines, which then fan out to callers.
    for (const rel of (outgoing.get(current.id) ?? []).filter(
      (rel) => rel.kind === "defines" || rel.kind === "exposes"
    )) {
      const next = rel.targetId;
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      follow(current.id, rel, next, base + 2, `defined surface via ${rel.kind}`, current.path);
      queue.push({
        id: next,
        depth: current.depth + 1,
        path: [
          ...current.path,
          `${label(byId.get(current.id))} -> ${label(byId.get(next))} (${rel.kind})`
        ]
      });
    }
  }
}

function classifyAll(query: string): OkfQueryIntent[] {
  const q = query.toLowerCase();
  const intents: OkfQueryIntent[] = [];
  const add = (value: OkfQueryIntent) => {
    if (!intents.includes(value)) intents.push(value);
  };
  if (/\b(who|what|which)\s+calls?\b|\bcallers?\b|\bcalled by\b/.test(q)) add("callers");
  if (/\b(what|which)\s+(does|do)\b.*\bcall\b|\bcallees?\b|\bcalls from\b/.test(q)) add("callees");
  if (/\btests?\b|\bcoverage\b|\bcovered by\b/.test(q)) add("tests");
  if (/\bimpact|impacted|affected|break|change.*affect|dependents?\b/.test(q)) add("impact");
  if (/\bdependencies|depends on|imports?\b/.test(q)) add("dependencies");
  if (/\bused by|referenced by|dependent on|depend on this\b/.test(q)) add("dependents");
  if (/\bapi|endpoint|route\b/.test(q)) add("api");
  if (/\bflow|data flow|call flow|path through\b/.test(q)) add("flow");
  if (/\bsecurity|secret|auth|authorization|vulnerab|injection|xss\b/.test(q)) add("security");
  if (/\bperformance|slow|latency|hot path|n\+1|blocking|benchmark\b/.test(q)) add("performance");
  if (/\b(?:database|table|schema|orm|query|sql|persistence|data model)\b/.test(q)) add("data");
  if (/\bconfig|configuration|setting|environment\b/.test(q)) add("configuration");
  if (/\bdoc|documentation|readme|design\b/.test(q)) add("documentation");
  if (/\b(?:language|framework|orm|database|messaging|contract|project|module|architecture|services?|components?|entry points?|package ecosystem|support level)\b/.test(q)) add("technology");
  if (!intents.length && /\bwhere|defined|definition|implemented|implements?\b/.test(q))
    add("definition");
  if (!intents.length) add("generic");
  return intents;
}

function resultAllowedAny(
  intents: readonly OkfQueryIntent[],
  unit: KeystoneKnowledgeUnit
): boolean {
  return intents.some((intent) => resultAllowed(intent, unit));
}
function resultAllowed(intent: OkfQueryIntent, unit: KeystoneKnowledgeUnit): boolean {
  if (intent === "tests")
    return (
      unit.kind === "test" || (unit.kind === "file" && isTestPath(unitPath(unit) ?? unit.name))
    );
  if (intent === "callers" || intent === "callees")
    return ["symbol", "service", "api", "file", "test"].includes(unit.kind);
  if (intent === "api")
    return (
      unit.kind === "api" ||
      unit.kind === "route" ||
      unit.kind === "controller" ||
      unit.kind === "handler" ||
      unit.kind === "service" ||
      (unit.kind === "file" && !isTestPath(unitPath(unit) ?? unit.name))
    );
  if (intent === "flow")
    return ["call-flow", "data-flow", "symbol", "api", "service", "file", "test"].includes(
      unit.kind
    );
  if (intent === "data")
    return ["database", "table", "orm-entity", "entity", "repository", "migration", "query", "data-entity", "file", "service"].includes(
      unit.kind
    );
  if (intent === "security" || intent === "performance")
    return (
      unit.kind === "risk-area" ||
      FILE_LIKE.has(unit.kind) ||
      unit.kind === "symbol" ||
      unit.kind === "service" ||
      unit.kind === "api"
    );
  if (intent === "configuration")
    return (
      unit.kind === "configuration" ||
      unit.kind === "feature-flag" ||
      unit.kind === "ci-cd" ||
      unit.kind === "infrastructure" ||
      unit.kind === "build-system" ||
      unit.kind === "package-manager" ||
      unit.kind === "file" ||
      unit.kind === "symbol" ||
      unit.kind === "service"
    );
  if (intent === "documentation")
    return (
      unit.kind === "documentation" ||
      unit.kind === "file" ||
      unit.kind === "module" ||
      unit.kind === "service"
    );
  if (intent === "technology")
    return [
      "module",
      "package",
      "package-manager",
      "build-system",
      "architecture-boundary",
      "database",
      "contract",
      "repository",
      "file",
      "service",
      "api",
      "route",
      "component",
      "configuration",
      "contract",
      "event"
    ].includes(unit.kind);
  return true;
}
function shouldSuppressSeed(
  intents: readonly OkfQueryIntent[],
  seeds: readonly string[],
  id: string,
  reasons: ReadonlySet<string>
): boolean {
  const actionOnly = intents.every((intent) =>
    ["callers", "callees", "tests", "dependencies", "dependents"].includes(intent)
  );
  return (
    actionOnly && seeds.includes(id) && reasons.size === 1 && reasons.has("direct repository match")
  );
}
function isTestPath(value: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(value);
}

function unitScore(
  unit: KeystoneKnowledgeUnit,
  query: string,
  terms: readonly string[],
  intent: OkfQueryIntent
): number {
  const path = unitPath(unit) ?? "";
  const hay =
    `${unit.kind} ${unit.name} ${unit.description ?? ""} ${unit.canonicalKey} ${path} ${JSON.stringify(unit.properties)}`.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  if (hay.includes(q)) score += 8;
  if (
    unit.name.toLowerCase() === q ||
    unit.canonicalKey.toLowerCase() === q ||
    path.toLowerCase() === q
  )
    score += 12;
  for (const term of terms) {
    if (unit.name.toLowerCase().includes(term)) score += 3;
    if (path.toLowerCase().includes(term)) score += 2.5;
    if (unit.canonicalKey.toLowerCase().includes(term)) score += 2;
    if (hay.includes(term)) score += 0.6;
  }
  if (intent === "api" && unit.kind === "api") score += 2;
  if (intent === "tests" && unit.kind === "test") score += 2;
  if (intent === "definition" && ["symbol", "file", "service", "api"].includes(unit.kind))
    score += 1.5;
  if (intent === "security" && unit.kind === "risk-area" && unit.properties.category === "security")
    score += 4;
  if (
    intent === "performance" &&
    unit.kind === "risk-area" &&
    unit.properties.category === "performance"
  )
    score += 4;
  if (intent === "technology" && ["module", "architecture-boundary", "package"].includes(unit.kind))
    score += 3;
  if (
    intent === "data" &&
    ["database", "table", "orm-entity", "entity", "repository", "migration", "query", "data-entity"].includes(unit.kind)
  )
    score += 4;
  return score;
}

function tokenize(value: string): string[] {
  const raw = value.toLowerCase().match(/[a-z0-9_./:-]+/g) ?? [];
  return [...new Set(raw.flatMap((term) => term.endsWith("s") && term.length > 3 ? [term, term.slice(0, -1)] : [term]))].filter(
    (term) => term.length > 1 && !STOP.has(term)
  );
}
function systemConceptPriority(kind: string): number {
  const order = ["repository", "workspace", "module", "architecture-boundary", "service", "api", "route", "component", "event", "contract", "package", "configuration", "build-system", "package-manager"];
  const index = order.indexOf(kind);
  return index < 0 ? 20 : index;
}
function dataConceptPriority(kind: string): number {
  const order = ["database", "table", "orm-entity", "entity", "repository", "migration", "data-entity"];
  const index = order.indexOf(kind);
  return index < 0 ? 20 : index;
}
function unitPath(unit: KeystoneKnowledgeUnit): string | undefined {
  const value = unit.properties.path ?? unit.properties.filePath;
  return typeof value === "string" ? value : undefined;
}
function label(unit: KeystoneKnowledgeUnit | undefined): string {
  return unit ? `${unit.kind}:${unit.name}` : "unknown";
}
function toItem(
  unit: KeystoneKnowledgeUnit,
  score: number,
  reasons: string[],
  relationshipPath: string[],
  evidenceById: Map<string, OkfEvidence>
): OkfQueryItem {
  const path = unitPath(unit);
  const evidenceIds = unit.provenance.evidenceIds.filter((id) => evidenceById.has(id));
  const evidence = evidenceIds.map((id) => evidenceById.get(id)!).filter(Boolean);
  const freshness = evidence.length
    ? evidence.filter((item) => item.freshness === "current").length / evidence.length
    : 0.7;
  const confidence = Math.max(0, Math.min(1, unit.confidence.score * 0.8 + freshness * 0.2));
  const details = [
    unit.description,
    typeof unit.properties.summary === "string" ? unit.properties.summary : undefined,
    path ? `path=${path}` : undefined,
    relationshipPath.at(-1)
  ]
    .filter(Boolean)
    .join(" · ");
  const line = evidence.find((item) => item.source.startLine !== undefined)?.source.startLine;
  return {
    id: unit.id,
    label: unit.name,
    kind: unit.kind,
    path,
    line,
    summary: details.slice(0, 500),
    reason: reasons.join("; "),
    score,
    confidence,
    evidenceIds,
    relationshipPath
  };
}
function summarizeIntents(
  intents: readonly OkfQueryIntent[],
  items: readonly OkfQueryItem[]
): string {
  if (!items.length) return "No matching repository evidence was found for this question.";
  const lead = items
    .slice(0, 5)
    .map((item) => item.path ?? `${item.kind}:${item.label}`)
    .join(", ");
  const names = intents.map((intent) =>
    intent === "tests"
      ? "test"
      : intent === "callers"
        ? "caller"
        : intent === "callees"
          ? "callee"
          : intent === "impact"
            ? "impact"
            : intent === "dependencies"
              ? "dependency"
              : intent === "dependents"
                ? "dependent"
                : intent === "api"
                  ? "API"
                  : intent === "flow"
                    ? "flow"
                    : intent === "security"
                      ? "security"
                      : intent === "performance"
                        ? "performance"
                        : intent === "data"
                          ? "data"
                          : intent === "configuration"
                            ? "configuration"
                            : intent === "documentation"
                              ? "documentation"
                              : "repository"
  );
  const prefix = names.length > 1 ? `${names.join(" + ")} evidence` : `${names[0]} evidence`;
  return `${prefix}: ${lead}${items.length > 5 ? ` and ${items.length - 5} more` : ""}.`;
}

/** Dispatches all higher-level operations through the same OKF snapshot and evidence ledger. */
export function executeOkfOperation(
  snapshot: KeystoneOkfSnapshot,
  request: OkfOperationRequest & { readonly operation: "reuse" }
): OkfReuseResult;
export function executeOkfOperation(
  snapshot: KeystoneOkfSnapshot,
  request: OkfOperationRequest
): OkfOperationResult;
export function executeOkfOperation(
  snapshot: KeystoneOkfSnapshot,
  request: OkfOperationRequest
): OkfOperationResult {
  switch (request.operation) {
    case "query":
      return queryOkfSnapshot(snapshot, request.query, request.limit ?? 50);
    case "path":
      return pathOkfSnapshot(snapshot, request.from ?? request.query, request.to ?? "", request.limit);
    case "explain":
      return explainOkfSnapshot(snapshot, request.query, request.limit);
    case "flow":
      return flowOkfSnapshot(snapshot, request.query, request.limit);
    case "impact":
      return impactOkfSnapshot(snapshot, request.query, request.changedPaths, request.limit);
    case "reuse":
      return reuseOkfSnapshot(snapshot, request.query, request.limit);
  }
}

function activeGraph(snapshot: KeystoneOkfSnapshot) {
  const units = snapshot.units.filter((unit) => unit.lifecycle === "active");
  const unitIds = new Set(units.map((unit) => unit.id));
  const relationships = snapshot.relationships.filter(
    (relationship) =>
      relationship.lifecycle === "active" &&
      unitIds.has(relationship.sourceId) &&
      unitIds.has(relationship.targetId)
  );
  return {
    units,
    relationships,
    byId: new Map(units.map((unit) => [unit.id, unit])),
    evidence: new Map(snapshot.evidence.map((item) => [item.id, item]))
  };
}

function resolveOperationUnits(
  units: readonly KeystoneKnowledgeUnit[],
  text: string,
  limit = 8
): KeystoneKnowledgeUnit[] {
  const terms = tokenize(text);
  return units
    .map((unit) => ({ unit, score: unitScore(unit, text.toLowerCase(), terms, "generic") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.canonicalKey.localeCompare(b.unit.canonicalKey))
    .slice(0, limit)
    .map((item) => item.unit);
}

function evidenceFor(
  ids: readonly string[],
  evidenceById: Map<string, OkfEvidence>
): OkfOperationEvidence {
  const evidence = [...new Set(ids)].map((id) => evidenceById.get(id)).filter(Boolean) as OkfEvidence[];
  return {
    evidenceIds: evidence.map((item) => item.id),
    paths: [...new Set(evidence.map((item) => item.source.workspaceRelativePath))],
    lines: [...new Set(evidence.map((item) => item.source.startLine).filter((line): line is number => line !== undefined))]
  };
}

function unitEvidence(unit: KeystoneKnowledgeUnit, evidenceById: Map<string, OkfEvidence>) {
  return evidenceFor(unit.provenance.evidenceIds, evidenceById);
}

function operationItem(
  unit: KeystoneKnowledgeUnit,
  reason: string,
  snapshot: KeystoneOkfSnapshot,
  score = 1,
  path: string[] = []
): OkfQueryItem {
  const byEvidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  return toItem(unit, score, [reason], path, byEvidence);
}

function pathOkfSnapshot(
  snapshot: KeystoneOkfSnapshot,
  fromQuery: string,
  toQuery: string,
  limit = 8
): OkfPathResult {
  const graph = activeGraph(snapshot);
  const from = resolveOperationUnits(graph.units, fromQuery, 1)[0];
  const to = resolveOperationUnits(graph.units, toQuery, 1)[0];
  if (!from || !to)
    return {
      operation: "path", from: fromQuery, to: toQuery, found: false, nodes: [], alternativePath: false,
      confidence: 0, evidence: evidenceFor([], graph.evidence), warnings: ["Both path endpoints must match active repository concepts."]
    };
  const meaningful = new Set([
    "calls", "imports", "depends-on", "reads", "writes", "flows-to", "implements", "extends", "exposes", "maps-to", "publishes", "subscribes", "handles", "uses", "provides", "persists"
  ]);
  const adjacency = new Map<string, Array<{ rel: KeystoneKnowledgeRelationship; next: string }>>();
  for (const rel of graph.relationships) {
    if (!meaningful.has(rel.kind)) continue;
    for (const [next, reverse] of [[rel.targetId, false], [rel.sourceId, true]] as const) {
      const list = adjacency.get(reverse ? rel.targetId : rel.sourceId) ?? [];
      list.push({ rel, next });
      adjacency.set(reverse ? rel.targetId : rel.sourceId, list);
    }
  }
  const distance = new Map<string, number>([[from.id, 0]]);
  const previous = new Map<string, { id: string; rel: KeystoneKnowledgeRelationship }>();
  const open = [from.id];
  while (open.length) {
    open.sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity));
    const current = open.shift()!;
    if (current === to.id) break;
    for (const { rel, next } of adjacency.get(current) ?? []) {
      const cost = 1.1 - Math.min(0.45, rel.confidence.score * 0.45) + (rel.kind === "maps-to" ? 0.25 : 0);
      const candidate = (distance.get(current) ?? Infinity) + cost;
      if (candidate < (distance.get(next) ?? Infinity)) {
        distance.set(next, candidate);
        previous.set(next, { id: current, rel });
        open.push(next);
      }
    }
  }
  const ids: string[] = [];
  const rels: KeystoneKnowledgeRelationship[] = [];
  for (let id = to.id; id; ) {
    ids.unshift(id);
    const prior = previous.get(id);
    if (!prior) break;
    rels.unshift(prior.rel);
    id = prior.id;
  }
  const found = ids[0] === from.id && ids.at(-1) === to.id;
  const evidenceIds = [...ids.flatMap((id) => graph.byId.get(id)?.provenance.evidenceIds ?? []), ...rels.flatMap((rel) => rel.provenance.evidenceIds)];
  const nodes = found ? ids.slice(0, Math.max(2, limit)).map((id, index) => {
    const unit = graph.byId.get(id)!;
    const rel = rels[index - 1];
    return {
      nodeId: id, label: label(unit), kind: unit.kind,
      ...(rel ? { relationshipFromPrevious: rel.kind } : {}),
      confidence: Math.min(unit.confidence.score, rel?.confidence.score ?? unit.confidence.score),
      provenance: rel ? `${rel.origin}:${rel.resolutionExplanation ?? "relationship assertion"}` : `${unit.provenance.extractor}:${unit.provenance.extractionRunId}`,
      evidence: evidenceFor([...unit.provenance.evidenceIds, ...(rel?.provenance.evidenceIds ?? [])], graph.evidence)
    };
  }) : [];
  const alternativePath = found && rels.length > 1 && graph.relationships.filter((rel) => rel.kind === rels[0].kind && rel.sourceId === from.id).length > 1;
  return {
    operation: "path", from: fromQuery, to: toQuery, found, nodes, alternativePath,
    confidence: found ? nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length : 0,
    evidence: evidenceFor(evidenceIds, graph.evidence), warnings: found ? [] : ["No meaningful engineering path was found between the matched endpoints."]
  };
}

function explainOkfSnapshot(snapshot: KeystoneOkfSnapshot, query: string, limit = 8): OkfExplainResult {
  const graph = activeGraph(snapshot);
  const subject = resolveOperationUnits(graph.units, query, 1)[0];
  if (!subject)
    return { operation: "explain", callers: [], callees: [], dependencies: [], contracts: [], flows: [], evidence: evidenceFor([], graph.evidence), warnings: ["No active symbol, component, or concept matched the explanation target."] };
  const outgoing = graph.relationships.filter((rel) => rel.sourceId === subject.id);
  const incoming = graph.relationships.filter((rel) => rel.targetId === subject.id);
  const related = (rels: readonly KeystoneKnowledgeRelationship[], kinds: readonly string[], direction: "source" | "target") => rels.filter((rel) => kinds.includes(rel.kind)).slice(0, limit).map((rel) => operationItem(graph.byId.get(direction === "source" ? rel.targetId : rel.sourceId)!, `relationship: ${rel.kind}`, snapshot, rel.confidence.score));
  const structural = analyzeOkfStructure(snapshot);
  const communityId = structural.assignments[subject.id];
  const community = structural.communities.find((item) => item.id === communityId);
  const anchor = structural.anchors.find((item) => item.unitId === subject.id);
  const evidenceIds = [...subject.provenance.evidenceIds, ...outgoing.flatMap((rel) => rel.provenance.evidenceIds), ...incoming.flatMap((rel) => rel.provenance.evidenceIds)];
  return {
    operation: "explain", subject: operationItem(subject, "explanation target", snapshot, subject.confidence.score),
    role: typeof subject.properties.role === "string" ? subject.properties.role : subject.description,
    community: community ? { id: community.id, label: community.label } : undefined,
    architectureAnchor: anchor ? { weightedDegree: anchor.weightedDegree, reason: anchor.reason } : undefined,
    callers: related(incoming, ["calls"], "source"), callees: related(outgoing, ["calls"], "target"),
    dependencies: related(outgoing, ["imports", "depends-on", "configured-by", "maps-to"], "target"),
    contracts: related([...outgoing, ...incoming], ["implements", "extends", "exposes", "provides", "handles"], "target"),
    flows: related([...outgoing, ...incoming], ["flows-to", "reads", "writes", "publishes", "subscribes"], "target"),
    evidence: evidenceFor(evidenceIds, graph.evidence), warnings: []
  };
}

function flowOkfSnapshot(snapshot: KeystoneOkfSnapshot, query: string, limit = 24): OkfFlowResult {
  const graph = activeGraph(snapshot);
  const seeds = resolveOperationUnits(graph.units, query, 3);
  const allowed = new Set(["flows-to", "calls", "reads", "writes", "publishes", "subscribes", "returns", "uses", "persists"]);
  const selected = new Set(seeds.map((unit) => unit.id));
  const relationships = graph.relationships.filter((rel) => allowed.has(rel.kind) && (selected.has(rel.sourceId) || selected.has(rel.targetId))).slice(0, limit * 2);
  for (const rel of relationships) { selected.add(rel.sourceId); selected.add(rel.targetId); }
  const nodes = [...selected].slice(0, limit).map((id) => { const unit = graph.byId.get(id)!; return { nodeId: id, label: label(unit), kind: unit.kind, confidence: unit.confidence.score, provenance: `${unit.provenance.extractor}:${unit.provenance.extractionRunId}`, evidence: unitEvidence(unit, graph.evidence) }; });
  const traversals = relationships.map((rel) => ({ sourceId: rel.sourceId, targetId: rel.targetId, relationship: rel.kind, sourceLabel: label(graph.byId.get(rel.sourceId)), targetLabel: label(graph.byId.get(rel.targetId)) }));
  return { operation: "flow", query, nodes, relationships: traversals, evidence: evidenceFor([...nodes.flatMap((node) => node.evidence.evidenceIds), ...relationships.flatMap((rel) => rel.provenance.evidenceIds)], graph.evidence), warnings: nodes.length ? [] : ["No persisted call/data/service flow matched the query."] };
}

function impactOkfSnapshot(snapshot: KeystoneOkfSnapshot, query: string, changedPaths: readonly string[] = [], limit = 24): OkfImpactResult {
  const graph = activeGraph(snapshot);
  const targets = resolveOperationUnits(graph.units, query, 6).filter((unit) => !query || changedPaths.length === 0 || changedPaths.some((path) => unitPath(unit)?.includes(path)));
  const seeds = targets.length ? targets : graph.units.filter((unit) => changedPaths.some((path) => unitPath(unit)?.includes(path)));
  const direct: OkfImpactItem[] = [], probable: OkfImpactItem[] = [], possible: OkfImpactItem[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const rel of graph.relationships.filter((item) => item.targetId === seed.id && ["calls", "imports", "depends-on", "tests", "covers", "may-impact", "exposes", "implements"].includes(item.kind))) {
      if (seen.has(rel.sourceId)) continue; seen.add(rel.sourceId);
      const unit = graph.byId.get(rel.sourceId)!; const item = { ...operationItem(unit, `impact via ${rel.kind}`, snapshot, rel.confidence.score), impact: rel.kind === "calls" || rel.kind === "imports" ? "direct" : rel.kind === "tests" || rel.kind === "covers" ? "probable" : "possible" } as OkfImpactItem;
      (item.impact === "direct" ? direct : item.impact === "probable" ? probable : possible).push(item);
    }
  }
  const all = [...direct, ...probable, ...possible].slice(0, limit);
  return { operation: "impact", target: query, direct: direct.slice(0, limit), probable: probable.slice(0, limit), possible: possible.slice(0, limit), evidence: evidenceFor(all.flatMap((item) => item.evidenceIds), graph.evidence), warnings: seeds.length ? [] : ["No change target or current-workspace path matched active intelligence."] };
}

function reuseOkfSnapshot(snapshot: KeystoneOkfSnapshot, intent: string, limit = 8): OkfReuseResult {
  const graph = activeGraph(snapshot); const terms = tokenize(intent);
  const outgoingByUnit = new Map<string, KeystoneKnowledgeRelationship[]>();
  const incomingByUnit = new Map<string, KeystoneKnowledgeRelationship[]>();
  for (const relationship of graph.relationships) {
    const outgoing = outgoingByUnit.get(relationship.sourceId) ?? [];
    outgoing.push(relationship);
    outgoingByUnit.set(relationship.sourceId, outgoing);
    const incoming = incomingByUnit.get(relationship.targetId) ?? [];
    incoming.push(relationship);
    incomingByUnit.set(relationship.targetId, incoming);
  }
  const candidates = graph.units.filter((unit) => ["symbol", "service", "component", "repository", "module", "handler", "middleware", "api"].includes(unit.kind)).map((unit) => {
    const outgoing = outgoingByUnit.get(unit.id) ?? []; const incoming = incomingByUnit.get(unit.id) ?? [];
    const neighborIds = [...outgoing, ...incoming].map((rel) => rel.sourceId === unit.id ? rel.targetId : rel.sourceId);
    const neighborText = neighborIds.map((id) => {
      const neighbor = graph.byId.get(id); return neighbor ? `${neighbor.name} ${neighbor.kind} ${JSON.stringify(neighbor.properties)}` : "";
    }).join(" ");
    const reasons: string[] = []; const hay = `${unit.name} ${unit.description ?? ""} ${unit.canonicalKey} ${JSON.stringify(unit.properties)} ${neighborText}`.toLowerCase();
    if (/^(?:docs?|documentation|scripts?|fixtures?)\//i.test(unitPath(unit) ?? "")) return undefined;
    const implementationName = /request|fetch|client|transport|http/i.test(unit.name) && !/interface|type/i.test(String(unit.properties.symbolKind ?? ""));
    const integrationPath = /(?:integration|client|http|transport|network)/i.test(unitPath(unit) ?? "");
    const capabilitySignal = terms.some((term) => ["http", "outbound", "request", "fetch"].includes(term)) && implementationName && integrationPath;
    if (capabilitySignal) reasons.push("matches an outbound integration/request implementation shape");
    const score = terms.reduce((sum, term) => { if (hay.includes(term)) { reasons.push(neighborText.toLowerCase().includes(term) && !`${unit.name} ${unit.description ?? ""}`.toLowerCase().includes(term) ? `matches related capability '${term}'` : `matches concept term '${term}'`); return sum + (neighborText.toLowerCase().includes(term) ? 2.5 : 3); } return sum; }, 0) + (capabilitySignal ? 5 : 0) + (unit.confidence.score * 0.5);
    const usedBy = incoming.filter((rel) => ["calls", "imports", "depends-on", "uses", "implements"].includes(rel.kind)).slice(0, 5).map((rel) => operationItem(graph.byId.get(rel.sourceId)!, `uses candidate via ${rel.kind}`, snapshot, rel.confidence.score));
    if (usedBy.length) reasons.push(`already used by ${usedBy.length} repository component(s)`);
    if (!reasons.length) return undefined;
    const relationships = [...outgoing, ...incoming].slice(0, 8).map((rel) => ({ sourceId: rel.sourceId, targetId: rel.targetId, relationship: rel.kind, sourceLabel: label(graph.byId.get(rel.sourceId)), targetLabel: label(graph.byId.get(rel.targetId)) }));
    return { score, candidate: operationItem(unit, "existing implementation candidate", snapshot, score), whyItMatches: [...new Set(reasons)], whereUsed: usedBy, relationships, evidence: evidenceFor([...unit.provenance.evidenceIds, ...outgoing.flatMap((rel) => rel.provenance.evidenceIds), ...incoming.flatMap((rel) => rel.provenance.evidenceIds)], graph.evidence) };
  }).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label)).slice(0, limit).map(({ score: _score, ...candidate }) => candidate);
  return { operation: "reuse", intent, candidates, warnings: candidates.length ? ["Candidates are evidence-backed suggestions; reuse still requires engineering judgment."] : ["No existing implementation pattern matched the requested concept."] };
}
