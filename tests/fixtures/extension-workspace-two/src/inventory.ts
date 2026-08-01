export function reserveInventory(available: number, requested: number): number {
  if (requested < 1 || requested > available) throw new Error('Inventory unavailable');
  return available - requested;
}
