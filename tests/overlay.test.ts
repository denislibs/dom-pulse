import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { frameStyle, Overlay, FADE_MS } from '../src/overlay';
import { Store } from '../src/store';
import { makeEvent } from './helpers';
import { resetWarnings } from '../src/warn';

// jsdom has no real canvas backend: `canvas.getContext('2d')` is expected to
// return null (the exact behavior this module is built to tolerate), but
// jsdom's own implementation also logs a "Not implemented" warning as a side
// effect of that. Stub the method to return null directly so the module sees
// the same null context without the unrelated console noise.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalGetContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function statsFor(store: Store, times: number[], kind: 'childList' | 'attributes' | 'characterData' = 'attributes') {
  const el = document.createElement('div'); document.body.appendChild(el);
  for (const t of times) store.push(makeEvent(el, { time: t, kind }));
  return store.stats(el);
}

describe('frameStyle', () => {
  it('is null outside the fade window', () => {
    const s = statsFor(new Store(10, 20), [0]);
    expect(frameStyle(s, FADE_MS + 1, 20)).toBeNull();
    expect(frameStyle(s, -1, 20)).toBeNull();
  });
  it('uses the kind color, fades with age and scales with frequency', () => {
    const s = statsFor(new Store(10, 20), [0], 'childList');
    const fresh = frameStyle(s, 0, 20)!;
    expect(fresh.rgba.startsWith('rgba(34,197,94,')).toBe(true);
    expect(fresh.lineWidth).toBe(2);
    expect(fresh.dashed).toBe(false);
    const older = frameStyle(s, 750, 20)!;
    expect(parseFloat(older.rgba.split(',')[3])).toBeLessThan(parseFloat(fresh.rgba.split(',')[3]));
  });
  it('turns red and thick when hot', () => {
    const s = statsFor(new Store(10, 3), [0, 1, 2]);
    const st = frameStyle(s, 2, 3)!;
    expect(st.rgba.startsWith('rgba(239,68,68,')).toBe(true);
    expect(st.lineWidth).toBe(3);
  });
  it('dashes after a reflow and adds shift alpha after a shift', () => {
    const store = new Store(10, 20);
    const s = statsFor(store, [0]);
    const ev = store.eventsFor(s.element)[0];
    store.addReflow(ev, { api: 'x', delay: 0, stack: [], source: null });
    store.addShift(ev, 0.1, [{ x: 0, y: 0, width: 1, height: 1 }], 0);
    const st = frameStyle(s, 10, 20)!;
    expect(st.dashed).toBe(true);
    expect(st.shiftAlpha).toBeGreaterThan(0);
  });
});

describe('Overlay', () => {
  it('mounts a fixed, non-interactive canvas and removes it on destroy', () => {
    const store = new Store(10, 20);
    const o = new Overlay(store, () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(o.element.isConnected).toBe(true);
    expect(o.element.getAttribute('data-dom-pulse')).toBe('overlay');
    expect(o.element.style.pointerEvents).toBe('none');
    o.destroy();
    expect(o.element.isConnected).toBe(false);
  });
  it('draw reports whether anything is still active', () => {
    const store = new Store(10, 20);
    const o = new Overlay(store, () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(o.draw(0)).toBe(false);
    const s = statsFor(store, [100]);
    expect(o.draw(200)).toBe(true);
    expect(o.draw(100 + FADE_MS + 1)).toBe(false);
    o.highlight(s.element);
    expect(o.draw(performance.now())).toBe(true);
    o.destroy();
  });
  it('recovers from exceptions in draw and allows wake to reschedule', () => {
    resetWarnings();
    const store = new Store(10, 20);
    let rafCallCount = 0;
    const throwingRectOf = (el: Element) => {
      throw new Error('rectOf error');
    };

    const o = new Overlay(store, throwingRectOf);
    const warnSpy = vi.spyOn(console, 'warn');
    const drawSpy = vi.spyOn(o, 'draw').mockImplementation(() => {
      throw new Error('draw error for testing');
    });

    // Stub requestAnimationFrame to invoke its callback synchronously and track calls
    const originalRAF = globalThis.requestAnimationFrame;
    const now = performance.now();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallCount++;
      // Invoke synchronously
      cb(now);
      return 0;
    }) as typeof requestAnimationFrame;

    // First wake() schedules frame, which calls draw and throws
    // The exception should be caught by the frame method and running reset to false
    expect(() => o.wake()).not.toThrow();

    // Verify draw was called
    expect(drawSpy).toHaveBeenCalled();

    // Verify the error was reported once
    expect(warnSpy).toHaveBeenCalledWith('[dom-pulse] overlay-draw:', expect.any(Error));
    expect(warnSpy.mock.calls.length).toBe(1);

    const rafCallsAfterFirstWake = rafCallCount;

    // Second wake() should schedule another frame since running was reset to false
    // If the fix failed, wake() would return early (running still true) and rafCallCount wouldn't increase
    expect(() => o.wake()).not.toThrow();

    // Verify requestAnimationFrame was called again (proving wake didn't return early)
    expect(rafCallCount).toBeGreaterThan(rafCallsAfterFirstWake);

    // Restore
    globalThis.requestAnimationFrame = originalRAF;
    warnSpy.mockRestore();
    drawSpy.mockRestore();
    o.destroy();
  });
});
