import { useState, useCallback } from "react";
import { create } from "../api/orderApi";

export function useCreateOrder() {
  const [loading, setLoading] = useState(false);

  const execute = useCallback(async (items: string[]) => {
    setLoading(true);
    try {
      return await create({ items });
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, execute };
}
