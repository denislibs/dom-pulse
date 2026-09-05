let depth = 0;
export function isInternal(): boolean { return depth > 0; }
export function withInternal<T>(fn: () => T): T {
  depth++;
  try { return fn(); } finally { depth--; }
}
