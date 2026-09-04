import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installReflowPatches, originals } from '../src/cost/reflow';
import { WriteLog } from '../src/write-log';
import { withInternal } from '../src/internal';
import { makeEvent } from './helpers';

let log: WriteLog; let restore: () => void; let t = 0; const onHit = vi.fn();
const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;

beforeEach(() => { t = 0; onHit.mockReset(); log = new WriteLog(() => t, () => {}); restore = installReflowPatches(log, onHit, undefined, () => t); });
afterEach(() => restore());

describe('installReflowPatches', () => {
  it('does nothing when no write happened this frame', () => {
    const el = document.createElement('div');
    void el.offsetWidth; el.getBoundingClientRect();
    expect(log.size).toBe(0);
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
    expect(onHit).not.toHaveBeenCalled();
  });
  it('notifies when the record already has an event', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    rec.event = makeEvent(el);
    void el.clientHeight;
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit.mock.calls[0][0]).toBe(rec.event);
    expect(onHit.mock.calls[0][1].api).toBe('clientHeight');
  });
  it('ignores internal reads', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    withInternal(() => void el.offsetWidth);
    expect(rec.reflows).toHaveLength(0);
  });
  it('originals bypass the patch and restore works', () => {
    const el = document.createElement('div');
    const rec = log.record(el, undefined);
    originals.getBoundingClientRect.call(el);
    expect(rec.reflows).toHaveLength(0);
    restore();
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).toBe(origOffset.get);
    restore = () => {};
  });
});
