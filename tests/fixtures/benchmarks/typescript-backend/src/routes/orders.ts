import { Router } from 'express';
import { authentication } from '../middleware/authentication';
import { OrderController } from '../controllers/OrderController';

const router = Router();
const controller = new OrderController();

router.post('/orders', authentication, (req, res) => controller.create(req, res));

export default router;
