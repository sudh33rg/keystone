import request from 'supertest';
import app from '../../src/index';

describe('POST /api/orders', () => {
  it('should create an order with valid payload', async () => {
    const payload = {
      customerId: 'cust-123',
      items: [
        { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
      ],
    };

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer test-token')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe('cust-123');
    expect(res.body.total).toBe(20);
  });

  it('should reject requests without auth header', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 'cust-1', items: [] });

    expect(res.status).toBe(401);
  });
});
