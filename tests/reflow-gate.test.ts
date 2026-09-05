import { describe, it, expect } from 'vitest';
import { installReflowPatches } from '../src/cost/reflow';
import { createObserver } from '../src/observer';
import { Store } from '../src/store';
import { WriteLog } from '../src/write-log';
import type { MutationKind } from '../src/types';

// The element-reflow path (installReflowPatches' onElement sink) has no notion of what is
// in scope -- it only knows the element whose layout was read. In production (src/index.ts)
// that sink is gated by observer.shouldTrack before it ever reaches Store.addElementReflow,
// which is the same isIgnored + include/exclude rule the mutation path (buildEvents) runs
// every target through. These tests wire the same primitives index.ts wires -- Store,
// WriteLog, installReflowPatches, createObserver -- directly, so the gate can be exercised
// and inspected without booting the full DomPulse overlay/HUD DOM.

const allKinds = () => new Set<MutationKind>(['childList', 'attributes', 'characterData']);

function wire(isIgnored: (n: Node) => boolean, include: string, exclude: string) {
  let t = 0;
  const store = new Store(100, 20);
  const log = new WriteLog(() => t, () => {});
  const observer = createObserver({ store, log, isIgnored }, { include, exclude, kinds: allKinds() });
  const restore = installReflowPatches(log, {
    onEvent: () => {},
    onElement: (el, hit, time) => { if (observer.shouldTrack(el)) store.addElementReflow(el, hit, time); },
  }, () => t);
  return {
    store, log, observer,
    setTime: (v: number) => { t = v; },
    getTime: () => t,
    cleanup: () => { restore(); observer.disconnect(); },
  };
}

describe('element-reflow path is gated like the mutation path', () => {
  it('reading DOM Pulse\'s own overlay canvas or HUD host creates no row and counts no reflow', () => {
    document.body.innerHTML = '';
    const hudHost = document.createElement('div'); hudHost.id = 'dp-hud';
    const overlayCanvas = document.createElement('canvas'); overlayCanvas.id = 'dp-overlay';
    const page = document.createElement('div'); page.id = 'page';
    document.body.append(hudHost, overlayCanvas, page);
    const isIgnored = (n: Node) => n === overlayCanvas || n === hudHost || hudHost.contains(n);
    const rig = wire(isIgnored, '', '');
    try {
      // A pending write elsewhere on the page is required for the read below to reach the
      // element-reflow path at all -- with nothing pending, `installReflowPatches` bails out
      // before ever asking whether the element is in scope (layout is clean, nothing to flush).
      rig.log.record(page, undefined);
      rig.setTime(5);
      void hudHost.offsetWidth;
      void overlayCanvas.getBoundingClientRect();
      expect(rig.store.elements()).toEqual([]);
      expect(rig.store.rates(rig.getTime())).toEqual({ mutations: 0, reflows: 0 });
    } finally {
      rig.cleanup();
      hudHost.remove(); overlayCanvas.remove(); page.remove();
    }
  });

  it('an include filter excludes an element outside it and still charges one inside it', () => {
    document.body.innerHTML = '';
    const inside = document.createElement('div'); inside.id = 'in';
    const outside = document.createElement('div'); outside.id = 'out';
    const other = document.createElement('div'); other.id = 'other';
    document.body.append(inside, outside, other);
    const rig = wire(() => false, '#in', '');
    try {
      rig.log.record(other, undefined);
      rig.setTime(2);
      void outside.offsetWidth;
      expect(rig.store.elements()).toEqual([]);
      expect(rig.store.rates(rig.getTime())).toEqual({ mutations: 0, reflows: 0 });

      rig.log.record(other, undefined);
      rig.setTime(4);
      void inside.offsetWidth;
      expect(rig.store.elements().map(s => s.element)).toEqual([inside]);
      expect(rig.store.stats(inside).reflows).toBe(1);
      expect(rig.store.rates(rig.getTime()).reflows).toBe(1);
    } finally {
      rig.cleanup();
      inside.remove(); outside.remove(); other.remove();
    }
  });
});
