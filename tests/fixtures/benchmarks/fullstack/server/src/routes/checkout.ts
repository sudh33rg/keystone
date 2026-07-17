import { Router, Request, Response } from 'express';
import { CheckoutController } from '../controllers/CheckoutController';
import { CheckoutService } from '../services/CheckoutService';
import { OrderRepository } from '../repositories/OrderRepository';
import { StripePaymentGateway } from '../services/PaymentGateway';
import { NotificationConsumer } from '../events/NotificationConsumer';

export function checkoutRoutes(eventBus: NotificationConsumer): Router {
  const router = Router();
  const repository = new OrderRepository();
  const paymentGateway = new StripePaymentGateway();
  const service = new CheckoutService(repository, paymentGateway, eventBus);
  const controller = new CheckoutController(service);

  router.post('/', (req: Request, res: Response) => {
    return controller.createCheckout(req, res);
  });

  return router;
}
