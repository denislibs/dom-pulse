import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installReflowPatches, originals } from '../src/cost/reflow';
import { WriteLog } from '../src/write-log';
import { withInternal } from '../src/internal';
import { makeEvent } from './helpers';

let log: WriteLog; let restore: () => void; let t = 0;
const onEvent = vi.fn(); const onElement = vi.fn();
const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;

beforeEach(() => {
  t = 0; onEvent.mockReset(); onElement.mockReset();
  log = new WriteLog(() => t, () => {});
  restore = installReflowPatches(log, { onEvent, onElement }, () => t);
});
afterEach(() => restore());

describe('installReflowPatches', () => {
  it('does nothing when no write happened this frame', () => {
    const el = document.createElement('div');
    void el.offsetWidth; el.getBoundingClientRect();
    expect(log.size).toBe(0);
    // Layout is clean with nothing pending, so neither read forced anything.
    expect(onElement).not.toHaveBeenCalled();
  });
  it('attaches a hit to the last write record with delay and api', () => {
    const el = document.createElement('div');
    const rec = log.record(el, 'Error\n    at f (http://x/app.js:1:1)');
    t = 7;
    void el.offsetWidth;
    expect(rec.reflows).toHaveLength(1);
    expect(rec.reflows[0]).toMatchObject({ api: 'offsetWidth', delay: 7 });
    el.getBoundingClientRect();
    window.getComputedStyle(el);
    expect(rec.reflows.map(h => h.api)).toEqual(['offsetWidth', 'getBoundingClientRect', 'getComputedStyle']);
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('attributes the hit to the element that was read, not to the newest write', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    // b is written first, a second: log.last() is a's record, but the read is on b.
    const recB = log.record(b, 'B');
    const recA = log.record(a, 'A');
    t = 3;
    void b.offsetWidth;
    expect(recB.reflows.map(h => h.api)).toEqual(['offsetWidth']);
    expect(recA.reflows).toEqual([]);
    a.remove(); b.remove();
  });
  it('accepts a record for an ancestor or a descendant of the read element', () => {
    const parent = document.createElement('ul');
    const child = document.createElement('li');
    parent.appendChild(child);
    const other = document.createElement('div');
    document.body.append(parent, other);
    const recParent = log.record(parent, 'P');
    log.record(other, 'O');
    void child.offsetWidth;                      // ancestor write
    expect(recParent.reflows).toHaveLength(1);
    const recChild = log.record(child, 'C');
    log.record(other, 'O2');
    parent.getBoundingClientRect();              // descendant write
    expect(recChild.reflows.map(h => h.api)).toEqual(['getBoundingClientRect']);
    parent.remove(); other.remove();
  });
  it('picks the element argument of getComputedStyle, not the newest write', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const recB = log.record(b, 'B');
    log.record(a, 'A');
    window.getComputedStyle(b);
    expect(recB.reflows.map(h => h.api)).toEqual(['getComputedStyle']);
    a.remove(); b.remove();
  });
  it('charges the element that was read when no record relates to it', () => {
    // Read-before-write: the element being read has no write record yet, and the one write
    // in the log is unrelated to it. The forced layout belongs to the element that was read,
    // never to whoever happened to be written last.
    const a = document.createElement('div');
    const lonely = document.createElement('div');
    document.body.append(a, lonely);
    const recA = log.record(a, 'A');
    t = 4;
    void lonely.offsetWidth;
    expect(recA.reflows).toEqual([]);
    expect(onElement).toHaveBeenCalledTimes(1);
    expect(onElement.mock.calls[0][0]).toBe(lonely);
    expect(onElement.mock.calls[0][1]).toMatchObject({ api: 'offsetWidth', delay: 4 });
    expect(onElement.mock.calls[0][2]).toBe(4);
    a.remove(); lonely.remove();
  });
  it('notifies when the record already has an event', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    rec.event = makeEvent(el);
    void el.clientHeight;
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toBe(rec.event);
    expect(onEvent.mock.calls[0][1].api).toBe('clientHeight');
  });
  it('ignores internal reads', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    withInternal(() => void el.offsetWidth);
    expect(rec.reflows).toHaveLength(0);
    expect(onElement).not.toHaveBeenCalled();
  });
  it('originals bypass the patch and restore works', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    originals.getBoundingClientRect.call(el);
    expect(rec.reflows).toHaveLength(0);
    expect(onElement).not.toHaveBeenCalled();
    restore();
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).toBe(origOffset.get);
    restore = () => {};
  });
});
