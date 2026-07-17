import { Order } from '../interfaces/order.interface';

export class OrderEntity implements Order {
  constructor(
    public id: string,
    public customerId: string,
    public items: OrderItem[],
    public total: number,
    public status: Order['status'] = 'pending',
    public createdAt: Date = new Date(),
  ) {}

  static fromCreatePayload(
    customerId: string,
    items: OrderItem[],
  ): OrderEntity {
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return new OrderEntity(crypto.randomUUID(), customerId, items, total);
  }
}
