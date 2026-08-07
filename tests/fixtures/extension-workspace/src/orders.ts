export interface Order {
  id: string;
  total: number;
}

export function validateOrder(order: Order): boolean {
  if (!order.id) return false;
  return order.total > 0;
}

export function saveOrder(order: Order): Order {
  if (!validateOrder(order)) throw new Error("Invalid order");
  return order;
}
