import { WriteLog } from './write-log';
import { INTERNAL_PREFIX } from './stack';
import { isInternal } from './internal';

type Restore = () => void;
type Pick = (self: any, args: any[]) => Node | null | undefined;

/**
 * Wraps every DOM write entry point so that each write leaves a WriteRecord with a stack.
 * Originals are always called first; DOM Pulse logic never throws into the page.
 */
export function installWritePatches(log: WriteLog): Restore {
  const restores: Restore[] = [];
  const owner = new WeakMap<object, Element>(); // DOMTokenList / CSSStyleDeclaration -> element

  function capture(target: Node | null | undefined): void {
    if (!target || isInternal()) return;
    log.record(target, new Error().stack);
  }

  function patchMethod(proto: object, name: string, pick: Pick): void {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as (...a: any[]) => any;
    const key = INTERNAL_PREFIX + name;
    const wrapper = {
      [key](this: any, ...args: any[]) {
        let target: Node | null | undefined;
        try { target = pick(this, args); } catch { target = null; }
        const result = original.apply(this, args);
        try { capture(target); } catch { /* never break the page */ }
        return result;
      },
    }[key];
    Object.defineProperty(proto, name, { ...desc, value: wrapper });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  function patchSetter(proto: object, name: string, pick: (self: any) => Node | null | undefined): void {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.set !== 'function') return;
    const originalSet = desc.set;
    const key = INTERNAL_PREFIX + name;
    const set = {
      [key](this: any, value: any) {
        originalSet.call(this, value);
        try { capture(pick(this)); } catch { /* never break the page */ }
      },
    }[key];
    Object.defineProperty(proto, name, { ...desc, set });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  /** Remembers which element a classList / style object belongs to. */
  function patchOwnerGetter(proto: object, name: string): void {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.get !== 'function') return;
    const originalGet = desc.get;
    const key = INTERNAL_PREFIX + name;
    const get = {
      [key](this: any) {
        const v = originalGet.call(this);
        try { if (v && typeof v === 'object' && !owner.has(v)) owner.set(v, this); } catch { /* ignore */ }
        return v;
      },
    }[key];
    Object.defineProperty(proto, name, { ...desc, get });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  const self = (s: any) => s as Node;
  const parent = (s: any) => (s as Node).parentNode;
  const ofOwner = (s: any) => owner.get(s) ?? null;

  const N = Node.prototype;
  const E = Element.prototype;
  for (const m of ['appendChild', 'insertBefore', 'removeChild', 'replaceChild']) patchMethod(N, m, self);
  for (const m of ['append', 'prepend', 'replaceChildren', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText']) patchMethod(E, m, self);
  patchMethod(E, 'remove', parent);
  for (const m of ['setAttribute', 'setAttributeNS', 'removeAttribute', 'removeAttributeNS', 'toggleAttribute']) patchMethod(E, m, self);
  patchSetter(E, 'innerHTML', self);
  patchSetter(E, 'outerHTML', parent);
  patchSetter(E, 'className', self);
  patchSetter(E, 'id', self);
  patchSetter(N, 'textContent', self);
  patchSetter(N, 'nodeValue', self);
  if (typeof CharacterData !== 'undefined') patchSetter(CharacterData.prototype, 'data', self);

  patchOwnerGetter(E, 'classList');
  if (typeof DOMTokenList !== 'undefined') {
    for (const m of ['add', 'remove', 'toggle', 'replace']) patchMethod(DOMTokenList.prototype, m, ofOwner);
  }
  if (typeof HTMLElement !== 'undefined') patchOwnerGetter(HTMLElement.prototype, 'style');
  if (typeof SVGElement !== 'undefined') patchOwnerGetter(SVGElement.prototype, 'style');
  if (typeof CSSStyleDeclaration !== 'undefined') {
    const CSD = CSSStyleDeclaration.prototype;
    for (const m of ['setProperty', 'removeProperty']) patchMethod(CSD, m, ofOwner);
    for (const name of Object.getOwnPropertyNames(CSD)) {
      const d = Object.getOwnPropertyDescriptor(CSD, name);
      if (d && typeof d.set === 'function' && typeof d.get === 'function') patchSetter(CSD, name, ofOwner);
    }
  }

  return () => { for (const r of restores.splice(0).reverse()) r(); };
}
