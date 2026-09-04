import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createObserver, buildEvents } from '../src/observer';
import { Store } from '../src/store';
import { WriteLog } from '../src/write-log';
import { flush } from './helpers';
import { resetWarnings } from '../src/warn';
import type { MutationKind } from '../src/types';

let store: Store; let log: WriteLog; let obs: ReturnType<typeof createObserver>; let root: HTMLElement; let ignored: HTMLElement;
const allKinds = () => new Set<MutationKind>(['childList', 'attributes', 'characterData']);

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root);
  ignored = document.createElement('div'); ignored.id = 'hud'; document.body.appendChild(ignored);
  store = new Store(100, 20); log = new WriteLog(() => 0, () => {});
  obs = createObserver({ store, log, isIgnored: n => n === ignored || ignored.contains(n), now: () => 42 }, { include: '', exclude: '', kinds: allKinds() });
});
afterEach(() => obs.disconnect());

describe('createObserver', () => {
  it('builds attribute events with class diff and lookahead new values', async () => {
    root.setAttribute('class', 'a');
    root.setAttribute('class', 'a b');
    root.setAttribute('class', 'c');
    await flush();
    const evs = store.eventsFor(root);
    expect(evs.map(e => e.kind)).toEqual(['attributes', 'attributes', 'attributes']);
    expect(evs.map(e => (e.diff as any).newValue)).toEqual(['a', 'a b', 'c']);
    expect((evs[1].diff as any).classAdded).toEqual(['b']);
    expect(evs[0].time).toBe(42);
    expect(evs[0].nodesAffected).toBe(1);
  });
  it('builds text events against the parent element', async () => {
    root.textContent = 'hello';
    await flush(); store.reset();
    (root.firstChild as Text).data = 'hello world';
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.kind).toBe('characterData');
    expect(ev.node).toBe(root.firstChild);
    expect(ev.diff).toMatchObject({ kind: 'text', oldValue: 'hello', newValue: 'hello world' });
  });
  it('builds children events with node counts', async () => {
    root.innerHTML = '<ul><li></li><li></li></ul>';
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.kind).toBe('childList');
    expect(ev.nodesAffected).toBe(3);
    expect(ev.diff).toMatchObject({ kind: 'children', added: ['ul (2)'] });
  });
  it('attaches stack, source and pending reflows from the write log', async () => {
    const rec = log.record(root, 'Error\n    at render (http://x/app.js:5:3)');
    rec.reflows.push({ api: 'offsetWidth', delay: 1, stack: [], source: null });
    root.setAttribute('a', '1');
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toBe('app.js:5 render');
    expect(ev.reflows).toHaveLength(1);
    expect(ev.reflows).not.toBe(rec.reflows);
    expect(rec.event).toBe(ev);
  });
  it('ignores the HUD subtree and its insertion', async () => {
    ignored.setAttribute('a', '1');
    const child = document.createElement('span'); ignored.appendChild(child);
    ignored.remove(); document.body.appendChild(ignored);
    await flush();
    expect(store.events()).toEqual([]);
  });
  it('applies include, exclude and kind filters', async () => {
    const other = document.createElement('p'); document.body.appendChild(other);
    await flush(); store.reset();
    obs.setFilters({ include: '#root', kinds: new Set(['attributes']) });
    root.setAttribute('a', '1'); root.textContent = 'x'; other.setAttribute('a', '1');
    await flush();
    expect(store.events().map(e => [e.target.id, e.kind])).toEqual([['root', 'attributes']]);
    obs.setFilters({ include: '', exclude: '#root' });
    root.setAttribute('a', '2'); other.setAttribute('a', '2');
    await flush();
    expect(store.events().at(-1)?.target).toBe(other);
  });
  it('an invalid include selector warns once and does not silence the tool', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetWarnings();
    try {
      obs.setFilters({ include: '.foo:' });
      root.setAttribute('a', '1');
      await flush();
      expect(store.events()).toHaveLength(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('include');
      obs.setFilters({ include: '.bar:' });
      root.setAttribute('a', '2');
      await flush();
      expect(store.events()).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      resetWarnings();
    }
  });
  it('an invalid exclude selector warns once and keeps events flowing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetWarnings();
    try {
      obs.setFilters({ exclude: '###' });
      root.setAttribute('a', '1');
      await flush();
      expect(store.events()).toHaveLength(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exclude');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      resetWarnings();
    }
  });
  it('a valid include selector still filters', async () => {
    const other = document.createElement('p'); document.body.appendChild(other);
    await flush(); store.reset();
    obs.setFilters({ include: '#root' });
    root.setAttribute('a', '1'); other.setAttribute('a', '1');
    await flush();
    expect(store.events().map(e => e.target)).toEqual([root]);
  });
  it('keeps node counts exact for large subtrees even though the diff list is capped', async () => {
    root.innerHTML = '<ul>' + '<li><b></b></li>'.repeat(30) + '</ul>';
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.nodesAffected).toBe(61); // ul + 30 li + 30 b
  });
  it('include matches descendants of the selector', async () => {
    const inner = document.createElement('b'); root.appendChild(inner);
    await flush(); store.reset();
    obs.setFilters({ include: '#root' });
    inner.setAttribute('a', '1');
    await flush();
    expect(store.events()).toHaveLength(1);
  });
});

describe('buildEvents', () => {
  it('skips fragments and keeps going', () => {
    const frag = document.createDocumentFragment();
    const rec = { type: 'childList', target: frag, addedNodes: [] as any, removedNodes: [] as any, attributeName: null, oldValue: null } as unknown as MutationRecord;
    expect(buildEvents([rec], { store, log, isIgnored: () => false }, { include: '', exclude: '', kinds: allKinds() })).toEqual([]);
  });
});

describe('error handling', () => {
  it('catches errors in buildEvents and reports them without propagating', async () => {
    obs.disconnect();
    const badLog = {
      match: () => { throw new Error('boom'); },
      record: () => ({ reflows: [] }),
    } as any;
    const obs2 = createObserver({ store, log: badLog, isIgnored: () => false, now: () => 42 }, { include: '', exclude: '', kinds: allKinds() });

    const warnSpy = vi.spyOn(console, 'warn');
    try {
      root.setAttribute('test', '1');
      await flush();

      expect(store.events()).toHaveLength(0);
      if (warnSpy.mock.calls.length > 0) {
        const message = String(warnSpy.mock.calls[0][0]);
        expect(message).toContain('observer');
      }
    } finally {
      warnSpy.mockRestore();
      obs2.disconnect();
    }
  });
});
