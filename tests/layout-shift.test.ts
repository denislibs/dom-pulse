import { describe, it, expect, afterEach, vi } from 'vitest';
import { intersects, matchShift, watchLayoutShifts } from '../src/cost/layout-shift';
import { Store } from '../src/store';
import { makeEvent } from './helpers';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

describe('intersects', () => {
  it('detects overlap and non-overlap', () => {
    expect(intersects(R(0, 0, 10, 10), R(5, 5, 10, 10))).toBe(true);
    expect(intersects(R(0, 0, 10, 10), R(10, 0, 10, 10))).toBe(false);
  });
});

describe('matchShift', () => {
  const a = document.createElement('div'), b = document.createElement('p'), inner = document.createElement('i');
  document.body.append(a, b); b.appendChild(inner);
  const rects = new Map<Element, ReturnType<typeof R>>([[a, R(0, 0, 100, 20)], [b, R(0, 500, 100, 20)]]);
  const rectOf = (el: Element) => rects.get(el) ?? R(0, 0, 0, 0);

  it('prefers the most recent event whose rect intersects a shifted rect', () => {
    const evA = makeEvent(a, { time: 10 }), evB = makeEvent(b, { time: 20 });
    const entry = { value: 0.1, startTime: 30, sources: [{ node: null, previousRect: R(0, 30, 100, 50), currentRect: R(0, 10, 100, 50) }] };
    expect(matchShift(entry, [evA, evB], rectOf)).toEqual({ event: evA, rects: [R(0, 10, 100, 50)] });
  });
  it('matches by containment of the shifted node', () => {
    const evB = makeEvent(b, { time: 20 });
    const entry = { value: 0.1, startTime: 30, sources: [{ node: inner, previousRect: R(900, 900, 1, 1), currentRect: R(900, 901, 1, 1) }] };
    expect(matchShift(entry, [evB], rectOf)?.event).toBe(evB);
  });
  it('returns null when nothing matches or target is detached', () => {
    const d = document.createElement('div');
    const entry = { value: 0.1, startTime: 30, sources: [{ node: null, previousRect: R(0, 0, 1, 1), currentRect: R(0, 0, 1, 1) }] };
    expect(matchShift(entry, [makeEvent(d)], rectOf)).toBeNull();
    expect(matchShift(entry, [], rectOf)).toBeNull();
  });
});

/**
 * Stub PerformanceObserver so the observer callback passed to `new PerformanceObserver(cb)`
 * can be driven directly, without relying on jsdom (which doesn't support the
 * `layout-shift` entry type at all).
 */
class FakePerformanceObserver {
  static supportedEntryTypes = ['layout-shift'];
  static instances: FakePerformanceObserver[] = [];
  cb: (list: { getEntries(): any[] }) => void;
  disconnected = false;
  observeCalls = 0;
  constructor(cb: (list: { getEntries(): any[] }) => void) {
    this.cb = cb;
    FakePerformanceObserver.instances.push(this);
  }
  observe() { this.observeCalls++; }
  disconnect() { this.disconnected = true; }
}

const list = (entries: any[]) => ({ getEntries: () => entries });
const R2 = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

