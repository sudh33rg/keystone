/**
 * Shared mapping helpers for Phase 4 visualization.
 *
 * Converts the existing Intelligence snapshot's entity/relationship vocabularies
 * (keystone.core.* symbol types, relationship.type strings, file categories)
 * into the canonical visualization vocabulary (IntelligenceNodeKind /
 * IntelligenceRelationship). Deterministic, no LLM.
 */
import type {
  IntelligenceNodeKind,
  IntelligenceRelationship,
  IntelligenceConfidenceCategory,
  IntelligenceGroupingBasis,
} from "../../../shared/contracts/visualization";
import type {
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
} from "../../../shared/contracts/intelligence";

export type ResolutionType = NonNullable<IntelligenceRelationshipRecord["resolution"]>;

// ---------------------------------------------------------------------------
// Symbol type -> canonical node kind
// ---------------------------------------------------------------------------

const SYMBOL_TYPE_TO_KIND: Record<string, IntelligenceNodeKind> = {
  "keystone.core.Repository": "repository",
  "keystone.core.Package": "package",
  "keystone.core.Module": "module",
  "keystone.core.Directory": "directory",
  "keystone.core.File": "file",
  "keystone.core.Class": "class",
  "keystone.core.Interface": "interface",
  "keystone.core.Function": "function",
  "keystone.core.Method": "method",
  "keystone.core.Constructor": "method",
  "keystone.core.Route": "route",
  "keystone.core.Event": "event",
  "keystone.core.BackgroundJob": "job",
  "keystone.core.Database": "database",
  "keystone.core.Table": "table",
  "keystone.core.Entity": "entity",
  "keystone.core.ExternalService": "external-service",
  "keystone.core.TestSuite": "test-file",
  "keystone.core.TestCase": "test-case",
  "keystone.core.Fixture": "fixture",
  "keystone.core.ConfigurationKey": "configuration",
};

export function symbolKind(type: string): IntelligenceNodeKind {
  return SYMBOL_TYPE_TO_KIND[type] ?? "unknown";
}

// ---------------------------------------------------------------------------
// File category -> canonical node kind
// ---------------------------------------------------------------------------

export function fileKind(file: IntelligenceFileRecord): IntelligenceNodeKind {
  if (file.isTest) return "test-file";
  switch (file.category) {
    case "configuration":
    case "manifest":
      return "configuration";
    case "schema":
    case "migration":
      return "table";
    case "test":
      return "test-file";
    case "documentation":
    case "infrastructure":
    case "ci":
    case "asset":
    case "other":
      return "file";
    default:
      return "file";
  }
}

export function nodeKindForEntity(
  symbol?: IntelligenceSymbolRecord,
  file?: IntelligenceFileRecord,
): IntelligenceNodeKind {
  if (symbol) return symbolKind(symbol.type);
  if (file) return fileKind(file);
  return "unknown";
}

// ---------------------------------------------------------------------------
// Relationship type -> canonical relationship
// ---------------------------------------------------------------------------

const RELATIONSHIP_TYPE_TO_KIND: Record<string, IntelligenceRelationship> = {
  "keystone.core.CONTAINS": "contains",
  "keystone.core.IMPORTS": "imports",
  "keystone.core.DEPENDS_ON": "depends-on",
  "keystone.core.CALLS": "calls",
  "keystone.core.RETURNS_TO": "returns-to",
  "keystone.core.READS_FROM": "reads",
  "keystone.core.WRITES_TO": "writes",
  "keystone.core.PUBLISHES": "publishes",
  "keystone.core.SUBSCRIBES_TO": "subscribes",
  "keystone.core.ROUTES_TO": "routes-to",
  "keystone.core.MAPS_TO": "maps-to",
  "keystone.core.TESTS": "tests",
  "keystone.core.COVER": "covers",
  "keystone.core.COVERED_BY": "covers",
  "keystone.core.INHERITS": "inherits",
  "keystone.core.IMPLEMENTS": "implements",
  "keystone.core.USES": "uses",
  "keystone.core.REFERENCES": "uses",
  "keystone.core.USES_CONFIGURATION": "configures",
  "keystone.core.CONFIGURES": "configures",
  "keystone.core.IMPACTS": "impacts",
};

/** Normalize a relationship.type string (case-insensitive, namespace-stripped). */
export function normalizeRelationshipType(type: string): string {
  return type.includes(".")
    ? type.slice(type.lastIndexOf(".") + 1).toUpperCase()
    : type.toUpperCase();
}

export function relationshipKind(type: string): IntelligenceRelationship {
  const normalized = normalizeRelationshipType(type);
  const direct = RELATIONSHIP_TYPE_TO_KIND[`keystone.core.${normalized}`];
  if (direct) return direct;
  // Fallback: try the raw passed value (already namespaced or not).
  return RELATIONSHIP_TYPE_TO_KIND[type] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Confidence category (visual semantics) derived from resolution + relationship
// ---------------------------------------------------------------------------

const UNRESOLVED_RESOLUTIONS = new Set<ResolutionType>(["unresolved", "candidate"]);

export function confidenceCategoryFor(
  relationship: IntelligenceRelationshipRecord,
): IntelligenceConfidenceCategory {
  const resolution = relationship.resolution ?? "external";
  if (UNRESOLVED_RESOLUTIONS.has(resolution)) {
    return "unresolved";
  }
  switch (resolution) {
    case "exact":
    case "framework":
    case "compiler":
      return "proven";
    case "convention":
    case "syntactic":
      return "inferred";
    default:
      // external/probabilistic are treated as structural association.
      return "structural";
  }
}

export function isUnresolved(relationship: IntelligenceRelationshipRecord): boolean {
  const resolution = relationship.resolution ?? "external";
  return resolution === "unresolved" || resolution === "candidate";
}

export function isInferred(relationship: IntelligenceRelationshipRecord): boolean {
  const resolution = relationship.resolution ?? "external";
  return resolution === "convention" || resolution === "syntactic" || resolution === "candidate";
}

// ---------------------------------------------------------------------------
// Grouping basis label
// ---------------------------------------------------------------------------

export function groupingBasis(declared: boolean, derived: boolean): IntelligenceGroupingBasis {
  if (declared) return "declared";
  if (derived) return "derived";
  return "inferred";
}

// ---------------------------------------------------------------------------
// Node id helpers (stable, derived from entity id)
// ---------------------------------------------------------------------------

export function nodeIdForEntity(entityId: string): string {
  return `n:${entityId}`;
}

export function edgeIdForRelationship(relationshipId: string): string {
  return `e:${relationshipId}`;
}

// ---------------------------------------------------------------------------
// Confidence helpers
// ---------------------------------------------------------------------------

export function lowConfidenceThreshold(): number {
  return 0.4;
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < lowConfidenceThreshold();
}
