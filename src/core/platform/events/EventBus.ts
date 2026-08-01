import type {
  CanonicalEvent,
  DeadLetterRecord,
  EventBusMetrics,
  EventBusSubscription,
  EventDeliveryRecord,
  EventReplayOptions,
  EventSubscriptionFilter,
  PublishEventInput
} from '../contracts/event-model';
import { randomUUID } from 'crypto';

export type EventHandler = (...args: unknown[]) => void | Promise<void>;
export type CanonicalEventHandler = (event: CanonicalEvent) => void | Promise<void>;

export interface EventBusOptions {
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly platformVersion?: string;
  readonly maxHistory?: number;
  readonly deadLetterLimit?: number;
  readonly retryLimit?: number;
}

interface CanonicalSubscription {
  readonly id: string;
  readonly filter: EventSubscriptionFilter;
  readonly handler: CanonicalEventHandler;
}

interface LegacySubscription {
  readonly id: string;
  readonly eventType: string;
  readonly handler: EventHandler;
}

interface MutableMetrics {
  publishedCount: number;
  deliveredCount: number;
  failedDeliveryCount: number;
  deadLetterCount: number;
  replayedCount: number;
  totalDeliveryDurationMs: number;
  latestPublishedAt?: string;
}

const DEFAULT_SCHEMA_VERSION = '1.0';
const DEFAULT_EVENT_VERSION = '1.0';
const DEFAULT_PLATFORM_VERSION = '0.1.0';

export class EventBus {
  private readonly legacySubscriptions = new Map<string, LegacySubscription[]>();
  private readonly canonicalSubscriptions = new Map<string, CanonicalSubscription>();
  private readonly eventHistory: CanonicalEvent[] = [];
  private readonly deliveryRecords: EventDeliveryRecord[] = [];
  private readonly deadLetters: DeadLetterRecord[] = [];
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly platformVersion: string;
  private readonly maxHistory: number;
  private readonly deadLetterLimit: number;
  private readonly retryLimit: number;
  private subscriptionSequence = 0;
  private metrics: MutableMetrics = {
    publishedCount: 0,
    deliveredCount: 0,
    failedDeliveryCount: 0,
    deadLetterCount: 0,
    replayedCount: 0,
    totalDeliveryDurationMs: 0
  };

  constructor(options: EventBusOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.platformVersion = options.platformVersion ?? DEFAULT_PLATFORM_VERSION;
    this.maxHistory = options.maxHistory ?? 5000;
    this.deadLetterLimit = options.deadLetterLimit ?? 500;
    this.retryLimit = options.retryLimit ?? 0;
  }

  on(eventType: string, handler: EventHandler): EventBusSubscription {
    const subscription: LegacySubscription = {
      id: this.nextSubscriptionId('legacy'),
      eventType,
      handler
    };
    const subscriptions = this.legacySubscriptions.get(eventType) ?? [];
    subscriptions.push(subscription);
    this.legacySubscriptions.set(eventType, subscriptions);

    return {
      id: subscription.id,
      dispose: () => this.removeLegacySubscription(subscription)
    };
  }

  emit(eventType: string, ...args: unknown[]): CanonicalEvent {
    const event = this.createEvent({
      eventType,
      platform: 'platform-services',
      source: 'legacy-event-bus',
      payload: { args },
      metadata: {
        attributes: {
          compatibility: 'legacy'
        }
      }
    });

    this.recordPublishedEvent(event);
    this.deliverLegacyEvent(eventType, args, event);
    void this.deliverCanonicalEvent(event);
    return event;
  }

  async publish<TPayload extends Record<string, unknown>>(
    input: PublishEventInput<TPayload> | CanonicalEvent<TPayload>
  ): Promise<CanonicalEvent<TPayload>> {
    const event = this.isCanonicalEvent(input) ? input : this.createEvent(input);
    this.assertCanonicalMetadata(event);
    this.recordPublishedEvent(event);
    await this.deliverCanonicalEvent(event);
    return event;
  }

  subscribe(filter: EventSubscriptionFilter, handler: CanonicalEventHandler): EventBusSubscription {
    const subscription: CanonicalSubscription = {
      id: this.nextSubscriptionId('canonical'),
      filter,
      handler
    };
    this.canonicalSubscriptions.set(subscription.id, subscription);

    return {
      id: subscription.id,
      dispose: () => {
        this.canonicalSubscriptions.delete(subscription.id);
      }
    };
  }

