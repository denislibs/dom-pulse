import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The IIFE bundle is the primary delivery path (script tag + bookmarklet):
// it assigns the global and auto-starts unless the tag opts out.
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/index', () => ({ DomPulse: { start: mocks.start, stop: mocks.stop } }));

function setCurrentScript(script: HTMLScriptElement | null): void {
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
}

beforeEach(() => { vi.resetModules(); mocks.start.mockClear(); setCurrentScript(null); });
afterEach(() => { delete (window as unknown as { DomPulse?: unknown }).DomPulse; setCurrentScript(null); });

describe('iife entry', () => {
  it('assigns window.DomPulse and auto-starts', async () => {
    await import('../src/iife');
    expect((window as unknown as { DomPulse: unknown }).DomPulse).toBe((await import('../src/index')).DomPulse);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it('still assigns the global but does not start with data-autostart="false"', async () => {
    const script = document.createElement('script');
    script.dataset.autostart = 'false';
    setCurrentScript(script);
    await import('../src/iife');
    expect((window as unknown as { DomPulse: unknown }).DomPulse).toBeDefined();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('auto-starts when the tag sets any other value', async () => {
    const script = document.createElement('script');
    script.dataset.autostart = 'true';
    setCurrentScript(script);
    await import('../src/iife');
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
