import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWritePatches } from '../src/attribution';
import { createObserver } from '../src/observer';
import { Store } from '../src/store';
import { WriteLog } from '../src/write-log';
import { flush } from './helpers';
import type { MutationKind } from '../src/types';

// End-to-end attribution: real patched writes -> real MutationRecords -> events.
// The whole point of these cases is *which* call site each event is credited to,
// so every write below happens inside a distinctly named function.
let store: Store; let log: WriteLog; let obs: ReturnType<typeof createObserver>; let restore: () => void; let root: HTMLElement;
const allKinds = () => new Set<MutationKind>(['childList', 'attributes', 'characterData']);

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root);
  store = new Store(100, 20);
  log = new WriteLog(() => 0, () => {});
  restore = installWritePatches(log);
  obs = createObserver({ store, log, isIgnored: () => false, now: () => 0 }, { include: '', exclude: '', kinds: allKinds() });
});
afterEach(() => { obs.disconnect(); restore(); });

function libA_removeMissingAttribute(el: Element): void { el.removeAttribute('nonexistent'); }
function libB_setAttribute(el: Element): void { el.setAttribute('data-x', '1'); }
function libA_emptyText(el: Element): void { el.textContent = ''; }
function libA_emptyHtml(el: Element): void { el.insertAdjacentHTML('beforeend', ''); }
function libA_removeUnsetProperty(el: HTMLElement): void { el.style.removeProperty('color'); }
function libB_appendChild(parent: Element, child: Element): void { parent.appendChild(child); }
function moveNode(to: Element, child: Element): void { to.appendChild(child); }

describe('write attribution', () => {
  it('does not let a no-op removeAttribute steal the next real mutation', async () => {
    libA_removeMissingAttribute(root);
    libB_setAttribute(root);
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toContain('libB_setAttribute');
  });
  it('does not let a no-op textContent="" steal the next real mutation', async () => {
    libA_emptyText(root);
    libB_setAttribute(root);
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toContain('libB_setAttribute');
  });
  it('does not let a no-op insertAdjacentHTML steal the next real mutation', async () => {
    libA_emptyHtml(root);
    libB_appendChild(root, document.createElement('span'));
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toContain('libB_appendChild');
  });
  it('does not let a no-op style.removeProperty steal the next real mutation', async () => {
    libA_removeUnsetProperty(root);
    libB_setAttribute(root);
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toContain('libB_setAttribute');
  });
  it('keeps real writes to one element in order', async () => {
    function first(el: Element): void { el.setAttribute('a', '1'); }
    function second(el: Element): void { el.setAttribute('b', '2'); }
    first(root); second(root);
    await flush();
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(2);
    expect(evs[0].source).toContain('first');
    expect(evs[1].source).toContain('second');
  });
  it('attributes both sides of a node move', async () => {
    const from = document.createElement('div'); from.id = 'from';
    const to = document.createElement('div'); to.id = 'to';
    document.body.append(from, to);
    const child = document.createElement('span');
    from.appendChild(child);
    await flush();
    store.reset(); log.clear();

    moveNode(to, child);
    await flush();
    const removal = store.events().find(e => e.target === from);
    const addition = store.events().find(e => e.target === to);
    expect(removal, 'removal from the old parent').toBeDefined();
    expect(addition, 'insertion into the new parent').toBeDefined();
    expect(addition!.source).toContain('moveNode');
    expect(removal!.source).toContain('moveNode');
  });
  it('leaves no record at all for a provably inert write', () => {
    libA_removeMissingAttribute(root);
    libA_emptyText(root);
    libA_emptyHtml(root);
    libA_removeUnsetProperty(root);
    expect(log.size).toBe(0);
    libB_setAttribute(root);
    expect(log.size).toBe(1);
  });
  it('keeps a reflow read charged to a write that never produced a mutation', async () => {
    // Safety net for writes this module cannot prove inert: the record stays unmatched,
    // and the hit charged to it must reach the element's real event instead of being
    // dropped when that record's `event` stays null forever.
    const rec = log.record(root, 'Error\n    at thrash (http://x/app.js:9:1)', { kind: 'attributes', attr: 'never-mutates' });
    rec.reflows.push({ api: 'offsetWidth', delay: 1, stack: [], source: 'app.js:9 thrash' });
    libB_setAttribute(root);
    await flush();
    const [ev] = store.eventsFor(root);
    expect(ev.source).toContain('libB_setAttribute');
    expect(ev.reflows.map(h => h.api)).toEqual(['offsetWidth']);
  });
});
