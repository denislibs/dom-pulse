import { describe, it, expect } from 'vitest';
import { withInternal, isInternal } from '../src/internal';
import { DEFAULT_OPTIONS } from '../src/types';

describe('environment', () => {
  it('has a DOM and MutationObserver', () => {
    const el = document.createElement('div');
    expect(el.tagName).toBe('DIV');
    expect(typeof MutationObserver).toBe('function');
  });
  it('withInternal toggles the flag and restores it on throw', () => {
    expect(isInternal()).toBe(false);
    withInternal(() => expect(isInternal()).toBe(true));
    expect(() => withInternal(() => { throw new Error('x'); })).toThrow('x');
    expect(isInternal()).toBe(false);
  });
  it('has defaults from the spec', () => {
    expect(DEFAULT_OPTIONS).toEqual({ hotThreshold: 20, bufferSize: 500, include: '', exclude: '', topN: 10 });
  });
});
