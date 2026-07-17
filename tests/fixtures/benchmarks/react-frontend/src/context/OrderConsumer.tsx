import { useOrderContext } from "./OrderContext";

export function OrderConsumer({ items }: { items: string[] }) {
  const { createOrder } = useOrderContext();

  return (
    <button onClick={() => createOrder(items)}>
      Place order
    </button>
  );
}
