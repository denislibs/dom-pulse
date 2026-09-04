import { Store } from './store';
import { WriteLog } from './write-log';
import { attributeDiff, textDiff, childDiff } from './diff';
import { countNodes } from './describe';
import { parseStack, sourceKey } from './stack';
import { warnOnce } from './warn';
import type { Diff, MutationKind, PulseEvent } from './types';

export interface ObserverFilters { include: string; exclude: string; kinds: Set<MutationKind> }
export interface ObserverDeps {
  store: Store;
  log: WriteLog;
  selfFile?: string;
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

/** oldValue of the next record in this batch for the same target (and attribute), or undefined. */
function lookahead(records: MutationRecord[], i: number, pred: (r: MutationRecord) => boolean): string | null | undefined {
  for (let j = i + 1; j < records.length; j++) if (pred(records[j])) return records[j].oldValue;
  return undefined;
}

export function buildEvents(records: MutationRecord[], deps: ObserverDeps, filters: ObserverFilters): PulseEvent[] {
  const now = (deps.now ?? (() => performance.now()))();
  const out: PulseEvent[] = [];
  records.forEach((rec, i) => {
    const kind = rec.type as MutationKind;
    if (!filters.kinds.has(kind)) return;
    const target = elementFor(rec.target);
    if (!target || deps.isIgnored(target)) return;
    if (kind === 'childList') {
      const touched = [...rec.addedNodes, ...rec.removedNodes];
      if (touched.length > 0 && touched.every(deps.isIgnored)) return;
    }
    if (filters.include && !matches(target, filters.include)) return;
    if (filters.exclude && matches(target, filters.exclude)) return;

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
      diff = childDiff(rec.addedNodes, rec.removedNodes);
      nodesAffected = countNodes(rec.addedNodes) + countNodes(rec.removedNodes);
    }

    const w = deps.log.match(rec.target);
    const stack = w ? parseStack(w.stack, deps.selfFile) : [];
    const ev: PulseEvent = {
      id: nextId++, time: now, kind, target, node: rec.target, diff, stack, source: sourceKey(stack),
      nodesAffected, reflows: w ? w.reflows.slice() : [], layoutShift: 0, shiftRects: [],
    };
    if (w) w.event = ev;
    out.push(ev);
  });
  return out;
}

export function createObserver(deps: ObserverDeps, initial: ObserverFilters) {
  let filters: ObserverFilters = { ...initial };
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
    setFilters(f: Partial<ObserverFilters>) { filters = { ...filters, ...f }; },
    disconnect() { mo.disconnect(); },
  };
}
