import { orderTotal } from '../src/orders';

if (orderTotal([2, 3]) !== 5) throw new Error('order total regression');
