import { Store } from './store';
import { WriteLog } from './write-log';
import { attributeDiff, textDiff, childDiff } from './diff';
import { parseStack, sourceKey } from './stack';
import { warnOnce } from './warn';
import type { Diff, MutationKind, PulseEvent } from './types';

export interface ObserverFilters { include: string; exclude: string; kinds: Set<MutationKind> }
export interface ObserverDeps {
  store: Store;
  log: WriteLog;
  isIgnored: (node: Node) => boolean;
  now?: () => number;
}

let nextId = 1;
const ELEMENT = 1, DOCUMENT = 9, FRAGMENT = 11;

function elementFor(node: Node): Element | null {
  if (node.nodeType === ELEMENT) return node as Element;
  if (node.nodeType === DOCUMENT) return (node as Document).documentElement;
  if (node.nodeType === FRAGMENT) return null;
  return node.parentElement;
}

function matches(el: Element, selector: string): boolean {
  try { return el.closest(selector) !== null; } catch { return false; }
}

function isValidSelector(selector: string): boolean {
  try { document.createElement('div').matches(selector); return true; } catch { return false; }
}

/**
 * Filters are user input (the HUD's include/exclude boxes), so a typo like ".foo:" is
 * expected. An invalid selector is reported once and then dropped: `include` used to
 * fail closed -- every event was filtered out and DOM Pulse went silent with no
 * warning -- while `exclude` failed open. Both now fail open, so a bad selector costs
 * you the filter, never the tool.
 */
function validate(f: Partial<ObserverFilters>): Partial<ObserverFilters> {
  const out = { ...f };
  for (const which of ['include', 'exclude'] as const) {
    const sel = out[which];
    if (!sel) continue;
    if (isValidSelector(sel)) continue;
    warnOnce(`filter:${which}`, new Error(`invalid ${which} selector, ignoring it: ${sel}`));
    out[which] = '';
  }
  return out;
}

/** oldValue of the next record in this batch for the same target (and attribute), or undefined. */
function lookahead(records: MutationRecord[], i: number, pred: (r: MutationRecord) => boolean): string | null | undefined {
  for (let j = i + 1; j < records.length; j++) if (pred(records[j])) return records[j].oldValue;
  return undefined;
}

/**
 * Whether `el` is in scope for DOM Pulse at all: not one of DOM Pulse's own nodes, and
 * matching the current include/exclude filters. This is the single gate the mutation
 * path runs every target through, and the element-reflow path (installed in index.ts)
 * reuses it via `shouldTrack` on the observer instance below -- so the HUD's filter
 * boxes and the "never observe our own UI" rule apply identically to both the mutation
 * events a write produces and the element rows a bare forced-layout read can create.
 */
function isTracked(el: Element, isIgnored: (node: Node) => boolean, filters: ObserverFilters): boolean {
  if (isIgnored(el)) return false;
  if (filters.include && !matches(el, filters.include)) return false;
  if (filters.exclude && matches(el, filters.exclude)) return false;
  return true;
}

export function buildEvents(records: MutationRecord[], deps: ObserverDeps, filters: ObserverFilters): PulseEvent[] {
  const now = (deps.now ?? (() => performance.now()))();
  const out: PulseEvent[] = [];
  records.forEach((rec, i) => {
    const kind = rec.type as MutationKind;
    if (!filters.kinds.has(kind)) return;
    const target = elementFor(rec.target);
    if (!target || !isTracked(target, deps.isIgnored, filters)) return;
    if (kind === 'childList') {
      const touched = [...rec.addedNodes, ...rec.removedNodes];
      if (touched.length > 0 && touched.every(deps.isIgnored)) return;
    }

    let diff: Diff;
    let nodesAffected: number;
    if (kind === 'attributes') {
      const name = rec.attributeName ?? '';
      const la = lookahead(records, i, r => r.type === 'attributes' && r.target === rec.target && r.attributeName === name);
      const newValue = la === undefined ? target.getAttribute(name) : la;
      diff = attributeDiff(name, rec.oldValue, newValue);
      nodesAffected = 1;
    } else if (kind === 'characterData') {
      const la = lookahead(records, i, r => r.type === 'characterData' && r.target === rec.target);
      const newValue = la === undefined ? ((rec.target as CharacterData).data ?? '') : (la ?? '');
      diff = textDiff(rec.oldValue ?? '', newValue);
      nodesAffected = 1;
    } else {
      const cd = childDiff(rec.addedNodes, rec.removedNodes);
      diff = cd;
      nodesAffected = cd.addedTotal + cd.removedTotal;
    }

    const w = deps.log.match(rec.target, kind, kind === 'attributes' ? rec.attributeName : null);
    const stack = w ? parseStack(w.stack) : [];
    const ev: PulseEvent = {
      id: nextId++, time: now, kind, target, node: rec.target, diff, stack, source: sourceKey(stack),
      nodesAffected,
      reflows: w ? [...w.reflows] : [],
      layoutShift: 0, shiftRects: [],
    };
    if (w) w.event = ev;
    out.push(ev);
  });
  // Only now that every record of the batch has been offered its mutation is it safe to
  // move hits off the records that never got one: doing it while events are still being
  // built would take them from writes that are merely not matched yet. See
  // WriteLog.drainOrphanReflows.
  //
  // A write log spans a whole animation frame, which normally holds several mutation
  // batches, so the host of an orphan hit is often an event pushed in an earlier batch.
  // Only the events built above are still on their way to the store, where Store.push
  // applies `ev.reflows` itself; those take their hits directly, and anything else has to
  // go through Store.addReflow, or the hit reaches no counter and nothing re-renders.
  const fresh = new Set(out);
  deps.log.drainOrphanReflows((host, hits) => {
    if (fresh.has(host)) host.reflows.push(...hits);
    else for (const hit of hits) deps.store.addReflow(host, hit);
  });
  return out;
}

export function createObserver(deps: ObserverDeps, initial: ObserverFilters) {
  let filters: ObserverFilters = { ...initial, ...validate(initial) };
  const mo = new MutationObserver(records => {
    try {
      for (const ev of buildEvents(records, deps, filters)) deps.store.push(ev);
    } catch (e) { warnOnce('observer', e); }
  });
  mo.observe(document.documentElement, {
    childList: true, attributes: true, characterData: true, subtree: true,
    attributeOldValue: true, characterDataOldValue: true,
  });
  return {
    setFilters(f: Partial<ObserverFilters>) { filters = { ...filters, ...f, ...validate(f) }; },
    disconnect() { mo.disconnect(); },
    /**
     * Whether `el` is in scope under the observer's current isIgnored + include/exclude
     * state -- the same predicate `buildEvents` runs every mutation target through, kept
     * live across `setFilters`. Callers outside the observer (the element-reflow sink in
     * index.ts) use this instead of re-deriving the rule, so there is exactly one place
     * that knows what "in scope" means.
     */
    shouldTrack(el: Element): boolean { return isTracked(el, deps.isIgnored, filters); },
  };
}
