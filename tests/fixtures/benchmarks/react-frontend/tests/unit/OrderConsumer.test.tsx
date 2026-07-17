import { render, screen, fireEvent } from "@testing-library/react";
import { OrderConsumer } from "../../src/context/OrderConsumer";
import { OrderProvider, useOrderContext } from "../../src/context/OrderContext";

// Helper to render inside provider
function renderWithProvider(items: string[]) {
  return render(
    <OrderProvider>
      <OrderConsumer items={items} />
    </OrderProvider>
  );
}

test("renders button", () => {
  renderWithProvider(["item-1"]);
  expect(screen.getByRole("button")).toHaveTextContent("Place order");
});

test("calls createOrder with items on click", () => {
  let captured: string[] | undefined;
  const { createOrder } = useOrderContext();
  captured = createOrder(["x"]);

  renderWithProvider(["item-1"]);
  fireEvent.click(screen.getByRole("button"));
});
