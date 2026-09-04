import { WriteLog } from '../write-log';
import { parseStack, sourceKey, INTERNAL_PREFIX } from '../stack';
import { isInternal } from '../internal';
import type { PulseEvent, ReflowHit } from '../types';

type Restore = () => void;

// Every DOM global is reached through a typeof guard: this module is pulled in by the
// package's ESM entry, which must be importable in Node (SSR bundles, tooling) without
// touching the DOM at module scope. Nothing below runs outside a browser.
const ELEMENT_PROTO: object | undefined = typeof Element !== 'undefined' ? Element.prototype : undefined;
const HTML_PROTO: object | undefined = typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : undefined;

/**
 * Unpatched references for DOM Pulse's own reads (overlay, HUD). Undefined outside a
 * browser, where nothing that uses them can run; typed as present so call sites stay
 * honest about the browser case.
 */
export const originals = {
  getBoundingClientRect: (typeof Element !== 'undefined' ? Element.prototype.getBoundingClientRect : undefined) as Element['getBoundingClientRect'],
  scrollIntoView: (typeof Element !== 'undefined' ? Element.prototype.scrollIntoView : undefined) as Element['scrollIntoView'] | undefined,
};

const GETTERS: Array<[object | undefined, string]> = [
  ...['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent'].map(n => [HTML_PROTO, n] as [object | undefined, string]),
  ...['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight'].map(n => [ELEMENT_PROTO, n] as [object | undefined, string]),
];
/** [owner, method, which argument holds the element being read -- none means `this`]. */
const METHODS: Array<[object | undefined, string, number?]> = [
  [ELEMENT_PROTO, 'getBoundingClientRect'],
  [ELEMENT_PROTO, 'getClientRects'],
  [ELEMENT_PROTO, 'scrollIntoView'],
  [HTML_PROTO, 'focus'],
];

/**
 * Patches the DOM's layout-reading APIs (offsetWidth & friends, getBoundingClientRect,
 * getComputedStyle, ...) so that a read occurring while `log` still holds this frame's
 * write records is recognized as a forced synchronous reflow. The hit is attached to
 * the newest write record for the element being read (or an ancestor or descendant of
 * it), falling back to the newest write of the frame when nothing is related; if that
 * record already carries a PulseEvent, `onHit` fires immediately so callers (e.g. the
 * overlay) can react without waiting for the next paint.
 *
 * As with the write patches, the original is always called first and its result returned
 * unchanged; DOM Pulse's own bookkeeping runs afterwards inside try/catch so a bug here can
 * never throw into page code. Every patched property is restored by the returned restore
 * function -- through defineProperty for the usual data/accessor properties, and through
 * the property's own setter for the accessor-backed method case described below.
 */
export function installReflowPatches(
  log: WriteLog,
  onHit: (ev: PulseEvent, hit: ReflowHit) => void,
  now: () => number = () => performance.now(),
): Restore {
  const restores: Restore[] = [];

  function read(api: string, subject: unknown): void {
    if (isInternal()) return;
    // Blame the element that was actually read: the newest write to it, an ancestor or
    // a descendant of it. Only when the read touches nothing written this frame does the
    // newest write of the frame remain the best guess.
    const node = typeof Node !== 'undefined' && subject instanceof Node ? subject : null;
    const rec = (node ? log.forRead(node) : null) ?? log.last();
    if (!rec) return;
    const stack = parseStack(new Error().stack);
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
    const get = { [key](this: any) { const v = originalGet.call(this); try { read(name, this); } catch { /* never break the page */ } return v; } }[key];
    Object.defineProperty(proto, name, { ...desc, get });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  function patchMethod(proto: object | undefined, name: string, argIndex?: number): void {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc) return;
    // The element being read is the receiver, except for free functions such as
    // getComputedStyle(el) where it is an argument.
    const subject = (self: any, args: any[]) => (argIndex === undefined ? self : args[argIndex]);
    // Normally a method is a plain data property (Element.prototype.getBoundingClientRect, ...).
    // Some test/runtime globals (e.g. vitest's jsdom `window.getComputedStyle`) instead expose
    // the function through a get/set accessor backed by a hidden slot; go through the setter in
    // that case rather than redefining the property, so unrelated attributes on it are untouched.
    if (typeof desc.value === 'function') {
      const original = desc.value as (...a: any[]) => any;
      const key = INTERNAL_PREFIX + name;
      const wrapper = { [key](this: any, ...args: any[]) { const v = original.apply(this, args); try { read(name, subject(this, args)); } catch { /* never break the page */ } return v; } }[key];
      Object.defineProperty(proto, name, { ...desc, value: wrapper });
      restores.push(() => Object.defineProperty(proto, name, desc));
      return;
    }
    if (typeof desc.get === 'function' && typeof desc.set === 'function') {
      const original = desc.get.call(proto);
      if (typeof original !== 'function') return;
      const key = INTERNAL_PREFIX + name;
      const wrapper = { [key](this: any, ...args: any[]) { const v = original.apply(this, args); try { read(name, subject(this, args)); } catch { /* never break the page */ } return v; } }[key];
      desc.set.call(proto, wrapper);
      restores.push(() => desc.set!.call(proto, original));
    }
  }

  for (const [proto, name] of GETTERS) patchGetter(proto, name);
  for (const [proto, name, argIndex] of METHODS) patchMethod(proto, name, argIndex);
  if (typeof window !== 'undefined') {
    // getComputedStyle is an own property of window in browsers and jsdom; fall back to Window.prototype.
    const gcsOwner = Object.getOwnPropertyDescriptor(window, 'getComputedStyle') ? window : Object.getPrototypeOf(window);
    patchMethod(gcsOwner, 'getComputedStyle', 0);
  }

  return () => { for (const r of restores.splice(0).reverse()) r(); };
}
