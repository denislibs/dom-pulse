import { describe, it, expect } from 'vitest';
import { SlidingCounter } from '../src/sliding-counter';

describe('SlidingCounter', () => {
  it('counts entries inside the window', () => {
    const c = new SlidingCounter(1000);
    c.add(0); c.add(500); c.add(900);
    expect(c.count(1000)).toBe(3);
  });
  it('drops entries older than the window', () => {
    const c = new SlidingCounter(1000);
    c.add(0); c.add(500); c.add(900);
    expect(c.count(1001)).toBe(2);
    expect(c.count(2000)).toBe(0);
  });
  it('clear resets', () => {
    const c = new SlidingCounter(1000);
    c.add(10); c.clear();
    expect(c.count(10)).toBe(0);
  });
});
