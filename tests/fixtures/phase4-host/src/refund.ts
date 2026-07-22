export function canRefund(status: string): boolean {
  return status === "settled";
}
