import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./routes";
import { OrderProvider } from "./context/OrderContext";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <OrderProvider>
      <AppRoutes />
    </OrderProvider>
  </BrowserRouter>
);
