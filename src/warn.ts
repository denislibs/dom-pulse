const seen = new Set<string>();
export function warnOnce(key: string, err: unknown): void {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[dom-pulse] ${key}:`, err);
}
export function resetWarnings(): void { seen.clear(); }

/**
 * Wraps a long-lived callback (interval ticks, page-facing handlers) so a throw is
 * reported once under `key` instead of escaping into the page -- an interval firing
 * four times a second would otherwise raise an uncaught error four times a second,
 * forever.
 */
export function guarded<A extends unknown[]>(key: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try { fn(...args); } catch (e) { warnOnce(key, e); }
  };
}
