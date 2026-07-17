import { Order } from '../interfaces/order.interface';
import { OrderRepository } from '../repositories/OrderRepository';

export class OrderService {
  private readonly repository: OrderRepository;

  constructor(repository?: OrderRepository) {
    this.repository = repository || new OrderRepository();
  }

  async create(customerId: string, items: { productId: string; name: string; quantity: number; unitPrice: number }[]): Promise<Order> {
    const order = {
      id: crypto.randomUUID(),
      customerId,
      items: items.map((item) => ({ ...item })),
      total: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      status: 'pending' as const,
      createdAt: new Date(),
    };
    return this.repository.save(order);
  }

  async findById(id: string): Promise<Order | null> {
    return this.repository.findById(id);
  }
}
