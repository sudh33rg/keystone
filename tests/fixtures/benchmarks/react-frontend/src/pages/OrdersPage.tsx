import { CreateOrderButton } from "../components/CreateOrderButton";

export function OrdersPage() {
  return (
    <div>
      <h1>Orders</h1>
      <CreateOrderButton items={["item-a", "item-b"]} />
    </div>
  );
}
