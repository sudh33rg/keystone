import { z } from "zod";
import { type SourceRange } from "./intelligence";

export const INTELLIGENCE_CANVAS_RELATIONSHIPS = [
  "contains", "imports", "depends-on", "calls", "implements", "extends",
  "routes-to", "reads", "writes", "tested-by", "flows-to", "unknown",
] as const;

export type IntelligenceCanvasRelationship = typeof INTELLIGENCE_CANVAS_RELATIONSHIPS[number];
export type IntelligenceCanvasMode = "architecture" | "calls" | "dependencies" | "flow" | "tests";
export type IntelligenceCanvasDirection = "inbound" | "outbound" | "both";

export interface IntelligenceCanvasSearchItem {
  id: string;
  label: string;
  qualifiedLabel: string;
  kind: string;
  filePath: string;
  range?: SourceRange;
  matchScore: number;
  context: string;
}

export interface IntelligenceCanvasNode {
  id: string;
  label: string;
  qualifiedLabel: string;
  kind: string;
  filePath: string;
  range?: SourceRange;
  confidence: number;
  inferred: boolean;
  expandable: { inbound: boolean; outbound: boolean };
}

export interface IntelligenceCanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: IntelligenceCanvasRelationship;
  label: string;
  confidence: number;
  inferred: boolean;
  evidenceIds: string[];
}

export interface IntelligenceGraphSliceRequest {
  rootEntityIds: string[];
  mode: IntelligenceCanvasMode;
  direction: IntelligenceCanvasDirection;
  depth: number;
  relationshipTypes: string[];
  maxNodes: number;
  maxEdges: number;
  minimumConfidence: number;
  intelligenceRevision?: string;
}

export interface IntelligenceGraphSlice {
  rootEntityIds: string[];
  nodes: IntelligenceCanvasNode[];
  edges: IntelligenceCanvasEdge[];
  request: Omit<IntelligenceGraphSliceRequest, "rootEntityIds" | "intelligenceRevision">;
  truncation: {
    truncated: boolean;
    nodeLimitReached: boolean;
    edgeLimitReached: boolean;
    expandableEntityIds: string[];
  };
  intelligenceRevision: string;
}

export type IntelligenceEngineeringIntent =
  | "callers" | "callees" | "dependencies" | "dependents" | "tests" | "flow" | "relationship";

export interface IntelligenceEngineeringQueryResult {
  status: "completed" | "needs-subject-selection" | "needs-target-selection" | "unsupported" | "no-result";
  intent?: IntelligenceEngineeringIntent;
  summary: string;
  subjectCandidates: IntelligenceCanvasSearchItem[];
  targetCandidates: IntelligenceCanvasSearchItem[];
  graph?: IntelligenceGraphSlice;
  path?: { entityIds: string[]; edgeIds: string[]; evidenceIds: string[] };
  intelligenceRevision: string;
}

export const IntelligenceCanvasModeSchema = z.enum(["architecture", "calls", "dependencies", "flow", "tests"]);
export const IntelligenceCanvasDirectionSchema = z.enum(["inbound", "outbound", "both"]);
export const IntelligenceCanvasRelationshipSchema = z.enum(INTELLIGENCE_CANVAS_RELATIONSHIPS);
export const IntelligenceGraphSliceRequestSchema = z.object({
  rootEntityIds: z.array(z.string().min(1)).min(1).max(20),
  mode: IntelligenceCanvasModeSchema,
  direction: IntelligenceCanvasDirectionSchema,
  depth: z.number().int().min(1).max(4),
  relationshipTypes: z.array(IntelligenceCanvasRelationshipSchema).min(1).max(INTELLIGENCE_CANVAS_RELATIONSHIPS.length),
  maxNodes: z.number().int().min(1).max(200),
  maxEdges: z.number().int().min(1).max(400),
  minimumConfidence: z.number().min(0).max(1),
  intelligenceRevision: z.string().min(1).optional(),
}).strict();
export const IntelligenceCanvasSearchRequestSchema = z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(50) }).strict();
export const IntelligenceCanvasEvidenceRequestSchema = z.object({ evidenceIds: z.array(z.string().min(1)).min(1).max(100), intelligenceRevision: z.string().min(1) }).strict();
export const IntelligenceCanvasQueryRequestSchema = z.object({
  text: z.string().trim().min(1).max(1_000), intelligenceRevision: z.string().min(1),
  resolvedSubjectId: z.string().min(1).optional(), resolvedTargetId: z.string().min(1).optional(),
  limits: z.object({ maxNodes: z.number().int().min(1).max(200), maxEdges: z.number().int().min(1).max(400), depth: z.number().int().min(1).max(4) }).strict(),
}).strict();
export const IntelligenceCanvasEntityActionRequestSchema = z.object({ entityId: z.string().min(1), intelligenceRevision: z.string().min(1) }).strict();
export const IntelligenceCanvasEvidenceActionRequestSchema = z.object({ evidenceId: z.string().min(1), intelligenceRevision: z.string().min(1) }).strict();
export const IntelligenceCanvasPathActionRequestSchema = z.object({
  entityIds: z.array(z.string().min(1)).min(2).max(20),
  edgeIds: z.array(z.string().min(1)).min(1).max(20),
  evidenceIds: z.array(z.string().min(1)).max(100),
  intelligenceRevision: z.string().min(1),
}).strict();
