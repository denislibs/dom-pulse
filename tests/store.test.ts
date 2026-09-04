import { describe, it, expect } from 'vitest';
import { Store, HISTORY_LEN } from '../src/store';
import { makeEvent } from './helpers';

const el = (tag = 'div') => { const e = document.createElement(tag); document.body.appendChild(e); return e; };

describe('Store', () => {
  it('pushes events into the buffer and aggregates per element', () => {
    const s = new Store(3, 20);
    const a = el();
    s.push(makeEvent(a, { time: 10, nodesAffected: 2, source: 'a.js:1 f' }));
    s.push(makeEvent(a, { time: 20, kind: 'childList' }));
    const st = s.stats(a);
    expect(st.total).toBe(2);
    expect(st.nodesAffected).toBe(3);
    expect(st.lastKind).toBe('childList');
    expect(st.lastTime).toBe(20);
    expect(st.sources.get('a.js:1 f')).toBe(1);
    expect(s.eventsFor(a)).toHaveLength(2);
    expect(s.topSources(5)).toEqual([{ key: 'a.js:1 f', mutations: 1, reflows: 0 }]);
  });
  it('buffer is bounded', () => {
    const s = new Store(2, 20);
    const a = el();
    for (let i = 0; i < 5; i++) s.push(makeEvent(a));
    expect(s.events()).toHaveLength(2);
    expect(s.stats(a).total).toBe(5);
  });
  it('ignores pushes while paused', () => {
    const s = new Store(5, 20);
    s.paused = true;
    s.push(makeEvent(el()));
    expect(s.events()).toHaveLength(0);
  });
  it('rates count the last second and hot uses the 5 s window', () => {
    const s = new Store(100, 3);
    const a = el();
    s.push(makeEvent(a, { time: 100 })); s.push(makeEvent(a, { time: 900 })); s.push(makeEvent(a, { time: 1500 }));
    expect(s.rates(1500).mutations).toBe(2);
    expect(s.isHot(s.stats(a), 1500)).toBe(true);
    expect(s.isHot(s.stats(a), 6000)).toBe(false);
  });
  it('reflows and shifts update element, source and global stats', () => {
    const s = new Store(10, 20);
    const a = el();
    const ev = makeEvent(a, { time: 0, source: 'a.js:1 f' });
    s.push(ev);
    s.addReflow(ev, { api: 'offsetWidth', delay: 2, stack: [], source: null });
    s.addShift(ev, 0.25, [{ x: 0, y: 0, width: 10, height: 10 }], 30);
    const st = s.stats(a);
    expect(ev.reflows).toHaveLength(1);
    expect(st.reflows).toBe(1);
    expect(st.lastReflowTime).toBe(2);
    expect(st.layoutShift).toBe(0.25);
    expect(st.lastShiftTime).toBe(30);
    expect(st.shiftRects).toHaveLength(1);
    expect(s.totalShift).toBe(0.25);
    expect(s.topSources(1)[0].reflows).toBe(1);
    expect(s.rates(500).reflows).toBe(1);
  });
  it('push copies reflows already attached to the event', () => {
    const s = new Store(10, 20);
    const a = el();
    s.push(makeEvent(a, { reflows: [{ api: 'x', delay: 1, stack: [], source: null }] }));
    expect(s.stats(a).reflows).toBe(1);
  });
  it('topElements sorts by key and filters', () => {
    const s = new Store(10, 20);
    const a = el(), b = el('p');
    s.push(makeEvent(a, { time: 0 })); s.push(makeEvent(a, { time: 1 }));
    s.push(makeEvent(b, { time: 2, nodesAffected: 50 }));
    expect(s.topElements(5, 'rate', 10).map(x => x.element)).toEqual([a, b]);
    expect(s.topElements(5, 'nodesAffected', 10).map(x => x.element)).toEqual([b, a]);
    expect(s.topElements(1, 'total', 10)).toHaveLength(1);
    expect(s.topElements(5, 'total', 10, x => x.element === b).map(x => x.element)).toEqual([b]);
  });
  it('active returns recently mutated elements', () => {
    const s = new Store(10, 20);
    const a = el(), b = el();
    s.push(makeEvent(a, { time: 0 })); s.push(makeEvent(b, { time: 1000 }));
    expect(s.active(2000).map(x => x.element)).toEqual([b]);
  });
  it('tick records history and prunes detached or idle elements', () => {
    const s = new Store(10, 20);
    const a = el(), b = el();
    s.push(makeEvent(a, { time: 0 })); s.push(makeEvent(b, { time: 0 }));
    s.tick(1000);
    expect(s.history).toHaveLength(HISTORY_LEN);
    expect(s.history[HISTORY_LEN - 1]).toBe(2);
    s.tick(2000);
    expect(s.history[HISTORY_LEN - 1]).toBe(0);
    b.remove();
    s.tick(3000);
    expect(s.elements().map(x => x.element)).toEqual([a]);
    s.tick(70_000);
    expect(s.elements()).toEqual([]);
    s.push(makeEvent(a, { time: 70_001 }));
    expect(s.elements()).toHaveLength(1);
  });
  it('reset clears everything and notifies subscribers', () => {
    const s = new Store(10, 20);
    let n = 0;
    const off = s.subscribe(() => n++);
    s.push(makeEvent(el()));
    s.reset();
    expect(n).toBe(2);
    expect(s.events()).toEqual([]);
    expect(s.elements()).toEqual([]);
    expect(s.totalShift).toBe(0);
    off();
    s.push(makeEvent(el()));
    expect(n).toBe(2);
  });
});
