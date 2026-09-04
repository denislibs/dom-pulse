import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { Hud } from '../src/hud/hud';
import { Store } from '../src/store';
import { makeEvent } from './helpers';

// jsdom has no real canvas backend: `canvas.getContext('2d')` is expected to
// return null (the exact behavior this module is built to tolerate), but
// jsdom's own implementation also logs a "Not implemented" warning as a side
// effect of that. Stub the method to return null directly so the module sees
// the same null context without the unrelated console noise. The HUD draws a
// sparkline on every render() call, so this suite needs the same stub used
// by tests/overlay.test.ts and tests/render-diff.test.ts.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalGetContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

let hud: Hud | null = null;
afterEach(() => { hud?.destroy(); hud = null; });

function setup() {
  const store = new Store(50, 20);
  const cb = { onPause: vi.fn(), onReset: vi.fn(), onFilters: vi.fn(), onLocate: vi.fn() };
  hud = new Hud(store, cb, { topN: 10, include: '', exclude: '' });
  const el = document.createElement('div'); el.id = 'target'; document.body.appendChild(el);
  return { store, cb, el, root: hud.root, q: (s: string) => hud!.root.querySelector(s) as HTMLElement };
}

describe('Hud', () => {
  it('mounts a shadow host and shows an empty table', () => {
    const { root } = setup();
    expect(hud!.host.isConnected).toBe(true);
    expect(hud!.host.getAttribute('data-dom-pulse')).toBe('hud');
    expect(root.querySelector('tbody')!.textContent).toContain('no mutations yet');
  });
  it('renders top elements and header stats', () => {
    const { store, el, q } = setup();
    store.push(makeEvent(el, { time: performance.now(), source: 'a.js:1 f' }));
    hud!.render();
    expect(q('tbody tr[data-i="0"] td.el').textContent).toBe('div#target');
    expect(q('.sources .src').textContent).toContain('a.js:1 f');
  });
  it('first row click locates, second expands the lane with the diff', () => {
    const { store, el, cb, q } = setup();
    store.push(makeEvent(el, { time: performance.now(), diff: { kind: 'attribute', name: 'class', oldValue: 'a', newValue: 'a b', classAdded: ['b'], classRemoved: [] } }));
    hud!.render();
    q('tbody tr[data-i="0"]').click();
    expect(cb.onLocate).toHaveBeenCalledWith(el);
    expect(q('.lane').hidden).toBe(true);
    q('tbody tr[data-i="0"]').click();
    expect(q('.lane').hidden).toBe(false);
    expect(q('.lane').innerHTML).toContain('<ins>+b</ins>');
  });
  it('select() opens the lane for an element', () => {
    const { store, el, q } = setup();
    store.push(makeEvent(el, { time: performance.now() }));
    hud!.select(el);
    expect(q('.lane').hidden).toBe(false);
    expect(q('.lane .lane-title').textContent).toBe('div#target');
  });
  it('buttons call callbacks and collapse toggles the badge', () => {
    const { cb, q } = setup();
    q('[data-act="pause"]').click(); expect(cb.onPause).toHaveBeenCalledWith(true);
    q('[data-act="pause"]').click(); expect(cb.onPause).toHaveBeenCalledWith(false);
    q('[data-act="reset"]').click(); expect(cb.onReset).toHaveBeenCalled();
    q('[data-act="collapse"]').click();
    expect(q('.panel').hidden).toBe(true); expect(q('.badge').hidden).toBe(false);
    q('.badge').click();
    expect(q('.panel').hidden).toBe(false);
  });
  it('settings changes emit filters', () => {
    const { cb, q } = setup();
    q('[data-act="settings"]').click();
    const inc = q('input[data-f="include"]') as HTMLInputElement;
    inc.value = '#app'; inc.dispatchEvent(new Event('change', { bubbles: true }));
    const kind = q('input[data-kind="characterData"]') as HTMLInputElement;
    kind.checked = false; kind.dispatchEvent(new Event('change', { bubbles: true }));
    expect(cb.onFilters).toHaveBeenLastCalledWith({ include: '#app', exclude: '', kinds: ['childList', 'attributes'], minRate: 0, topN: 10 });
  });
  it('sorting by column and filtering by source', () => {
    const { store, q } = setup();
    const a = document.createElement('a'), b = document.createElement('b'); document.body.append(a, b);
    store.push(makeEvent(a, { time: performance.now(), source: 's1', nodesAffected: 1 }));
    store.push(makeEvent(b, { time: performance.now(), source: 's2', nodesAffected: 9 }));
    hud!.render();
    q('th[data-sort="nodesAffected"]').click();
    expect(q('tbody tr[data-i="0"] td.el').textContent).toBe('b');
    q('.sources .src[data-s="0"]').click();
    expect(hud!.root.querySelectorAll('tbody tr[data-i]').length).toBe(1);
  });
  it('destroy removes the host', () => {
    setup();
    const host = hud!.host;
    hud!.destroy(); hud = null;
    expect(host.isConnected).toBe(false);
  });
});
