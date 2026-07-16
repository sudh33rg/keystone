import { z } from 'zod/v4';

/**
 * OKF Concept
 *
 * Represents a human-readable, evidence-backed knowledge concept
 * generated deterministically from canonical intelligence.
 *
 * Core principles:
 * - Every concept uses a stable Keystone entity ID
 * - Every page is grounded in canonical entities, relationships, and evidence
 * - Prose is rendered from deterministic templates
 * - Manual content is clearly separated and preserved
 * - Links use relative Markdown paths
 * - Only affected concepts are regenerated
 * - Broken links and stale concepts are reported
 */

// Frontmatter schema for OKF concept files
export const OkfConceptFrontmatterSchema = z.object({
  type: z.enum([
    'Repository',
    'File',
    'Class',
    'Interface',
    'Function',
    'Method',
    'Component',
    'Hook',
    'Route',
    'Middleware',
    'Module',
    'Package',
    'Endpoint',
    'Database',
    'Table',
    'Column',
    'ORM Entity',
    'ORM Field',
    'Test Suite',
    'Test Case',
    'Build Target',
    'Pipeline',
    'Container',
    'Kubernetes Resource',
    'Terraform Resource',
    'Configuration',
    'Document',
    'ADR',
    'RFC',
    'Runbook',
    'Guide',
  ]),
  title: z.string(),
  keystone_id: z.string(),
  repository_id: z.string(),
  branch: z.string(),
  head_commit: z.string().optional(),
  generation: z.number(),
  language: z.enum(['typescript', 'javascript', 'tsx', 'jsx', 'java', 'python', 'csharp', 'go', 'rust', 'c', 'cpp', 'ruby', 'php', 'kotlin', 'swift', 'shell', 'sql']).optional(),
  qualified_name: z.string().optional(),
  module: z.string().optional(),
  visibility: z.enum(['public', 'protected', 'private', 'internal']).optional(),
  source: z.object({
    path: z.string(),
    start_line: z.number(),
    end_line: z.number(),
  }).optional(),
  derivation: z.enum([
    'extracted',
    'resolved',
    'calculated',
    'framework-rule',
    'runtime-observed',
    'user-asserted',
  ]),
  confidence: z.number().min(0).max(1),
  content_hash: z.string().optional(),
  parser_id: z.string().optional(),
  parser_version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  user_annotations: z.record(z.string()).optional(),
});

type OkfConceptFrontmatter = z.infer<typeof OkfConceptFrontmatterSchema>;

/**
 * Concept body sections that may be included based on entity type
 */
export const OkfConceptBodySchema = z.object({
  signature: z.string().optional(),
  declaration: z.string().optional(),
  belongs_to: z.array(z.object({
    type: z.enum(['Class', 'Interface', 'Module', 'Package', 'Repository']),
    id: z.string(),
    title: z.string(),
    path: z.string(),
  })).optional(),
  calls: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated', 'framework-rule', 'convention', 'candidate']),
    evidence: z.string(),
  })).optional(),
  called_by: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated', 'framework-rule', 'convention', 'candidate']),
    evidence: z.string(),
  })).optional(),
  imports: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['import', 'require', 're-export', 'external']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'convention']),
    evidence: z.string(),
  })).optional(),
  exports: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['export', 'default', 're-export']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved']),
    evidence: z.string(),
  })).optional(),
  references: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['read', 'write', 'call', 'instantiate']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  reads: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['file', 'database', 'configuration', 'environment', 'other']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  writes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['file', 'database', 'configuration', 'environment', 'other']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  routes: z.array(z.object({
    method: z.string().optional(),
    path: z.string(),
    id: z.string(),
    title: z.string(),
    path: z.string(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  middleware: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    position: z.number(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  tests: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['suite', 'case', 'hook', 'fixture']),
    coverage: z.number(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  covered_by: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    coverage: z.number(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  configuration: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['file', 'environment', 'other']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'convention']),
    evidence: z.string(),
  })).optional(),
  changes: z.array(z.object({
    kind: z.enum(['added', 'modified', 'deleted']),
    branch: z.string(),
    commit: z.string(),
    generation: z.number(),
    confidence: z.number(),
    derivation: z.enum(['git', 'computed']),
  })).optional(),
  evidence: z.array(z.object({
    source_kind: z.enum(['source', 'parser', 'git', 'metadata']),
    path: z.string(),
    start_line: z.number(),
    end_line: z.number(),
    parser_id: z.string(),
    parser_version: z.string(),
    derivation: z.enum(['extracted', 'resolved', 'calculated', 'framework-rule', 'runtime-observed', 'user-asserted']),
    content_hash: z.string(),
    branch: z.string(),
    commit: z.string(),
    generation: z.number(),
    confidence: z.number(),
    statement: z.string(),
  })).optional(),
  limitations: z.array(z.object({
    kind: z.enum(['confidence', 'mapping', 'coverage', 'unresolved', 'unsupported']),
    message: z.string(),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  backlinks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    kind: z.enum(['relationship', 'related', 'source', 'parent', 'child']),
    confidence: z.number(),
    derivation: z.enum(['extracted', 'resolved', 'calculated']),
    evidence: z.string(),
  })).optional(),
  user_annotation: z.record(z.string()).optional(),
});

type OkfConceptBody = z.infer<typeof OkfConceptBodySchema>;

