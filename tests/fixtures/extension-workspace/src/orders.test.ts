import { saveOrder, validateOrder } from "./orders";

describe("orders", () => {
  it("validates and saves an order", () => {
    const order = { id: "order-1", total: 10 };
    if (!validateOrder(order)) throw new Error("expected valid order");
    saveOrder(order);
  });
});
