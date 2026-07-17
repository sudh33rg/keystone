import express from 'express';
import cors from 'cors';
import { checkoutRoutes } from './routes/checkout';
import { NotificationConsumer } from './events/NotificationConsumer';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Event bus for async notifications
const eventBus = new NotificationConsumer();

app.use('/api/checkout', checkoutRoutes(eventBus));

app.listen(PORT, () => {
  console.log(`Checkout server running on port ${PORT}`);
});

export { app };