describe('watchLayoutShifts', () => {
  const originalPO = (globalThis as any).PerformanceObserver;

  afterEach(() => {
    (globalThis as any).PerformanceObserver = originalPO;
  });

  function install(): typeof FakePerformanceObserver {
    FakePerformanceObserver.instances = [];
    (globalThis as any).PerformanceObserver = FakePerformanceObserver;
    return FakePerformanceObserver;
  }

  it('records a matched shift through store.addShift with the shifted rects', () => {
    const FO = install();
    const store = new Store(50, 20);
    const el = document.createElement('div');
    document.body.appendChild(el);
    store.push(makeEvent(el, { time: 100 }));

    const unsub = watchLayoutShifts(store, 100);
    const obs = FO.instances[0];
    const currentRect = R2(1, 2, 3, 4);
    const previousRect = R2(5, 6, 7, 8);
    obs.cb(list([{ startTime: 120, value: 0.2, sources: [{ node: el, previousRect, currentRect }] }]));

    const ev = store.events()[0];
    expect(ev.layoutShift).toBeCloseTo(0.2);
    expect(ev.shiftRects).toEqual([currentRect]);
    expect(store.totalShift).toBeCloseTo(0.2);
    unsub();
  });

  it('adds an unmatched shift straight to store.totalShift', () => {
    const FO = install();
    const store = new Store(50, 20);
    watchLayoutShifts(store, 100);
    const obs = FO.instances[0];

    obs.cb(list([{ startTime: 50, value: 0.15, sources: [] }]));

    expect(store.totalShift).toBeCloseTo(0.15);
  });

  it('excludes a candidate event older than windowMs before startTime', () => {
    const FO = install();
    const store = new Store(50, 20);
    const el = document.createElement('div');
    document.body.appendChild(el);
    // windowMs=100, startTime=101 -> cutoff is time >= 1; this event is at time 0, just outside.
    store.push(makeEvent(el, { time: 0 }));

    watchLayoutShifts(store, 100);
    const obs = FO.instances[0];
    obs.cb(list([{ startTime: 101, value: 0.1, sources: [{ node: el, previousRect: R2(0, 0, 1, 1), currentRect: R2(0, 0, 1, 1) }] }]));

    expect(store.events()[0].layoutShift).toBe(0);
    expect(store.totalShift).toBeCloseTo(0.1);
  });

  it('includes a candidate event timestamped slightly after startTime, inside the forward slack', () => {
    const FO = install();
    const store = new Store(50, 20);
    const el = document.createElement('div');
    document.body.appendChild(el);
    // startTime=100, forward slack is 50ms -> an event 40ms after startTime is still eligible.
    store.push(makeEvent(el, { time: 140 }));

    watchLayoutShifts(store, 100);
    const obs = FO.instances[0];
    obs.cb(list([{ startTime: 100, value: 0.1, sources: [{ node: el, previousRect: R2(0, 0, 1, 1), currentRect: R2(0, 0, 1, 1) }] }]));

    expect(store.events()[0].layoutShift).toBeCloseTo(0.1);
    expect(store.totalShift).toBeCloseTo(0.1);
  });

  it('does not let a throw while processing an entry escape the observer callback', () => {
    const FO = install();
    const store = new Store(50, 20);
    watchLayoutShifts(store, 100);
    const obs = FO.instances[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Missing previousRect/currentRect makes toRect() throw while building sources.
    expect(() => obs.cb(list([{ startTime: 100, value: 0.1, sources: [{ node: null }] }]))).not.toThrow();

    warnSpy.mockRestore();
  });

  it('disconnects the observer via the returned function', () => {
    const FO = install();
    const store = new Store(50, 20);
    const unsub = watchLayoutShifts(store, 100);
    const obs = FO.instances[0];

    expect(obs.disconnected).toBe(false);
    unsub();
    expect(obs.disconnected).toBe(true);
  });
});

describe('watchLayoutShifts unsupported environment', () => {
  const originalPO = (globalThis as any).PerformanceObserver;

  afterEach(() => {
    (globalThis as any).PerformanceObserver = originalPO;
  });

  it('returns a callable no-op and touches nothing when PerformanceObserver is absent', () => {
    delete (globalThis as any).PerformanceObserver;
    const store = new Store(50, 20);

    const unsub = watchLayoutShifts(store);

    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(store.totalShift).toBe(0);
    expect(store.events()).toEqual([]);
  });

  it('returns a callable no-op and never constructs an observer when layout-shift is unsupported', () => {
    class NoShiftObserver {
      static supportedEntryTypes = ['largest-contentful-paint'];
      static instances = 0;
      constructor(_cb: (list: { getEntries(): any[] }) => void) { NoShiftObserver.instances++; }
      observe() {}
      disconnect() {}
    }
    (globalThis as any).PerformanceObserver = NoShiftObserver;
    const store = new Store(50, 20);

    const unsub = watchLayoutShifts(store);

    expect(typeof unsub).toBe('function');
    expect(NoShiftObserver.instances).toBe(0);
  });
});
