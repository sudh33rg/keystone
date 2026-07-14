import { z } from "zod";
import type { Activity, BootstrapSnapshot, PersistedFoundationState } from "./domain";
import { ActivitySchema, BootstrapSnapshotSchema, NavigationSectionSchema, PersistedFoundationStateSchema, SCHEMA_VERSION } from "./domain";
import type { SerializedKeystoneError } from "../errors/KeystoneError";

const envelopeFields = {
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SCHEMA_VERSION)
};

export const WebviewRequestSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeFields, type: z.literal("app/bootstrap"), payload: z.object({}).strict() }).strict(),
  z.object({ ...envelopeFields, type: z.literal("app/ping"), payload: z.object({}).strict() }).strict(),
  z.object({ ...envelopeFields, type: z.literal("navigation/set"), payload: z.object({ section: NavigationSectionSchema }).strict() }).strict(),
  z.object({ ...envelopeFields, type: z.literal("settings/open"), payload: z.object({ query: z.string().max(120).optional() }).strict() }).strict(),
  z.object({ ...envelopeFields, type: z.literal("logs/show"), payload: z.object({}).strict() }).strict()
]);

export type WebviewRequest = z.infer<typeof WebviewRequestSchema>;

const SerializedKeystoneErrorSchema = z.object({
  code: z.string(),
  category: z.enum(["WORKSPACE", "INDEXING", "PARSING", "PERSISTENCE", "COPILOT", "AGENT", "CONTEXT", "VALIDATION", "TERMINAL", "WEBVIEW", "CONFIGURATION", "INTERNAL"]),
  message: z.string(),
  technicalDetails: z.string().optional(),
  operation: z.string(),
  recoverable: z.boolean(),
  recommendedAction: z.string(),
  retryable: z.boolean(),
  correlationId: z.string()
});

const hostEnvelopeFields = {
  eventId: z.string().uuid(),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SCHEMA_VERSION)
};

export const HostMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...hostEnvelopeFields, type: z.literal("response/success"), payload: z.object({ requestId: z.string(), data: z.unknown().optional() }) }),
  z.object({ ...hostEnvelopeFields, type: z.literal("response/error"), payload: z.object({ requestId: z.string(), error: SerializedKeystoneErrorSchema }) }),
  z.object({ ...hostEnvelopeFields, type: z.literal("bootstrap/ready"), payload: BootstrapSnapshotSchema }),
  z.object({ ...hostEnvelopeFields, type: z.literal("state/updated"), payload: PersistedFoundationStateSchema }),
  z.object({ ...hostEnvelopeFields, type: z.literal("activity/updated"), payload: ActivitySchema })
]);

export type HostMessage =
  | MessageEnvelope<"response/success", { requestId: string; data?: unknown }>
  | MessageEnvelope<"response/error", { requestId: string; error: SerializedKeystoneError }>
  | MessageEnvelope<"bootstrap/ready", BootstrapSnapshot>
  | MessageEnvelope<"state/updated", PersistedFoundationState>
  | MessageEnvelope<"activity/updated", Activity>;

export interface MessageEnvelope<TType extends string, TPayload> {
  eventId: string;
  type: TType;
  timestamp: string;
  schemaVersion: typeof SCHEMA_VERSION;
  payload: TPayload;
}

export function hostMessage<TType extends string, TPayload>(type: TType, payload: TPayload): MessageEnvelope<TType, TPayload> {
  return {
    eventId: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    payload
  };
}
