/**
 * OKF Concept Mapper
 *
 * Translates canonical intelligence entities into OKF concepts.
 * This is the bridge between the computational graph and the
 * human-readable projection.
 *
 * The mapper ensures:
 * - Every OKF concept maps back to canonical entity IDs
 * - Relationships are represented deterministically
 * - Evidence is preserved and linked
 * - User annotations are preserved across regenerations
 */

import { generateOkfPath, validateKeystoneId } from "./OkfConceptIdFactory";
import { OkfConceptBodySchema, OkfConceptFrontmatterSchema, type OkfConcept } from "./OkfConcept";

/**
 * Relationship kind for OKF concepts
 */
export type OkfRelationshipKind =
  | "calls"
  | "called_by"
  | "imports"
  | "exports"
  | "references"
  | "reads"
  | "writes"
  | "routes"
  | "middleware"
  | "tests"
  | "covered_by"
  | "configuration"
  | "belongs_to";

/**
 * Relationship metadata
 */
export interface OkfRelationshipMetadata {
  kind: OkfRelationshipKind;
  id: string;
  title: string;
  path: string;
  confidence: number;
  derivation:
    "extracted" | "resolved" | "calculated" | "framework-rule" | "convention" | "candidate";
  evidence: string;
}

/**
 * An OKF concept with resolved relationships
 */
export interface OkfMappedConcept extends OkfConcept {
  relationships: Record<OkfRelationshipKind, OkfRelationshipMetadata[]>;
}

/**
 * Convert a canonical entity to an OKF concept.
 *
 * @param keystoneId - The Keystone entity ID
 * @param entityType - The OKF concept type
 * @param entityData - Entity data from canonical intelligence
 * @param relationships - Relationships from the canonical graph
 * @param userAnnotations - User annotations (preserved across regenerations)
 * @returns An OKF concept
 */
export function mapEntityToConcept(
  keystoneId: string,
  entityType: string,
  entityData: {
    title: string;
    qualifiedName?: string;
    moduleName?: string;
    visibility?: string;
    sourcePath?: string;
    sourceStartLine?: number;
    sourceEndLine?: number;
    repositoryId: string;
    branch: string;
    headCommit?: string;
    generation: number;
    language?: string;
    tags?: string[];
    confidence: number;
    contentHash?: string;
    parserId?: string;
    parserVersion?: string;
  },
  relationships: Record<
    OkfRelationshipKind,
    Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind:
        | "import"
        | "require"
        | "re-export"
        | "external"
        | "read"
        | "write"
        | "call"
        | "instantiate"
        | "file"
        | "database"
        | "configuration"
        | "environment"
        | "other"
        | "suite"
        | "case"
        | "hook"
        | "fixture"
        | "method"
        | "class"
        | "interface"
        | "module"
        | "package"
        | "route"
        | "middleware"
        | "endpoint";
      confidence: number;
      derivation:
        "extracted" | "resolved" | "calculated" | "framework-rule" | "convention" | "candidate";
      evidence: string;
    }>
  >,
  userAnnotations?: Record<string, string>,
): OkfMappedConcept {
  // Validate keystone_id format
  validateKeystoneId(keystoneId, entityData.language || "typescript");

  // Generate the OKF path
  const okfPath = generateOkfPath(keystoneId, entityType, entityData.language || "typescript");

  // Create the concept
  const concept: OkfMappedConcept = {
    frontmatter: OkfConceptFrontmatterSchema.parse({
      type: entityType,
      title: entityData.title,
      keystone_id: keystoneId,
      repository_id: entityData.repositoryId,
      branch: entityData.branch,
      head_commit: entityData.headCommit,
      generation: entityData.generation,
      language: entityData.language,
      qualified_name: entityData.qualifiedName,
      module: entityData.moduleName,
      visibility: entityData.visibility,
      source:
        entityData.sourcePath !== undefined &&
        entityData.sourceStartLine !== undefined &&
        entityData.sourceEndLine !== undefined
          ? {
              path: entityData.sourcePath,
              start_line: entityData.sourceStartLine,
              end_line: entityData.sourceEndLine,
            }
          : undefined,
      derivation: "extracted",
      confidence: entityData.confidence,
      content_hash: entityData.contentHash,
      parser_id: entityData.parserId,
      parser_version: entityData.parserVersion,
      tags: entityData.tags,
      user_annotations: userAnnotations,
    }),
    body: OkfConceptBodySchema.parse({
      signature: generateSignature(entityType, entityData),
      declaration: [
        generateEvidence(entityData),
        generateChanges(entityData),
        generateLimitations(entityData),
      ]
        .filter(Boolean)
        .join("\n\n"),
    }),
    path: okfPath,
    contentHash:
      entityData.contentHash || generateContentHash(keystoneId, entityType, entityData.confidence),
    hasUserAnnotations: userAnnotations !== undefined && Object.keys(userAnnotations).length > 0,
    relationships: {
      calls: extractRelationships(relationships.calls, "calls"),
      called_by: extractRelationships(relationships.called_by, "called_by"),
      imports: extractRelationships(relationships.imports, "imports"),
      exports: extractRelationships(relationships.exports, "exports"),
      references: extractRelationships(relationships.references, "references"),
      reads: extractRelationships(relationships.reads, "reads"),
      writes: extractRelationships(relationships.writes, "writes"),
      routes: extractRelationships(relationships.routes, "routes"),
      middleware: extractRelationships(relationships.middleware, "middleware"),
      tests: extractRelationships(relationships.tests, "tests"),
      covered_by: extractRelationships(relationships.covered_by, "covered_by"),
      configuration: extractRelationships(relationships.configuration, "configuration"),
      belongs_to: extractRelationships(relationships.belongs_to, "belongs_to"),
    },
  };

  return concept;
}

