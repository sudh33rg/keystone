import { Order } from '../interfaces/order.interface';

export class OrderRepository {
  private readonly tableName = 'orders';

  async save(order: Order): Promise<Order> {
    // INSERT INTO orders (...) VALUES (...) RETURNING *
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    // SELECT * FROM orders WHERE id = $1
    return null;
  }

  async findByCustomerId(customerId: string): Promise<Order[]> {
    // SELECT * FROM orders WHERE customer_id = $1
    return [];
  }
}
