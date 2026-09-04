import { describe, it, expect } from 'vitest';
import { intersects, matchShift } from '../src/cost/layout-shift';
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
