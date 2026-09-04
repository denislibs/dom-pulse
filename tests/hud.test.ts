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
  it('rendering a stale selection does not resurrect a pruned Store entry', () => {
    const { store, el, q } = setup();
    store.push(makeEvent(el, { time: performance.now() }));
    hud!.select(el);
    expect(q('.lane').hidden).toBe(false);
    expect(store.elements().length).toBe(1);

    // The element is removed from the page and the store prunes it on its next tick.
    el.remove();
    store.tick(performance.now());
    expect(store.elements().length).toBe(0);

    // render() must not resurrect the pruned element just to read a label for the lane.
    hud!.render();
    expect(store.elements().length).toBe(0);
    expect(q('.lane').hidden).toBe(true);

    // A second render (the next 250ms tick, in real use) must not surface a ghost row
    // that a prior render's side effect would otherwise have recreated.
    hud!.render();
    expect(store.elements().length).toBe(0);
    expect(q('tbody').textContent).toContain('no mutations yet');
  });
  it('select() opens a lane for a connected element the Store has never tracked, using a fallback label', () => {
    const { store, q } = setup();
    const el = document.createElement('button'); el.id = 'never'; document.body.appendChild(el);
    hud!.select(el);
    expect(q('.lane').hidden).toBe(false);
    expect(q('.lane .lane-title').textContent).toBe('button#never');
    expect(q('.lane').textContent).toContain('no recorded mutations for this element');
    // The Store must not have been mutated just to render this lane.
    expect(store.elements().length).toBe(0);
  });
  it('a selection that is tracked, then removed and pruned, still collapses the lane (distinct from a never-tracked element)', () => {
    const { store, el, q } = setup();
    store.push(makeEvent(el, { time: performance.now() }));
    hud!.select(el);
    expect(q('.lane').hidden).toBe(false);
    el.remove();
    store.tick(performance.now());
    expect(store.elements().length).toBe(0);
    hud!.render();
    // Disconnected + untracked => stale selection => lane collapses (not shown with a fallback label).
    expect(q('.lane').hidden).toBe(true);
  });
  it('drag ends itself when a pointermove reports no buttons held, even without a pointerup', () => {
    const { q } = setup();
    const head = q('.head');
    head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 50, pointerId: 1, bubbles: true }));

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 70, buttons: 1, pointerId: 1 }));
    const leftAfterFirstMove = hud!.host.style.left;
    expect(leftAfterFirstMove).not.toBe('');

    // Simulate the pointer being released outside the window / over a cross-origin
    // iframe: no pointerup ever arrives, but the next pointermove reports no buttons.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 90, buttons: 0, pointerId: 1 }));

    // A further pointermove -- even reporting a button held, as a stray/late event
    // could -- must no longer reposition the panel: the drag already ended itself.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 999, buttons: 1, pointerId: 1 }));
    expect(hud!.host.style.left).toBe(leftAfterFirstMove);
  });
});
