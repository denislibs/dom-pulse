import type { PulseEvent } from '../src/types';

let id = 1;
export function makeEvent(target: Element, overrides: Partial<PulseEvent> = {}): PulseEvent {
  return {
    id: id++, time: 0, kind: 'attributes', target, node: target,
    diff: { kind: 'attribute', name: 'x', oldValue: null, newValue: '1' },
    stack: [], source: null, nodesAffected: 1, reflows: [], layoutShift: 0, shiftRects: [],
    ...overrides,
  };
}

/** Lets MutationObserver microtasks and timers run. */
export const flush = () => new Promise<void>(r => setTimeout(r, 0));
