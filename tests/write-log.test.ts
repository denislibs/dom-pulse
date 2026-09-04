import { describe, it, expect } from 'vitest';
import { WriteLog } from '../src/write-log';
import { makeEvent } from './helpers';
import type { PulseEvent, ReflowHit } from '../src/types';

/** What the observer does for an event it is still building: Store.push applies these. */
const deliver = (host: PulseEvent, hits: ReflowHit[]) => { host.reflows.push(...hits); };

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
  it('hands the orphaned reflow hits of no-op writes to a real event', () => {
    const { log } = make();
    const el = document.createElement('div');
    const noop = log.record(el, 'noop', { kind: 'attributes', attr: 'gone' });
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    noop.reflows.push(hit);
    const real = log.record(el, 'real', { kind: 'attributes', attr: 'data-x' });
    expect(log.match(el, 'attributes', 'data-x')).toBe(real);
    real.event = makeEvent(el);
    log.drainOrphanReflows(deliver);
    expect(real.event.reflows).toEqual([hit]);
    expect(noop.reflows).toEqual([]);
    // Drained once only.
    log.drainOrphanReflows(deliver);
    expect(real.event.reflows).toEqual([hit]);
  });
  it('leaves the hits of a record that has a mutation of its own alone', () => {
    // The regression this guards: draining while events are still being built takes the
    // hits of the *second* write to an element -- unmatched only because its own mutation
    // has not been handled yet -- and moves them onto the first write's event. Run after
    // the whole batch has been matched, as the observer now does, both records are
    // matched and neither is mistaken for an orphan.
    const { log } = make();
    const el = document.createElement('div');
    const first = log.record(el, 'first', { kind: 'attributes', attr: 'a' });
    const second = log.record(el, 'second', { kind: 'attributes', attr: 'b' });
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    second.reflows.push(hit);
    expect(log.match(el, 'attributes', 'a')).toBe(first);
    expect(log.match(el, 'attributes', 'b')).toBe(second);
    first.event = makeEvent(el);
    second.event = makeEvent(el, { reflows: [...second.reflows] });
    log.drainOrphanReflows(deliver);
    expect(first.event.reflows).toEqual([]);
    expect(second.event.reflows).toEqual([hit]);
  });
  it('gives an orphan to the nearest earlier event for the target, else the nearest later one', () => {
    const { log } = make();
    const el = document.createElement('div');
    const other = document.createElement('div');
    const before = log.record(el, 'before');
    log.record(other, 'unrelated');
    const orphan = log.record(el, 'orphan', { kind: 'attributes', attr: 'never' });
    const after = log.record(el, 'after');
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    orphan.reflows.push(hit);
    before.matched = true; before.event = makeEvent(el);
    after.matched = true; after.event = makeEvent(el);
    log.drainOrphanReflows(deliver);
    expect(before.event.reflows).toEqual([hit]);  // the newest write that precedes the read
    expect(after.event.reflows).toEqual([]);

    // With no earlier event for the target, a later one is the hit's only home.
    log.clear();
    const lone = log.record(el, 'orphan', { kind: 'attributes', attr: 'never' });
    lone.reflows.push(hit);
    const real = log.record(el, 'real');
    real.matched = true; real.event = makeEvent(el);
    log.drainOrphanReflows(deliver);
    expect(real.event.reflows).toEqual([hit]);
  });
  it('hands each orphan to the caller, which decides how the host takes the hits', () => {
    // The observer routes hits differently for an event of the current batch (not pushed
    // yet) and one pushed in an earlier batch of the same frame, so the drain must report
    // the host rather than mutate its array itself.
    const { log } = make();
    const el = document.createElement('div');
    const orphan = log.record(el, 'orphan', { kind: 'attributes', attr: 'never' });
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    orphan.reflows.push(hit);
    const real = log.record(el, 'real');
    real.matched = true; real.event = makeEvent(el);
    const seen: Array<[PulseEvent, ReflowHit[]]> = [];
    log.drainOrphanReflows((host, hits) => { seen.push([host, hits]); });
    expect(seen).toEqual([[real.event, [hit]]]);
    expect(real.event.reflows).toEqual([]);   // untouched: delivery is the caller's job
    expect(orphan.reflows).toEqual([]);       // taken out of the record all the same
  });
  it('retries a record that had no host in one drain once an event becomes available', () => {
    // The opposite of the old (removed) "flag it off after one miss" behaviour: a record
    // that found no host in one batch must still be reachable in a later batch of the same
    // frame, because match() can retroactively hand an earlier record a real mutation --
    // and thus an event -- that it did not have when the previous drain ran.
    const { log } = make();
    const el = document.createElement('div');
    const orphan = log.record(el, 'orphan', { kind: 'attributes', attr: 'never' });
    const hit = { api: 'offsetWidth', delay: 1, stack: [], source: null };
    orphan.reflows.push(hit);
    log.drainOrphanReflows(deliver);          // no event anywhere yet: nothing to deliver to
    expect(orphan.reflows).toEqual([hit]);
    const host = log.record(el, 'host');
    host.matched = true; host.event = makeEvent(el);
    log.drainOrphanReflows(deliver);          // retried, and a host now exists
    expect(host.event.reflows).toEqual([hit]);
    expect(orphan.reflows).toEqual([]);
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
