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
    expect(r).toMatchObject({ target: el, stack: 'stack', time: 5, reflows: [], event: null, matched: false });
    expect(log.size).toBe(1);
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
