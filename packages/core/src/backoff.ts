export function backoffMs(attempt: number, baseMs: number, capMs: number): number {
  if (attempt < 1) return baseMs;
  return Math.min(baseMs * 2 ** (attempt - 1), capMs);
}