/**
 * Generate a signature string for a concept.
 *
 * @param entityType - The concept type
 * @param entityData - Entity data
 * @returns A signature string
 */
function generateSignature(
  entityType: string,
  entityData: {
    title: string;
    qualifiedName?: string;
    moduleName?: string;
    visibility?: string;
    sourcePath?: string;
    sourceStartLine?: number;
    sourceEndLine?: number;
  },
): string {
  const title = entityData.title;

  if (entityType === "Method") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Function") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Class") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Component") {
    return `## Signature

\`\`\`tsx
${title}
\`\`\``;
  }

  if (entityType === "Hook") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Route") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Middleware") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  if (entityType === "Interface") {
    return `## Signature

\`\`\`ts
${title}
\`\`\``;
  }

  return "";
}

/**
 * Generate evidence section for a concept.
 *
 * @param entityData - Entity data
 * @returns Evidence markdown
 */
function generateEvidence(entityData: {
  sourcePath?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
}): string {
  const parts: string[] = [];

  if (entityData.sourcePath) {
    parts.push(`- **Source**: \`${entityData.sourcePath}\``);
  }

  if (entityData.sourceStartLine) {
    const lineRange = entityData.sourceEndLine
      ? `:${entityData.sourceStartLine}-${entityData.sourceEndLine}`
      : `:${entityData.sourceStartLine}`;
    parts.push(`- **Range**: \`${lineRange}\``);
  }

  return parts.length > 0
    ? `## Evidence

${parts.join("\\n")}`
    : "";
}

/**
 * Generate changes section for a concept.
 *
 * @param entityData - Entity data
 * @returns Changes markdown
 */
function generateChanges(entityData: {
  generation: number;
  branch: string;
  headCommit?: string;
}): string {
  const parts: string[] = [];

  parts.push(`- Last modified in generation ${entityData.generation}`);
  parts.push(`- Current branch: \`${entityData.branch}\``);

  if (entityData.headCommit) {
    parts.push(`- HEAD: \`${entityData.headCommit}\``);
  }

  return `## Changes

${parts.join("\\n")}`;
}

/**
 * Generate limitations section for a concept.
 *
 * @param entityData - Entity data
 * @returns Limitations markdown
 */
function generateLimitations(entityData: {
  qualifiedName?: string;
  moduleName?: string;
  visibility?: string;
  confidence: number;
}): string {
  const limitations: string[] = [];

  // Check for low confidence
  if (entityData.confidence < 0.7) {
    limitations.push(`Confidence is limited because mapping uses naming convention.`);
  }

  // Check for unresolved imports
  if (entityData.qualifiedName) {
    const unresolved = entityData.qualifiedName.match(/:unresolved:/);
    if (unresolved) {
      limitations.push(`Imports include unresolved references.`);
    }
  }

  if (limitations.length > 0) {
    return `## Limitations

${limitations.join("\\n")}`;
  }

  return "";
}

/**
 * Extract relationships in a specific kind.
 *
 * @param relationships - All relationships
 * @param language - The programming language
 * @returns Relationships of the specified kind
 */
function extractRelationships(
  allRelationships: Array<{
    targetId: string;
    targetTitle: string;
    targetPath: string;
    kind: string;
    confidence: number;
    derivation:
      "extracted" | "resolved" | "calculated" | "framework-rule" | "convention" | "candidate";
    evidence: string;
  }>,
  relationshipKind: OkfRelationshipKind,
): OkfRelationshipMetadata[] {
  return (allRelationships ?? []).map((r) => ({
    kind: relationshipKind,
    id: r.targetId,
    title: r.targetTitle,
    path: r.targetPath,
    confidence: r.confidence,
    derivation: r.derivation,
    evidence: r.evidence,
  }));
}

/**
 * Generate a content hash for a concept.
 *
 * @param keystoneId - The Keystone entity ID
 * @param entityType - The concept type
 * @param confidence - The confidence
 * @returns A content hash
 */
function generateContentHash(keystoneId: string, entityType: string, confidence: number): string {
  const sha256 = (input: string) => {
    const buffer = Buffer.from(input, "utf8");
    return buffer.toString("hex");
  };

  return sha256(`${keystoneId}|${entityType}|${confidence}`);
}
