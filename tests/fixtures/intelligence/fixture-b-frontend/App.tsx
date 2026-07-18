import { useState } from 'react';
import { OrderContextProvider } from './context/OrderContext.js';
import { OrderList } from './components/OrderList.js';
import { CustomerList } from './components/CustomerList.js';

export function App() {
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  return (
    <OrderContextProvider selectedOrder={selectedOrder} onSelectOrder={setSelectedOrder}>
      <main>
        <h1>Keystone Orders</h1>
        <OrderList />
        <CustomerList />
      </main>
    </OrderContextProvider>
  );
}
