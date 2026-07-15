import { z } from "zod";
import {
  ActivitySchema,
  BootstrapSnapshotSchema,
  NavigationSectionSchema,
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
  envelopeFields,
  hostEnvelopeFields,
  type BootstrapSnapshot,
  type PersistedFoundationState
} from "./domain";
import {
  IntelligenceEntityRequestSchema,
  IntelligenceNeighborhoodRequestSchema,
  IntelligenceOverviewSchema,
  IntelligenceSearchRequestSchema,
  IntelligenceRuntimeOverviewSchema,
  IntelligenceStatusSchema,
  SourceRangeSchema,
  type IntelligenceEntityDetails,
  type IntelligenceNeighborhood,
  type IntelligenceOverview,
  type IntelligenceSearchResult
} from "./intelligence";
import type { SerializedKeystoneError } from "../errors/KeystoneError";
import { CpgScopeQuerySchema, CpgSliceQuerySchema, type CpgQueryResult, type CpgSliceResult } from "./cpg";
import { AdapterDiagnosticsRequestSchema, TechnologyCoverageRequestSchema, type AdapterDiagnosticsResult, type TechnologyCoverageResult } from "./adapters";
import { IntelligenceQuerySchema, QueryCancelRequestSchema, QueryCompileRequestSchema, QueryExplanationRequestSchema, QueryLifecycleEventSchema, QuerySuggestionRequestSchema, UnifiedQueryRequestSchema, type IntelligenceQueryResult, type QueryCompilation, type QueryExplanation, type QuerySuggestionsResult, type QueryTemplatesResult } from "./query";

export const SerializedKeystoneErrorSchema = z.object({
  code: z.string(),
  category: z.enum(["WORKSPACE", "INDEXING", "PARSING", "PERSISTENCE", "COPILOT", "AGENT", "CONTEXT", "VALIDATION", "TERMINAL", "WEBVIEW", "CONFIGURATION", "INTERNAL"]),
  message: z.string(),
  technicalDetails: z.string().optional(),
  operation: z.string(),
  recoverable: z.boolean(),
  recommendedAction: z.string(),
  retryable: z.boolean(),
  correlationId: z.string()
}).strict();

export const WebviewRequestSchema = z.discriminatedUnion("type", [
  request("app/bootstrap", z.object({}).strict()),
  request("app/ping", z.object({}).strict()),
  request("navigation/set", z.object({ section: NavigationSectionSchema }).strict()),
  request("settings/open", z.object({ query: z.string().max(120).optional() }).strict()),
  request("logs/show", z.object({}).strict()),
  request("intelligence/overview", z.object({}).strict()),
  request("intelligence/scan/start", z.object({}).strict()),
  request("intelligence/scan/cancel", z.object({}).strict()),
  request("intelligence/runtime/pause", z.object({}).strict()),
  request("intelligence/runtime/resume", z.object({}).strict()),
  request("intelligence/search", IntelligenceSearchRequestSchema),
  request("intelligence/entity", IntelligenceEntityRequestSchema),
  request("intelligence/neighborhood", IntelligenceNeighborhoodRequestSchema),
  request("intelligence/technologies", TechnologyCoverageRequestSchema),
  request("intelligence/adapter-diagnostics", AdapterDiagnosticsRequestSchema),
  request("intelligence/query", UnifiedQueryRequestSchema),
  request("intelligence/query/compile", QueryCompileRequestSchema),
  request("intelligence/query/cancel", QueryCancelRequestSchema),
  request("intelligence/query/suggestions", QuerySuggestionRequestSchema),
  request("intelligence/query/templates", z.object({}).strict()),
  request("intelligence/query/explanation", QueryExplanationRequestSchema),
  request("intelligence/path", IntelligenceQuerySchema),
  request("intelligence/impact", IntelligenceQuerySchema),
  request("intelligence/flow", IntelligenceQuerySchema),
  request("intelligence/architecture", IntelligenceQuerySchema),
  request("intelligence/dependencies", IntelligenceQuerySchema),
  request("intelligence/tests", IntelligenceQuerySchema),
  request("intelligence/changes", IntelligenceQuerySchema),
  request("intelligence/cpg", IntelligenceQuerySchema),
  request("intelligence/cpg/scope", CpgScopeQuerySchema),
  request("intelligence/cpg/slice", CpgSliceQuerySchema),
  request("intelligence/source/open", z.object({ relativePath: z.string().min(1).max(1024), range: SourceRangeSchema.optional() }).strict()),
  request("request/cancel", z.object({ targetRequestId: z.string().uuid() }).strict())
]);
export type WebviewRequest = z.infer<typeof WebviewRequestSchema>;
export type WebviewRequestType = WebviewRequest["type"];
export type WebviewPayload<T extends WebviewRequestType> = Extract<WebviewRequest, { type: T }>["payload"];

