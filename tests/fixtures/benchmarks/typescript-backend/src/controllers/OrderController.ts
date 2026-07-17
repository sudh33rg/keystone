import { Request, Response } from 'express';
import { OrderService } from '../services/OrderService';

export class OrderController {
  private readonly service: OrderService;

  constructor(service?: OrderService) {
    this.service = service || new OrderService();
  }

  async create(req: Request, res: Response): Promise<void> {
    const { customerId, items } = req.body;

    if (!customerId || !items) {
      res.status(400).json({ error: 'customerId and items are required' });
      return;
    }

    const order = await this.service.create(customerId, items);
    res.status(201).json(order);
  }
}
