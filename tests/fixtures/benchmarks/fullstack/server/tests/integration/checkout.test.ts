import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutController } from '../../src/controllers/CheckoutController';
import { CheckoutService } from '../../src/services/CheckoutService';
import { OrderRepository } from '../../src/repositories/OrderRepository';
import { StripePaymentGateway } from '../../src/services/PaymentGateway';
import { NotificationConsumer } from '../../src/events/NotificationConsumer';
import { OrderStatus } from '../../src/models/Order.entity';

const mockPayload = {
  items: [
    { productId: '1', name: 'Widget', price: 29.99, quantity: 2 },
  ],
  shippingAddress: {
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    country: 'US',
  },
  paymentMethodId: 'pm_test',
};

let mockRepository: OrderRepository;
let mockGateway: StripePaymentGateway;
let mockConsumer: NotificationConsumer;
let controller: CheckoutController;

describe('CheckoutController', () => {
  beforeEach(() => {
    mockRepository = new OrderRepository();
    mockGateway = new StripePaymentGateway();
    mockConsumer = new NotificationConsumer();
    const service = new CheckoutService(mockRepository, mockGateway, mockConsumer);
    controller = new CheckoutController(service);
  });

  it('creates an order on valid checkout', async () => {
    const req = { body: mockPayload } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await controller.createCheckout(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const result = res.json.mock.calls[0][0];
    expect(result.status).toBe(OrderStatus.CONFIRMED);
    expect(result.total).toBe(59.98);
    expect(result.orderId).toMatch(/^ord_/);
  });

  it('returns 400 on payment failure', async () => {
    vi.spyOn(mockGateway, 'charge').mockResolvedValue({
      success: false,
      transactionId: '',
      error: 'Insufficient funds',
    });

    const req = { body: mockPayload } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await controller.createCheckout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const result = res.json.mock.calls[0][0];
    expect(result.message).toBe('Insufficient funds');
  });

  it('saves order to repository', async () => {
    const saveSpy = vi.spyOn(mockRepository, 'save');

    const req = { body: mockPayload } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await controller.createCheckout(req, res);

    expect(saveSpy).toHaveBeenCalled();
    const savedOrder = saveSpy.mock.calls[0][0];
    expect(savedOrder.id).toMatch(/^ord_/);
    expect(savedOrder.items).toHaveLength(1);
  });
});
