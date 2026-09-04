import { Store } from '../store';
import { originals } from './reflow';
import { warnOnce } from '../warn';
import type { PulseEvent, Rect } from '../types';

export interface ShiftSource { node: Node | null; previousRect: Rect; currentRect: Rect }
export interface ShiftEntry { value: number; startTime: number; sources: ShiftSource[] }

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Attributes a layout-shift entry to the most recent PulseEvent whose target either
 * contains one of the shift's moved nodes, or whose current bounding box overlaps one
 * of the shift's rectangles. Walks candidates newest-to-oldest so the freshest mutation
 * wins. Entries with `hadRecentInput` are intentionally not filtered out upstream: for
 * debugging, a shift right after a click is the interesting one.
 */
export function matchShift(
  entry: ShiftEntry,
  candidates: PulseEvent[],
  rectOf: (el: Element) => Rect,
): { event: PulseEvent; rects: Rect[] } | null {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const ev = candidates[i];
    if (!ev.target.isConnected) continue;
    const r = rectOf(ev.target);
    const rects = entry.sources
      .filter(s => (s.node !== null && (s.node === ev.target || ev.target.contains(s.node))) || intersects(r, s.currentRect) || intersects(r, s.previousRect))
      .map(s => s.currentRect);
    if (rects.length) return { event: ev, rects };
  }
  return null;
}

const toRect = (r: { x: number; y: number; width: number; height: number }): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/**
 * Observes `layout-shift` performance entries and attributes each one to a recent
 * PulseEvent, recording the shift against that element via `store.addShift`. A shift
 * that cannot be attributed still counts toward `store.totalShift`. Measures element
 * boxes through the unpatched `originals.getBoundingClientRect` so DOM Pulse's own
 * reads are never recorded as page reflows. Degrades to a no-op when the environment
 * does not support the `layout-shift` entry type, and never throws into page code.
 */
export function watchLayoutShifts(store: Store, windowMs = 100): () => void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) return () => {};
  const rectOf = (el: Element) => toRect(originals.getBoundingClientRect.call(el));
  const po = new PerformanceObserver(list => {
    try {
      for (const raw of list.getEntries() as any[]) {
        const candidates = store.events().filter(ev => ev.time >= raw.startTime - windowMs && ev.time <= raw.startTime + 50);
        const sources: ShiftSource[] = (raw.sources ?? []).map((s: any) => ({ node: s.node ?? null, previousRect: toRect(s.previousRect), currentRect: toRect(s.currentRect) }));
        const m = matchShift({ value: raw.value, startTime: raw.startTime, sources }, candidates, rectOf);
        if (m) store.addShift(m.event, raw.value, m.rects, performance.now());
        else store.totalShift += raw.value;
      }
    } catch (e) { warnOnce('layout-shift', e); }
  });
  try { po.observe({ type: 'layout-shift', buffered: false }); } catch (e) { warnOnce('layout-shift-observe', e); return () => {}; }
  return () => po.disconnect();
}
