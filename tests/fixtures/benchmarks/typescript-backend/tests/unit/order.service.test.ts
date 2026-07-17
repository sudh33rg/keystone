import { OrderService } from '../../src/services/OrderService';
import { OrderRepository } from '../../src/repositories/OrderRepository';

describe('OrderService', () => {
  it('should create an order with correct total', async () => {
    const mockRepo = new OrderRepository();
    const service = new OrderService(mockRepo);

    const items = [
      { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
      { productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 25 },
    ];

    const order = await service.create('cust-1', items);

    expect(order.customerId).toBe('cust-1');
    expect(order.total).toBe(45);
    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(2);
  });
});
