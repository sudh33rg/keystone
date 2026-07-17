import { EventBus } from './EventBus';
import { Order } from '../models/Order.entity';

export class NotificationConsumer {
  private eventBus: EventBus;

  constructor() {
    this.eventBus = new EventBus();
    this.setupListeners();
  }

  subscribe(event: string, callback: (data: unknown) => void): void {
    this.eventBus.on(event, callback);
  }

  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }

  private setupListeners(): void {
    this.eventBus.on('order-created', (data: Order) => {
      this.sendConfirmationEmail(data);
    });
  }

  private sendConfirmationEmail(order: Order): void {
    console.log(
      `[NotificationConsumer] Sending confirmation for order ${order.id} to ${order.shippingAddress.street}`
    );
  }
}
