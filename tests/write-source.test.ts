import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWritePatches } from '../src/attribution';
import { installReflowPatches } from '../src/cost/reflow';
import { createObserver } from '../src/observer';
import { Store } from '../src/store';
import { WriteLog } from '../src/write-log';
import { flush } from './helpers';
import type { MutationKind } from '../src/types';

// End-to-end attribution: real patched writes -> real MutationRecords -> events.
// The whole point of these cases is *which* call site each event is credited to,
// so every write below happens inside a distinctly named function.
let store: Store; let log: WriteLog; let obs: ReturnType<typeof createObserver>;
let restore: () => void; let restoreReflow: () => void; let root: HTMLElement;
const allKinds = () => new Set<MutationKind>(['childList', 'attributes', 'characterData']);

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root);
  store = new Store(100, 20);
  log = new WriteLog(() => 0, () => {});
  restore = installWritePatches(log);
  restoreReflow = installReflowPatches(log, (ev, hit) => store.addReflow(ev, hit), () => 0);
  obs = createObserver({ store, log, isIgnored: () => false, now: () => 0 }, { include: '', exclude: '', kinds: allKinds() });
});
afterEach(() => { obs.disconnect(); restoreReflow(); restore(); });

function libA_removeMissingAttribute(el: Element): void { el.removeAttribute('nonexistent'); }
function libB_setAttribute(el: Element): void { el.setAttribute('data-x', '1'); }
function libA_emptyText(el: Element): void { el.textContent = ''; }
function libA_emptyHtml(el: Element): void { el.insertAdjacentHTML('beforeend', ''); }
function libA_removeUnsetProperty(el: HTMLElement): void { el.style.removeProperty('color'); }
function libB_appendChild(parent: Element, child: Element): void { parent.appendChild(child); }
function moveNode(to: Element, child: Element): void { to.appendChild(child); }
function first(el: Element): void { el.setAttribute('a', '1'); }
function second(el: Element): void { el.setAttribute('b', '2'); }
function measure(el: HTMLElement): void { void el.offsetWidth; }
// replaceChildren() on a childless node mutates nothing, so it queues no MutationRecord --
// but it is not provably inert at call time (the node could have had children), so it does
// leave a write record behind. Exactly the shape the orphan mechanism exists for.
function libC_noopReplaceChildren(el: Element): void { el.replaceChildren(); }
/** What the Sources panel shows: forced reflows blamed on a call site. */
const reflowsOf = (key: string | null) => store.topSources(20).find(s => s.key === key)?.reflows ?? 0;

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
  it('charges a reflow to the write it followed, not to an earlier write of the same batch', async () => {
    // Two writes to one element in one batch, the layout read after the second. Both
    // records are claimed by their own mutation, so the hit belongs to the second event
    // and nothing may move it onto the first.
    first(root); second(root); measure(root);
    await flush();
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(2);
    expect(evs[0].source).toContain('first');
    expect(evs[1].source).toContain('second');
    expect(evs[0].reflows).toEqual([]);
    expect(evs[1].reflows.map(h => h.api)).toEqual(['offsetWidth']);
    // The Sources panel reads from here, so pin the user-visible blame too.
    expect(reflowsOf(evs[0].source)).toBe(0);
    expect(reflowsOf(evs[1].source)).toBe(1);
  });
  it('gives a genuine orphan hit to the newest event whose write precedes the read', async () => {
    // The read is charged to a write that produces no MutationRecord of its own, so it
    // must still surface. `first` and `second` both mutate; the orphan write sits after
    // both, so the read provably happened after `second` -- and after no later write.
    first(root); second(root); libC_noopReplaceChildren(root); measure(root);
    await flush();
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(2);
    expect(evs[1].source).toContain('second');
    expect(evs[1].reflows.map(h => h.api)).toEqual(['offsetWidth']);
    expect(evs[0].reflows).toEqual([]);
    expect(reflowsOf(evs[0].source)).toBe(0);
    expect(reflowsOf(evs[1].source)).toBe(1);
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
  it('counts an orphan hit drained onto an event pushed in an earlier batch', async () => {
    // One frame, two mutation batches. `first`'s event is already in the store by the time
    // the orphan write happens, so the drain cannot simply push onto that event's `reflows`
    // array: every counter (element stats, the Sources panel, the reflow rate) was fed by
    // Store.push at that point and would never see the hit.
    first(root);
    await flush();                    // batch 1: first's event is built and pushed
    libC_noopReplaceChildren(root);   // orphan write, queues no MutationRecord
    measure(root);                    // the read is charged to the orphan record
    second(root);
    await flush();                    // batch 2: the drain runs
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(2);
    expect(evs[0].source).toContain('first');
    expect(evs[1].source).toContain('second');
    // The nearest earlier write to the target hosts the hit -- and must be counted there.
    expect(evs[0].reflows.map(h => h.api)).toEqual(['offsetWidth']);
    expect(store.stats(root).reflows).toBe(1);
    expect(reflowsOf(evs[0].source)).toBe(1);
    expect(reflowsOf(evs[1].source)).toBe(0);
    expect(store.rates(0)).toEqual({ mutations: 2, reflows: 1 });
  });
  it('recovers a hostless orphan once an earlier write is retroactively matched', async () => {
    // Two hint-compatible no-op writes to one element: neither produces a MutationRecord,
    // so both stay unmatched and event-less after batch 1's drain -- there is no host for
    // either yet, so the read's hit (charged to the second, newer one by forRead) is left
    // in place rather than delivered. An unrelated mutation elsewhere closes batch 1 so the
    // drain actually runs. Batch 2 then does a real appendChild on the same element: match()
    // hands that MutationRecord to the OLDEST unmatched fitting record -- the *first* no-op
    // write -- not to the appendChild's own write record. That retroactively gives the first
    // write an event, which is an earlier host the second write's orphaned hit can now reach.
    // Losing this hit was the reported defect: at the previous commit `reflows` is 1, at the
    // regressed head (which flags a hostless record off after one miss) it is 0.
    libC_noopReplaceChildren(root);
    libC_noopReplaceChildren(root);
    measure(root);
    document.body.setAttribute('data-close-batch', '1'); // unrelated mutation, closes batch 1
    await flush();
    root.appendChild(document.createElement('i')); // batch 2: real mutation on root
    await flush();
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toContain('libC_noopReplaceChildren');
    expect(evs[0].reflows.map(h => h.api)).toEqual(['offsetWidth']);
    expect(store.stats(root).reflows).toBe(1);
    expect(reflowsOf(evs[0].source)).toBe(1);
  });
  it('counts a within-batch orphan hit exactly once', async () => {
    // The counterpart: both events are still under construction when the drain runs, so
    // Store.push applies their `reflows` itself. Routing a fresh event's orphan hits
    // through Store.addReflow as well would count this one twice.
    first(root); second(root); libC_noopReplaceChildren(root); measure(root);
    await flush();
    const evs = store.eventsFor(root);
    expect(evs).toHaveLength(2);
    expect(evs[0].reflows).toEqual([]);
    expect(evs[1].reflows.map(h => h.api)).toEqual(['offsetWidth']);
    expect(store.stats(root).reflows).toBe(1);
    expect(reflowsOf(evs[0].source)).toBe(0);
    expect(reflowsOf(evs[1].source)).toBe(1);
    expect(store.rates(0)).toEqual({ mutations: 2, reflows: 1 });
  });
});
