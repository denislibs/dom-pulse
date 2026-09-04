import { WriteLog } from '../write-log';
import { parseStack, sourceKey, INTERNAL_PREFIX } from '../stack';
import { isInternal } from '../internal';
import type { PulseEvent, ReflowHit } from '../types';

type Restore = () => void;

/** Unpatched references for DOM Pulse's own reads (overlay, HUD). */
export const originals = {
  getBoundingClientRect: Element.prototype.getBoundingClientRect,
  scrollIntoView: Element.prototype.scrollIntoView as Element['scrollIntoView'] | undefined,
};

const GETTERS: Array<[object | undefined, string]> = [
  ...['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent'].map(n => [typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : undefined, n] as [object | undefined, string]),
  ...['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight'].map(n => [Element.prototype, n] as [object | undefined, string]),
];
const METHODS: Array<[object | undefined, string]> = [
  [Element.prototype, 'getBoundingClientRect'],
  [Element.prototype, 'getClientRects'],
  [Element.prototype, 'scrollIntoView'],
  [typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : undefined, 'focus'],
];

/**
 * Patches the DOM's layout-reading APIs (offsetWidth & friends, getBoundingClientRect,
 * getComputedStyle, ...) so that a read occurring while `log` still holds this frame's
 * write records is recognized as a forced synchronous reflow. The hit is attached to the
 * most recently written record; if that record already carries a PulseEvent, `onHit` fires
 * immediately so callers (e.g. the overlay) can react without waiting for the next paint.
 *
 * As with the write patches, the original is always called first and its result returned
 * unchanged; DOM Pulse's own bookkeeping runs afterwards inside try/catch so a bug here can
 * never throw into page code. Every patched property is restored to its original descriptor
 * by the returned restore function.
 */
export function installReflowPatches(
  log: WriteLog,
  onHit: (ev: PulseEvent, hit: ReflowHit) => void,
  selfFile?: string,
  now: () => number = () => performance.now(),
): Restore {
  const restores: Restore[] = [];

  function read(api: string): void {
    if (isInternal()) return;
    const rec = log.last();
    if (!rec) return;
    const stack = parseStack(new Error().stack, selfFile);
    const hit: ReflowHit = { api, delay: now() - rec.time, stack, source: sourceKey(stack) };
    rec.reflows.push(hit);
    if (rec.event) onHit(rec.event, hit);
  }

  function patchGetter(proto: object | undefined, name: string): void {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.get !== 'function') return;
    const originalGet = desc.get;
    const key = INTERNAL_PREFIX + name;
    const get = { [key](this: any) { const v = originalGet.call(this); try { read(name); } catch { /* never break the page */ } return v; } }[key];
    Object.defineProperty(proto, name, { ...desc, get });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  function patchMethod(proto: object | undefined, name: string): void {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc) return;
    // Normally a method is a plain data property (Element.prototype.getBoundingClientRect, ...).
    // Some test/runtime globals (e.g. vitest's jsdom `window.getComputedStyle`) instead expose
    // the function through a get/set accessor backed by a hidden slot; go through the setter in
    // that case rather than redefining the property, so unrelated attributes on it are untouched.
    if (typeof desc.value === 'function') {
      const original = desc.value as (...a: any[]) => any;
      const key = INTERNAL_PREFIX + name;
      const wrapper = { [key](this: any, ...args: any[]) { const v = original.apply(this, args); try { read(name); } catch { /* never break the page */ } return v; } }[key];
      Object.defineProperty(proto, name, { ...desc, value: wrapper });
      restores.push(() => Object.defineProperty(proto, name, desc));
      return;
    }
    if (typeof desc.get === 'function' && typeof desc.set === 'function') {
      const original = desc.get.call(proto);
      if (typeof original !== 'function') return;
      const key = INTERNAL_PREFIX + name;
      const wrapper = { [key](this: any, ...args: any[]) { const v = original.apply(this, args); try { read(name); } catch { /* never break the page */ } return v; } }[key];
      desc.set.call(proto, wrapper);
      restores.push(() => desc.set!.call(proto, original));
    }
  }

  for (const [proto, name] of GETTERS) patchGetter(proto, name);
  for (const [proto, name] of METHODS) patchMethod(proto, name);
  // getComputedStyle is an own property of window in browsers and jsdom; fall back to Window.prototype.
  const gcsOwner = Object.getOwnPropertyDescriptor(window, 'getComputedStyle') ? window : Object.getPrototypeOf(window);
  patchMethod(gcsOwner, 'getComputedStyle');

  return () => { for (const r of restores.splice(0).reverse()) r(); };
}
