import { RingBuffer } from './ring-buffer';
import { SlidingCounter } from './sliding-counter';
import { describeNode } from './describe';
import type { PulseEvent, ElementStats, SourceStats, ReflowHit, Rect, SortKey } from './types';

export const HOT_WINDOW_MS = 5000;
export const HISTORY_LEN = 30;
const PRUNE_AFTER_MS = 60_000;

export class Store {
  private buffer: RingBuffer<PulseEvent>;
  private byElement = new WeakMap<Element, ElementStats>();
  private elementList: ElementStats[] = [];
  private bySource = new Map<string, SourceStats>();
  private mutationRate = new SlidingCounter(1000);
  private reflowRate = new SlidingCounter(1000);
  private listeners = new Set<() => void>();
  private sinceTick = 0;

  history: number[] = new Array(HISTORY_LEN).fill(0);
  totalShift = 0;
  paused = false;

  constructor(readonly bufferSize: number, public hotThreshold: number) {
    this.buffer = new RingBuffer(bufferSize);
  }

  push(ev: PulseEvent): void {
    if (this.paused) return;
    this.buffer.push(ev);
    this.mutationRate.add(ev.time);
    this.sinceTick++;
    const s = this.stats(ev.target);
    s.total++;
    s.lastKind = ev.kind;
    s.lastTime = ev.time;
    s.nodesAffected += ev.nodesAffected;
    s.recent.add(ev.time);
    if (ev.source) {
      s.sources.set(ev.source, (s.sources.get(ev.source) ?? 0) + 1);
      this.source(ev.source).mutations++;
    }
    for (const hit of ev.reflows) this.countReflow(s, ev.time + hit.delay, ev.source);
    this.emit();
  }

  addReflow(ev: PulseEvent, hit: ReflowHit): void {
    ev.reflows.push(hit);
    this.countReflow(this.stats(ev.target), ev.time + hit.delay, ev.source);
    this.emit();
  }

  /**
   * A forced layout read charged straight to the element whose layout was read, for the
   * read-before-write case: in a thrash loop the read happens before anything writes that
   * element, so there is no write record and no event to carry the hit. It feeds exactly
   * the aggregates a mutation-carried hit feeds -- the element's reflow count and last
   * reflow time, the reflow rate, the source's reflow count -- so an element can carry
   * reflows with zero mutations. The blame goes to the reading code (`hit.source`), which
   * is the only call site involved; an event-carried hit has a mutation source to use.
   */
  addElementReflow(el: Element, hit: ReflowHit, time: number): void {
    if (this.paused) return;
    this.countReflow(this.stats(el), time, hit.source);
    this.emit();
  }

  addShift(ev: PulseEvent, value: number, rects: Rect[], now: number): void {
    ev.layoutShift += value;
    ev.shiftRects.push(...rects);
    const s = this.stats(ev.target);
    s.layoutShift += value;
    s.lastShiftTime = now;
    s.shiftRects = rects;
    this.totalShift += value;
    this.emit();
  }

  /** The one place a forced reflow updates the aggregates, whatever carried it here. */
  private countReflow(s: ElementStats, time: number, source: string | null): void {
    s.reflows++;
    s.lastReflowTime = time;
    this.reflowRate.add(time);
    if (source) this.source(source).reflows++;
  }

  stats(el: Element): ElementStats {
    let s = this.byElement.get(el);
    if (!s) {
      s = {
        element: el, label: describeNode(el), total: 0, reflows: 0, layoutShift: 0, nodesAffected: 0,
        lastKind: 'childList', lastTime: 0, lastReflowTime: -Infinity, lastShiftTime: -Infinity, shiftRects: [],
        sources: new Map(), recent: new SlidingCounter(HOT_WINDOW_MS),
      };
      this.byElement.set(el, s);
      this.elementList.push(s);
    }
    return s;
  }

  private source(key: string): SourceStats {
    let s = this.bySource.get(key);
    if (!s) { s = { key, mutations: 0, reflows: 0 }; this.bySource.set(key, s); }
    return s;
  }

  events(): PulseEvent[] { return this.buffer.toArray(); }
  eventsFor(el: Element): PulseEvent[] { return this.events().filter(e => e.target === el); }
  elements(): ElementStats[] { return this.elementList; }
  active(now: number, ttl = 1500): ElementStats[] { return this.elementList.filter(s => now - s.lastTime <= ttl); }
  isHot(s: ElementStats, now: number): boolean { return s.recent.count(now) >= this.hotThreshold; }

  topElements(n: number, key: SortKey, now: number, filter?: (s: ElementStats) => boolean): ElementStats[] {
    const val = (s: ElementStats) => key === 'rate' ? s.recent.count(now) : s[key];
    const list = filter ? this.elementList.filter(filter) : this.elementList;
    return list.slice().sort((a, b) => val(b) - val(a) || b.lastTime - a.lastTime).slice(0, n);
  }

  topSources(n: number): SourceStats[] {
    return [...this.bySource.values()].sort((a, b) => b.mutations - a.mutations).slice(0, n);
  }

  rates(now: number): { mutations: number; reflows: number } {
    return { mutations: this.mutationRate.count(now), reflows: this.reflowRate.count(now) };
  }

  tick(now: number): void {
    this.history.push(this.sinceTick);
    if (this.history.length > HISTORY_LEN) this.history.shift();
    this.sinceTick = 0;
    const keep: ElementStats[] = [];
    for (const s of this.elementList) {
      // Reads keep an element alive as much as writes do: an element that is only ever
      // measured (never mutated) has lastTime 0 and would otherwise be pruned on the first
      // tick after the page passes PRUNE_AFTER_MS, taking its reflow count with it.
      const last = Math.max(s.lastTime, s.lastReflowTime);
      if (s.element.isConnected && now - last < PRUNE_AFTER_MS) keep.push(s);
      else this.byElement.delete(s.element);
    }
    this.elementList = keep;
    this.emit();
  }

  reset(): void {
    this.buffer.clear();
    this.byElement = new WeakMap();
    this.elementList = [];
    this.bySource.clear();
    this.mutationRate.clear();
    this.reflowRate.clear();
    this.history = new Array(HISTORY_LEN).fill(0);
    this.sinceTick = 0;
    this.totalShift = 0;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void { for (const l of this.listeners) l(); }
}