const IntelligenceRuntimeEventPayloadSchema = z.object({
  status: IntelligenceStatusSchema,
  pendingUpdate: z.boolean(),
  scanRevision: z.number().int().nonnegative(),
  ...IntelligenceRuntimeOverviewSchema.shape,
  error: z.object({ code: z.string(), message: z.string() }).strict().optional()
}).strict();

export const HostMessageSchema = z.discriminatedUnion("type", [
  event("response/success", z.object({ requestId: z.string().uuid(), data: z.unknown().optional() }).strict()),
  event("response/error", z.object({ requestId: z.string().uuid(), error: SerializedKeystoneErrorSchema }).strict()),
  event("bootstrap/ready", BootstrapSnapshotSchema),
  event("state/updated", PersistedFoundationStateSchema),
  event("activity/updated", ActivitySchema),
  event("intelligence/updated", IntelligenceOverviewSchema),
  event("intelligence/runtime", IntelligenceRuntimeEventPayloadSchema),
  event("intelligence/queryStarted", QueryLifecycleEventSchema),
  event("intelligence/queryProgress", QueryLifecycleEventSchema),
  event("intelligence/queryCompleted", QueryLifecycleEventSchema),
  event("intelligence/queryCancelled", QueryLifecycleEventSchema),
  event("intelligence/queryFailed", QueryLifecycleEventSchema),
  event("intelligence/queryInvalidated", QueryLifecycleEventSchema)
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;

export interface WebviewRequestResults {
  "app/bootstrap": BootstrapSnapshot;
  "app/ping": { serverTime: string };
  "navigation/set": PersistedFoundationState;
  "settings/open": undefined;
  "logs/show": undefined;
  "intelligence/overview": IntelligenceOverview;
  "intelligence/scan/start": { scanRevision: number };
  "intelligence/scan/cancel": undefined;
  "intelligence/runtime/pause": undefined;
  "intelligence/runtime/resume": undefined;
  "intelligence/search": IntelligenceSearchResult;
  "intelligence/entity": IntelligenceEntityDetails | undefined;
  "intelligence/neighborhood": IntelligenceNeighborhood;
  "intelligence/technologies": TechnologyCoverageResult;
  "intelligence/adapter-diagnostics": AdapterDiagnosticsResult;
  "intelligence/query": IntelligenceQueryResult;
  "intelligence/query/compile": QueryCompilation;
  "intelligence/query/cancel": undefined;
  "intelligence/query/suggestions": QuerySuggestionsResult;
  "intelligence/query/templates": QueryTemplatesResult;
  "intelligence/query/explanation": QueryExplanation | undefined;
  "intelligence/path": IntelligenceQueryResult;
  "intelligence/impact": IntelligenceQueryResult;
  "intelligence/flow": IntelligenceQueryResult;
  "intelligence/architecture": IntelligenceQueryResult;
  "intelligence/dependencies": IntelligenceQueryResult;
  "intelligence/tests": IntelligenceQueryResult;
  "intelligence/changes": IntelligenceQueryResult;
  "intelligence/cpg": IntelligenceQueryResult;
  "intelligence/cpg/scope": CpgQueryResult | undefined;
  "intelligence/cpg/slice": CpgSliceResult | undefined;
  "intelligence/source/open": undefined;
  "request/cancel": undefined;
}

export type WebviewResult<T extends WebviewRequestType> = WebviewRequestResults[T];

export function hostMessage<T extends HostMessage["type"]>(
  type: T,
  payload: Extract<HostMessage, { type: T }>["payload"]
): Extract<HostMessage, { type: T }> {
  return {
    eventId: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    payload
  } as Extract<HostMessage, { type: T }>;
}

function request<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...envelopeFields, type: z.literal(type), payload }).strict();
}

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...hostEnvelopeFields, type: z.literal(type), payload }).strict();
}

export type { SerializedKeystoneError };
