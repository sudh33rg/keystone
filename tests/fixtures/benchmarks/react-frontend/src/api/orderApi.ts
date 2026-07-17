export async function create(data: { items: string[] }) {
  const res = await fetch("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`orderApi.create failed: ${res.status}`);
  return res.json();
}
