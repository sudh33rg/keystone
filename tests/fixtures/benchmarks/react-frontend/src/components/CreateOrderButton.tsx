import { useCreateOrder } from "../hooks/useCreateOrder";

export function CreateOrderButton({ items }: { items: string[] }) {
  const { loading, execute } = useCreateOrder();

  return (
    <button onClick={() => execute(items)} disabled={loading}>
      {loading ? "Creating..." : "Create Order"}
    </button>
  );
}
