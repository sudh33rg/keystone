import { Order, OrderStatus } from '../models/Order.entity';
import { OrderRepository } from '../repositories/OrderRepository';
import { PaymentGateway } from './PaymentGateway';
import { NotificationConsumer } from '../events/NotificationConsumer';
import { CheckoutPayload } from '../../ui/src/api/checkoutApi';

export class CheckoutService {
  private repository: OrderRepository;
  private paymentGateway: PaymentGateway;
  private notificationConsumer: NotificationConsumer;

  constructor(
    repository: OrderRepository,
    paymentGateway: PaymentGateway,
    notificationConsumer: NotificationConsumer
  ) {
    this.repository = repository;
    this.paymentGateway = paymentGateway;
    this.notificationConsumer = notificationConsumer;
  }

  async process(payload: CheckoutPayload): Promise<{
    orderId: string;
    total: number;
    status: string;
    confirmationNumber: string;
  }> {
    const total = this.calculateTotal(payload);

    const paymentResult = await this.paymentGateway.charge(
      total,
      payload.paymentMethodId
    );

    if (!paymentResult.success) {
      throw new Error(paymentResult.error ?? 'Payment failed');
    }

    const order: Order = {
      id: `ord_${Date.now()}`,
      items: payload.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      total,
      status: OrderStatus.CONFIRMED,
      shippingAddress: payload.shippingAddress,
      confirmationNumber: `CN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      createdAt: new Date(),
    };

    await this.repository.save(order);
    this.notificationConsumer.emit('order-created', order);

    return {
      orderId: order.id,
      total: order.total,
      status: order.status,
      confirmationNumber: order.confirmationNumber,
    };
  }

  private calculateTotal(payload: CheckoutPayload): number {
    const subtotal = payload.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    return subtotal;
  }
}
