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
    for (const hit of ev.reflows) this.applyReflow(ev, s, hit);
    this.emit();
  }

  addReflow(ev: PulseEvent, hit: ReflowHit): void {
    ev.reflows.push(hit);
    this.applyReflow(ev, this.stats(ev.target), hit);
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

  private applyReflow(ev: PulseEvent, s: ElementStats, hit: ReflowHit): void {
    s.reflows++;
    s.lastReflowTime = ev.time + hit.delay;
    this.reflowRate.add(s.lastReflowTime);
    if (ev.source) this.source(ev.source).reflows++;
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
      if (s.element.isConnected && now - s.lastTime < PRUNE_AFTER_MS) keep.push(s);
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
