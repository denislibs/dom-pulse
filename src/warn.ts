const seen = new Set<string>();
export function warnOnce(key: string, err: unknown): void {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[dom-pulse] ${key}:`, err);
}
export function resetWarnings(): void { seen.clear(); }