export interface OkfConcept {
  frontmatter: OkfConceptFrontmatter;
  body: OkfConceptBody;
  /**
   * Unique path identifier within the OKF bundle
   * Example: "code/classes/OrderService.md"
   */
  path: string;
  /**
   * Hash of the concept content for change detection
   */
  contentHash: string;
  /**
   * Whether this concept contains user annotations
   */
  hasUserAnnotations: boolean;
}

/**
 * Create an OKF concept from canonical intelligence data.
 *
 * This is the primary entry point for concept generation.
 * It validates that the source entity exists and that all
 * referenced IDs are valid.
 */
export function createOkfConcept(
  keystoneId: string,
  entityType: string,
  {
    title,
    qualifiedName,
    moduleName,
    visibility,
    sourcePath,
    sourceStartLine,
    sourceEndLine,
    repositoryId,
    branch,
    headCommit,
    generation,
    language,
    tags,
    confidence,
    contentHash,
    parserId,
    parserVersion,
  }: {
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
  relationships: {
    calls?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated' | 'framework-rule' | 'convention' | 'candidate';
      evidence: string;
    }>;
    calledBy?: Array<{
      sourceId: string;
      sourceTitle: string;
      sourcePath: string;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated' | 'framework-rule' | 'convention' | 'candidate';
      evidence: string;
    }>;
    imports?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'import' | 'require' | 're-export' | 'external';
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'convention';
      evidence: string;
    }>;
    exports?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'export' | 'default' | 're-export';
      confidence: number;
      derivation: 'extracted' | 'resolved';
      evidence: string;
    }>;
    references?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'read' | 'write' | 'call' | 'instantiate';
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    reads?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'file' | 'database' | 'configuration' | 'environment' | 'other';
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    writes?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'file' | 'database' | 'configuration' | 'environment' | 'other';
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    routes?: Array<{
      method?: string;
      path: string;
      targetId: string;
      targetTitle: string;
      targetPath: string;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    middleware?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      position: number;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    tests?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'suite' | 'case' | 'hook' | 'fixture';
      coverage: number;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    coveredBy?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      coverage: number;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
    configuration?: Array<{
      targetId: string;
      targetTitle: string;
      targetPath: string;
      kind: 'file' | 'environment' | 'other';
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'convention';
      evidence: string;
    }>;
    changes?: Array<{
      kind: 'added' | 'modified' | 'deleted';
      branch: string;
      commit: string;
      generation: number;
      confidence: number;
      derivation: 'git' | 'computed';
    }>;
    evidence?: Array<{
      sourceKind: 'source' | 'parser' | 'git' | 'metadata';
      path: string;
      startLine: number;
      endLine: number;
      parserId: string;
      parserVersion: string;
      derivation: 'extracted' | 'resolved' | 'calculated' | 'framework-rule' | 'runtime-observed' | 'user-asserted';
      contentHash: string;
      branch: string;
      commit: string;
      generation: number;
      confidence: number;
      statement: string;
    }>;
    limitations?: Array<{
      kind: 'confidence' | 'mapping' | 'coverage' | 'unresolved' | 'unsupported';
      message: string;
      confidence: number;
      derivation: 'extracted' | 'resolved' | 'calculated';
      evidence: string;
    }>;
  },
  userAnnotations?: Record<string, string>,
): OkfConcept {
  // Validate keystone_id format
  if (!keystoneId.startsWith('entity:') || keystoneId.includes(':') === false) {
    throw new Error(`Invalid keystone_id format: ${keystoneId}`);
  }

  // Validate generation is positive
  if (generation < 0) {
    throw new Error(`Generation must be non-negative: ${generation}`);
  }

  // Validate confidence range
  if (entityData.confidence < 0 || entityData.confidence > 1) {
    throw new Error(`Confidence must be between 0 and 1: ${entityData.confidence}`);
  }

  // Validate tags
  if (entityData.tags !== undefined && entityData.tags !== null) {
    for (const tag of entityData.tags) {
      if (typeof tag !== 'string' || tag.trim() === '') {
        throw new Error('Tags must be non-empty strings');
      }
    }
  }

  // Validate user annotations
  if (userAnnotations !== undefined && userAnnotations !== null) {
    for (const [key, value] of Object.entries(userAnnotations)) {
      if (typeof key !== 'string' || key.trim() === '') {
        throw new Error('User annotation keys must be non-empty strings');
      }
      if (typeof value !== 'string') {
        throw new Error('User annotation values must be strings');
      }
    }
  }

  return {
    frontmatter: {
      type: entityType,
      title: entityData.title,
      keystone_id: keystoneId,
      repository_id: entityData.repositoryId,
      branch: entityData.branch,
      head_commit: entityData.headCommit,
      generation: generation,
      language: entityData.language,
      qualified_name: entityData.qualifiedName,
      module: entityData.moduleName,
      visibility: entityData.visibility,
      source: entityData.sourcePath !== undefined ? {
        path: entityData.sourcePath,
        start_line: entityData.sourceStartLine,
        end_line: entityData.sourceEndLine,
      } : undefined,
      derivation: 'extracted',
      confidence: entityData.confidence,
      content_hash: entityData.contentHash,
      parser_id: entityData.parserId,
      parser_version: entityData.parserVersion,
      tags: entityData.tags,
      user_annotations: userAnnotations,
    },
    body: entityData.body,
    path: entityData.path,
    contentHash: entityData.contentHash,
    hasUserAnnotations: userAnnotations !== undefined && Object.keys(userAnnotations).length > 0,
  };
}
