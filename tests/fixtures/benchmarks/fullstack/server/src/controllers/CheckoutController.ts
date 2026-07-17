import { Request, Response } from 'express';
import { CheckoutService } from '../services/CheckoutService';
import { CheckoutPayload } from '../../ui/src/api/checkoutApi';

export class CheckoutController {
  private service: CheckoutService;

  constructor(service: CheckoutService) {
    this.service = service;
  }

  async createCheckout(req: Request, res: Response): Promise<void> {
    try {
      const payload: CheckoutPayload = req.body;

      const result = await this.service.process(payload);

      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ message });
    }
  }
}
