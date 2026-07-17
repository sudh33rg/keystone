type EventCallback = (data: unknown) => void;

export class EventBus {
  private handlers: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...existing, callback]);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.forEach((cb) => cb(data));
  }
}
