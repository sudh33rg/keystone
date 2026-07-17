import { createContext, useContext, useCallback } from "react";
import { create } from "../api/orderApi";

interface OrderContextValue {
  createOrder: (items: string[]) => Promise<unknown>;
}

const OrderContext = createContext<OrderContextValue | null>(null);

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const createOrder = useCallback(
    (items: string[]) => create({ items }),
    []
  );

  return <OrderContext.Provider value={{ createOrder }}>{children}</OrderContext.Provider>;
}

export function useOrderContext() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrderContext must be inside OrderProvider");
  return ctx;
}
