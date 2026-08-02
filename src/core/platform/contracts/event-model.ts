import type { KeystonePlatform, Metadata, RepositoryReference } from "./domain-model";

export type EventCategory =
  | "repository"
  | "knowledge"
  | "reasoning"
  | "workflow"
  | "modernization"
  | "documentation"
  | "ai"
  | "observability"
  | "security"
  | "data"
  | "storage"
  | "execution"
  | "enterprise"
  | "analytics"
  | "testing-quality"
  | "deployment-operations"
  | "plugin-marketplace"
  | "engineering-standards"
  | "engineering"
  | "experience"
  | "platform";

export interface ActorReference {
  readonly id: string;
  readonly type: "user" | "system" | "agent" | "plugin" | string;
  readonly displayName?: string;
}

export interface AssetReference {
  readonly id: string;
  readonly type?: string;
  readonly name?: string;
}

export interface EventMetadata {
  readonly repository?: string;
  readonly workspace?: string;
  readonly session?: string;
  readonly user?: string;
  readonly traceId: string;
  readonly schemaVersion: string;
  readonly platformVersion: string;
  readonly eventVersion: string;
  readonly payloadClassification?: "public" | "internal" | "sensitive";
  readonly attributes: Metadata;
}

export interface CanonicalEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>
> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly platform: KeystonePlatform;
  readonly source: string;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actor?: ActorReference;
  readonly repository?: RepositoryReference;
  readonly assetReferences: readonly AssetReference[];
  readonly payload: Readonly<TPayload>;
  readonly metadata: EventMetadata;
  readonly schemaVersion: string;
}

export interface PublishEventInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>
> {
  readonly eventType: string;
  readonly platform: KeystonePlatform;
  readonly source: string;
  readonly payload: TPayload;
  readonly eventVersion?: string;
  readonly schemaVersion?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly actor?: ActorReference;
  readonly repository?: RepositoryReference;
  readonly assetReferences?: readonly AssetReference[];
  readonly metadata?: Partial<EventMetadata> & { readonly attributes?: Metadata };
}

export interface EventSubscriptionFilter {
  readonly eventType?: string;
  readonly platform?: KeystonePlatform;
  readonly correlationId?: string;
  readonly predicate?: (event: CanonicalEvent) => boolean;
}

export interface EventDeliveryRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly subscriber: string;
  readonly publishedAt: string;
  readonly deliveredAt: string;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly status: "acknowledged" | "failed";
  readonly failureReason?: string;
  readonly correlationId: string;
  readonly traceId: string;
}

export interface DeadLetterRecord {
  readonly event: CanonicalEvent;
  readonly subscriber: string;
  readonly failedAt: string;
  readonly attempts: number;
  readonly reason: string;
}

export interface EventBusMetrics {
  readonly publishedCount: number;
  readonly deliveredCount: number;
  readonly failedDeliveryCount: number;
  readonly deadLetterCount: number;
  readonly replayedCount: number;
  readonly averageDeliveryDurationMs: number;
  readonly latestPublishedAt?: string;
}

export interface EventReplayOptions {
  readonly fromTimestamp?: string;
  readonly untilTimestamp?: string;
  readonly isolated?: boolean;
}

export interface EventBusSubscription {
  readonly id: string;
  dispose(): void;
}
