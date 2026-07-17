import { Routes, Route } from "react-router-dom";
import { OrdersPage } from "./pages/OrdersPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/orders" element={<OrdersPage />} />
    </Routes>
  );
}
