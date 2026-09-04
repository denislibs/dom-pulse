import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { DomPulse } from '../src/index';
import { flush } from './helpers';

// jsdom has no real canvas backend: `canvas.getContext('2d')` is expected to
// return null (the exact behavior Overlay is built to tolerate), but jsdom's
// own implementation also logs a "Not implemented" warning as a side effect
// of that. Stub the method to return null directly, as tests/overlay.test.ts
// and tests/hud.test.ts do, so the overlay + HUD canvases created by
// DomPulse.start() don't spam the test output.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalGetContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const origAppend = Node.prototype.appendChild;
const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get;

afterEach(() => DomPulse.stop());

describe('DomPulse', () => {
  it('start mounts overlay and hud, stop removes them and restores patches', () => {
    DomPulse.start();
    expect(DomPulse.running).toBe(true);
    expect(document.querySelector('[data-dom-pulse="overlay"]')).not.toBeNull();
    expect(document.querySelector('[data-dom-pulse="hud"]')).not.toBeNull();
    expect(Node.prototype.appendChild).not.toBe(origAppend);
    DomPulse.stop();
    DomPulse.stop();
    expect(DomPulse.running).toBe(false);
    expect(document.querySelector('[data-dom-pulse]')).toBeNull();
    expect(Node.prototype.appendChild).toBe(origAppend);
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).toBe(origOffset);
  });
  it('start is idempotent', () => {
    DomPulse.start(); DomPulse.start();
    expect(document.querySelectorAll('[data-dom-pulse="hud"]').length).toBe(1);
  });
  it('records a page mutation end to end and shows it in the HUD', async () => {
    DomPulse.start();
    const el = document.createElement('div'); el.id = 'e2e'; document.body.appendChild(el);
    el.setAttribute('data-x', '1');
    void el.offsetWidth;
    await flush();
    const hud = document.querySelector('[data-dom-pulse="hud"]')!.shadowRoot!;
    await new Promise(r => setTimeout(r, 300));
    expect(hud.querySelector('tbody')!.textContent).toContain('div#e2e');
  });
  it('pause stops recording, resume continues, reset clears', async () => {
    DomPulse.start();
    const el = document.createElement('div'); document.body.appendChild(el);
    await flush();
    DomPulse.pause();
    el.setAttribute('a', '1'); await flush();
    DomPulse.reset();
    const hud = document.querySelector('[data-dom-pulse="hud"]')!.shadowRoot!;
    await new Promise(r => setTimeout(r, 300));
    expect(hud.querySelector('tbody')!.textContent).toContain('no mutations yet');
    DomPulse.resume();
    el.setAttribute('a', '2'); await flush();
    await new Promise(r => setTimeout(r, 300));
    expect(hud.querySelector('tbody')!.textContent).toContain('div');
  });
  it('alt+click selects the element in the HUD', async () => {
    DomPulse.start();
    const el = document.createElement('p'); el.id = 'alt'; document.body.appendChild(el);
    await flush();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    const hud = document.querySelector('[data-dom-pulse="hud"]')!.shadowRoot!;
    expect((hud.querySelector('.lane') as HTMLElement).hidden).toBe(false);
    expect(hud.querySelector('.lane-title')!.textContent).toBe('p#alt');
  });
  it('alt+click on a never-mutated element opens its lane without registering it in the Store', async () => {
    DomPulse.start();
    const el = document.createElement('span'); el.id = 'idle'; document.body.appendChild(el);
    await flush();
    // el has never mutated -- no push() into the Store has happened for it.
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    const hud = document.querySelector('[data-dom-pulse="hud"]')!.shadowRoot!;
    expect((hud.querySelector('.lane') as HTMLElement).hidden).toBe(false);
    expect(hud.querySelector('.lane-title')!.textContent).toBe('span#idle');
    expect(hud.querySelector('.lane')!.textContent).toContain('no recorded mutations for this element');
    // Appending el to <body> is itself a real mutation of <body>, which legitimately
    // shows up as a row -- that's not the bug. The bug would be el itself (never
    // mutated) also showing up as a zero-value row, which is what store.stats(t)
    // used to do as a side effect of the click handler. This is the indirect,
    // black-box proof (index.ts does not expose the Store) that Alt+click never
    // registers the clicked element in the Store just to open its lane.
    expect(hud.querySelector('tbody')!.textContent).not.toContain('span#idle');
  });
  it('unwinds patches and DOM nodes if start fails partway through construction', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const OriginalMO = window.MutationObserver;
    // createObserver() runs after the overlay, the HUD and both DOM-write /
    // reflow patch sets are already installed. Making MutationObserver itself
    // throw simulates a failure at that point, to check that start() unwinds
    // everything built before the throw rather than leaving it stranded.
    // @ts-expect-error -- deliberately breaking construction for this test
    window.MutationObserver = class { constructor() { throw new Error('boom'); } };
    try {
      DomPulse.start();
    } finally {
      window.MutationObserver = OriginalMO;
    }
    expect(DomPulse.running).toBe(false);
    expect(document.querySelector('[data-dom-pulse]')).toBeNull();
    expect(Node.prototype.appendChild).toBe(origAppend);
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).toBe(origOffset);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    // A subsequent start() must work normally, proving no lingering state survived.
    DomPulse.start();
    expect(DomPulse.running).toBe(true);
    expect(document.querySelectorAll('[data-dom-pulse="hud"]').length).toBe(1);
  });
});