  async replay(
    filter: EventSubscriptionFilter = {},
    options: EventReplayOptions = {},
    handler?: CanonicalEventHandler
  ): Promise<CanonicalEvent[]> {
    const events = this.eventHistory.filter(event => {
      if (!this.matchesFilter(event, filter)) return false;
      if (options.fromTimestamp && event.timestamp < options.fromTimestamp) return false;
      if (options.untilTimestamp && event.timestamp > options.untilTimestamp) return false;
      return true;
    });

    this.metrics.replayedCount += events.length;

    if (handler) {
      for (const event of events) {
        await handler(event);
      }
    }

    return events;
  }

  getHistory(filter: EventSubscriptionFilter = {}): CanonicalEvent[] {
    return this.eventHistory.filter(event => this.matchesFilter(event, filter));
  }

  getDeliveryRecords(): EventDeliveryRecord[] {
    return [...this.deliveryRecords];
  }

  getDeadLetters(): DeadLetterRecord[] {
    return [...this.deadLetters];
  }

  getMetrics(): EventBusMetrics {
    const completedDeliveries = this.metrics.deliveredCount + this.metrics.failedDeliveryCount;
    return {
      publishedCount: this.metrics.publishedCount,
      deliveredCount: this.metrics.deliveredCount,
      failedDeliveryCount: this.metrics.failedDeliveryCount,
      deadLetterCount: this.metrics.deadLetterCount,
      replayedCount: this.metrics.replayedCount,
      averageDeliveryDurationMs: completedDeliveries === 0
        ? 0
        : this.metrics.totalDeliveryDurationMs / completedDeliveries,
      latestPublishedAt: this.metrics.latestPublishedAt
    };
  }

  private createEvent<TPayload extends Record<string, unknown>>(
    input: PublishEventInput<TPayload>
  ): CanonicalEvent<TPayload> {
    const timestamp = this.clock().toISOString();
    const schemaVersion = input.schemaVersion ?? input.metadata?.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
    const eventVersion = input.eventVersion ?? input.metadata?.eventVersion ?? DEFAULT_EVENT_VERSION;
    const traceId = input.metadata?.traceId ?? this.idGenerator();
    const correlationId = input.correlationId ?? this.idGenerator();

    return deepFreeze({
      eventId: this.idGenerator(),
      eventType: input.eventType,
      eventVersion,
      platform: input.platform,
      source: input.source,
      timestamp,
      correlationId,
      causationId: input.causationId,
      actor: input.actor,
      repository: input.repository,
      assetReferences: input.assetReferences ?? [],
      payload: input.payload,
      metadata: {
        repository: input.metadata?.repository ?? input.repository?.id,
        workspace: input.metadata?.workspace ?? input.repository?.workspace,
        session: input.metadata?.session,
        user: input.metadata?.user ?? input.actor?.id,
        traceId,
        schemaVersion,
        platformVersion: input.metadata?.platformVersion ?? this.platformVersion,
        eventVersion,
        payloadClassification: input.metadata?.payloadClassification ?? 'internal',
        attributes: input.metadata?.attributes ?? {}
      },
      schemaVersion
    });
  }

  private recordPublishedEvent(event: CanonicalEvent): void {
    this.eventHistory.push(event);
    while (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }

    this.metrics = {
      ...this.metrics,
      publishedCount: this.metrics.publishedCount + 1,
      latestPublishedAt: event.timestamp
    };
  }

  private deliverLegacyEvent(eventType: string, args: unknown[], event: CanonicalEvent): void {
    const subscriptions = this.legacySubscriptions.get(eventType) ?? [];
    for (const subscription of subscriptions) {
      const startedAt = this.clock();
      try {
        const result = subscription.handler(...args);
        if (isPromiseLike(result)) {
          result
            .then(() => this.recordSuccess(event, subscription.id, startedAt, 0))
            .catch(error => this.recordFailure(event, subscription.id, startedAt, error));
          continue;
        }
        this.recordSuccess(event, subscription.id, startedAt, 0);
      } catch (error) {
        this.recordFailure(event, subscription.id, startedAt, error);
      }
    }
  }

  private async deliverCanonicalEvent(event: CanonicalEvent): Promise<void> {
    const subscriptions = Array.from(this.canonicalSubscriptions.values())
      .filter(subscription => this.matchesFilter(event, subscription.filter));

    for (const subscription of subscriptions) {
      await this.deliverToCanonicalSubscription(event, subscription);
    }
  }

