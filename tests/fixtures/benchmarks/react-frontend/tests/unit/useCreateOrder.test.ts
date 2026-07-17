import { renderHook, waitFor } from "@testing-library/react";
import { useCreateOrder } from "../../src/hooks/useCreateOrder";

global.fetch = vi.fn();

test("sets loading during request", async () => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ id: 1 }),
  });

  const { result } = renderHook(() => useCreateOrder());
  expect(result.current.loading).toBe(false);

  const p = result.current.execute(["a"]);
  expect(result.current.loading).toBe(true);

  await p;
  await waitFor(() => expect(result.current.loading).toBe(false));
});

test("calls orderApi.create with items", async () => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ id: 1 }),
  });

  const { result } = renderHook(() => useCreateOrder());
  await result.current.execute(["item-1", "item-2"]);

  expect(global.fetch).toHaveBeenCalledWith("/orders", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ items: ["item-1", "item-2"] }),
  }));
});
