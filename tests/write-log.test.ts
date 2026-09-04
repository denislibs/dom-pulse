import { describe, it, expect } from 'vitest';
import { WriteLog } from '../src/write-log';

function make() {
  let t = 0;
  const frames: Array<() => void> = [];
  const log = new WriteLog(() => t, fn => frames.push(fn));
  return { log, tick: (dt: number) => { t += dt; }, flushFrame: () => { const f = frames.splice(0); f.forEach(fn => fn()); } };
}

describe('WriteLog', () => {
  it('records with time and stack', () => {
    const { log, tick } = make();
    const el = document.createElement('div');
    tick(5);
    const r = log.record(el, 'stack');
    expect(r).toMatchObject({ target: el, stack: 'stack', time: 5, reflows: [], event: null, matched: false, hint: null });
    expect(log.size).toBe(1);
  });
  it('skips records whose hint cannot have produced the mutation', () => {
    const { log } = make();
    const el = document.createElement('div');
    const noop = log.record(el, 'removeAttribute', { kind: 'attributes', attr: 'nonexistent' });
    const real = log.record(el, 'setAttribute', { kind: 'attributes', attr: 'data-x' });
    expect(log.match(el, 'attributes', 'data-x')).toBe(real);
    expect(noop.matched).toBe(false);
    // The kind has to fit too: a childList mutation cannot come from an attribute write.
    expect(log.match(el, 'childList', null)).toBeNull();
    // Attribute names are compared case-insensitively (setAttribute lower-cases them).
    const upper = log.record(el, 'setAttribute', { kind: 'attributes', attr: 'DATA-Y' });
    expect(log.match(el, 'attributes', 'data-y')).toBe(upper);
  });
  it('hands the orphaned reflow hits of no-op writes to the real event', () => {
    const { log } = make();
    const el = document.createElement('div');
    const noop = log.record(el, 'noop', { kind: 'attributes', attr: 'gone' });
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    noop.reflows.push(hit);
    log.record(el, 'real', { kind: 'attributes', attr: 'data-x' });
    log.match(el, 'attributes', 'data-x');
    expect(log.takeOrphanReflows(el)).toEqual([hit]);
    // Taken once only.
    expect(log.takeOrphanReflows(el)).toEqual([]);
  });
  it('finds the newest record related to a read element', () => {
    const { log } = make();
    const parent = document.createElement('ul');
    const child = document.createElement('li');
    parent.appendChild(child);
    const other = document.createElement('div');
    const rParent = log.record(parent, 'p');
    log.record(other, 'o');
    expect(log.forRead(child)).toBe(rParent);   // ancestor write
    expect(log.forRead(parent)).toBe(rParent);
    const rChild = log.record(child, 'c');
    expect(log.forRead(parent)).toBe(rChild);   // descendant write, newer
    expect(log.forRead(document.createElement('i'))).toBeNull();
  });
  it('matches oldest unmatched record for a target, then falls back to newest', () => {
    const { log } = make();
    const a = document.createElement('a');
    const b = document.createElement('b');
    const r1 = log.record(a, '1'); const r2 = log.record(b, '2'); const r3 = log.record(a, '3');
    expect(log.match(a)).toBe(r1);
    expect(log.match(a)).toBe(r3);
    expect(log.match(a)).toBe(r3);
    expect(log.match(b)).toBe(r2);
    expect(log.match(document.createElement('i'))).toBeNull();
  });
  it('clears on the next frame and reschedules after new writes', () => {
    const { log, flushFrame } = make();
    const el = document.createElement('div');
    log.record(el, undefined); log.record(el, undefined);
    expect(log.size).toBe(2);
    flushFrame();
    expect(log.size).toBe(0);
    expect(log.last()).toBeNull();
    log.record(el, undefined);
    expect(log.size).toBe(1);
    flushFrame();
    expect(log.size).toBe(0);
  });
  it('caps the number of records', () => {
    const { log } = make();
    const el = document.createElement('div');
    const small = new WriteLog(() => 0, () => {}, 2);
    small.record(el, 'a'); small.record(el, 'b'); small.record(el, 'c');
    expect(small.size).toBe(2);
    expect(small.last()?.stack).toBe('c');
    void log;
  });
});
