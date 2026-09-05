import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/ring-buffer';

describe('RingBuffer', () => {
  it('keeps insertion order below capacity', () => {
    const b = new RingBuffer<number>(3);
    b.push(1); b.push(2);
    expect(b.toArray()).toEqual([1, 2]);
    expect(b.size).toBe(2);
  });
  it('overwrites the oldest item at capacity', () => {
    const b = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach(n => b.push(n));
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });
  it('clear empties it', () => {
    const b = new RingBuffer<number>(2);
    b.push(1); b.clear();
    expect(b.toArray()).toEqual([]);
    b.push(7);
    expect(b.toArray()).toEqual([7]);
  });
  it('rejects capacity < 1', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});