  private async deliverToCanonicalSubscription(
    event: CanonicalEvent,
    subscription: CanonicalSubscription
  ): Promise<void> {
    let attempts = 0;
    const startedAt = this.clock();
    while (attempts <= this.retryLimit) {
      try {
        await subscription.handler(event);
        this.recordSuccess(event, subscription.id, startedAt, attempts);
        return;
      } catch (error) {
        attempts += 1;
        if (attempts > this.retryLimit) {
          this.recordFailure(event, subscription.id, startedAt, error, attempts);
        }
      }
    }
  }

  private recordSuccess(
    event: CanonicalEvent,
    subscriber: string,
    startedAt: Date,
    retryCount: number
  ): void {
    const deliveredAt = this.clock();
    const durationMs = Math.max(0, deliveredAt.getTime() - startedAt.getTime());
    this.deliveryRecords.push({
      eventId: event.eventId,
      eventType: event.eventType,
      subscriber,
      publishedAt: event.timestamp,
      deliveredAt: deliveredAt.toISOString(),
      durationMs,
      retryCount,
      status: 'acknowledged',
      correlationId: event.correlationId,
      traceId: event.metadata.traceId
    });
    this.metrics.deliveredCount += 1;
    this.metrics.totalDeliveryDurationMs += durationMs;
  }

  private recordFailure(
    event: CanonicalEvent,
    subscriber: string,
    startedAt: Date,
    error: unknown,
    attempts = 1
  ): void {
    const deliveredAt = this.clock();
    const durationMs = Math.max(0, deliveredAt.getTime() - startedAt.getTime());
    const reason = error instanceof Error ? error.message : String(error);

    this.deliveryRecords.push({
      eventId: event.eventId,
      eventType: event.eventType,
      subscriber,
      publishedAt: event.timestamp,
      deliveredAt: deliveredAt.toISOString(),
      durationMs,
      retryCount: Math.max(0, attempts - 1),
      status: 'failed',
      failureReason: reason,
      correlationId: event.correlationId,
      traceId: event.metadata.traceId
    });
    this.deadLetters.push({
      event,
      subscriber,
      failedAt: deliveredAt.toISOString(),
      attempts,
      reason
    });
    while (this.deadLetters.length > this.deadLetterLimit) {
      this.deadLetters.shift();
    }
    this.metrics.failedDeliveryCount += 1;
    this.metrics.deadLetterCount = this.deadLetters.length;
    this.metrics.totalDeliveryDurationMs += durationMs;
  }

  private matchesFilter(event: CanonicalEvent, filter: EventSubscriptionFilter): boolean {
    if (filter.eventType && event.eventType !== filter.eventType) return false;
    if (filter.platform && event.platform !== filter.platform) return false;
    if (filter.correlationId && event.correlationId !== filter.correlationId) return false;
    if (filter.predicate && !filter.predicate(event)) return false;
    return true;
  }

  private removeLegacySubscription(subscription: LegacySubscription): void {
    const subscriptions = this.legacySubscriptions.get(subscription.eventType) ?? [];
    const remaining = subscriptions.filter(item => item.id !== subscription.id);
    if (remaining.length === 0) {
      this.legacySubscriptions.delete(subscription.eventType);
      return;
    }
    this.legacySubscriptions.set(subscription.eventType, remaining);
  }

  private assertCanonicalMetadata(event: CanonicalEvent): void {
    const missing: string[] = [];
    if (!event.eventId) missing.push('eventId');
    if (!event.eventType) missing.push('eventType');
    if (!event.eventVersion) missing.push('eventVersion');
    if (!event.platform) missing.push('platform');
    if (!event.source) missing.push('source');
    if (!event.timestamp) missing.push('timestamp');
    if (!event.correlationId) missing.push('correlationId');
    if (!event.metadata?.traceId) missing.push('metadata.traceId');
    if (!event.metadata?.schemaVersion) missing.push('metadata.schemaVersion');
    if (!event.metadata?.platformVersion) missing.push('metadata.platformVersion');
    if (!event.schemaVersion) missing.push('schemaVersion');

    if (missing.length > 0) {
      throw new Error(`Invalid canonical event. Missing: ${missing.join(', ')}`);
    }
  }

  private isCanonicalEvent<TPayload extends Record<string, unknown>>(
    input: PublishEventInput<TPayload> | CanonicalEvent<TPayload>
  ): input is CanonicalEvent<TPayload> {
    return 'eventId' in input && 'timestamp' in input && 'metadata' in input;
  }

  private nextSubscriptionId(prefix: string): string {
    this.subscriptionSequence += 1;
    return `${prefix}-${this.subscriptionSequence}`;
  }
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && 'catch' in value;
}

function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}
