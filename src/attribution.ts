import { WriteLog, type WriteHint } from './write-log';
import { INTERNAL_PREFIX } from './stack';
import { isInternal } from './internal';

type Restore = () => void;
/** Picks the node (or nodes) a write mutates. Runs before the write, read-only. */
type TargetPicker = (self: any, args: any[]) => Node | null | undefined | Array<Node | null | undefined>;
/** Says what kind of MutationRecord the write is expected to produce, per target. */
type HintPicker = (target: Node, args: any[]) => WriteHint;
/**
 * True when this call provably cannot produce a MutationRecord. Runs before the write.
 * Only writes that are certainly inert belong here: a record left behind by a write
 * that mutated nothing would be handed to somebody else's mutation later and report
 * the wrong call site. Writes that merely *look* redundant (setAttribute with the same
 * value, classList.remove of an absent class, setting the same character data) do queue
 * a record per spec, so they are not listed.
 */
type NoopCheck = (self: any, args: any[]) => boolean;

const TEXT = 3, CDATA = 4, COMMENT = 8;
const isCharacterData = (n: Node): boolean => n.nodeType === TEXT || n.nodeType === CDATA || n.nodeType === COMMENT;
/** MutationRecord.attributeName is the local name, so drop any namespace prefix. */
const localName = (v: unknown): string => String(v).split(':').pop() ?? '';

const children: HintPicker = () => ({ kind: 'childList' });
const attrNamed = (name: string): HintPicker => () => ({ kind: 'attributes', attr: name });
const attrAt = (i: number): HintPicker => (_t, args) => ({ kind: 'attributes', attr: localName(args[i]) });
/** textContent / nodeValue mutate character data on a text node and children on an element. */
const textOrChildren: HintPicker = t => ({ kind: isCharacterData(t) ? 'characterData' : 'childList' });

/**
 * Wraps every DOM write entry point so that each write leaves a WriteRecord with a stack.
 * The target picker always runs first, read-only, before the write happens (some writes,
 * like assigning outerHTML, detach the node and make the target unrecoverable afterwards).
 * The original is then called and its result returned unchanged, and DOM Pulse's own
 * logic runs afterwards inside try/catch; DOM Pulse never throws into the page.
 *
 * Each record also carries a hint (what kind of MutationRecord this write should produce)
 * so that a write which turns out to be a no-op cannot be handed to somebody else's
 * mutation later -- see WriteLog.match.
 */
export function installWritePatches(log: WriteLog): Restore {
  const restores: Restore[] = [];
  const owner = new WeakMap<object, Element>(); // DOMTokenList / CSSStyleDeclaration -> element

  function capture(picked: ReturnType<TargetPicker>, hint: HintPicker, args: any[]): void {
    if (isInternal()) return;
    const stack = new Error().stack;
    const targets = Array.isArray(picked) ? picked : [picked];
    let recorded: Node | null = null;
    for (const t of targets) {
      if (!t || t === recorded) continue;
      recorded = t;
      log.record(t, stack, hint(t, args));
    }
  }

  function patchMethod(proto: object, name: string, pick: TargetPicker, hint: HintPicker, noop?: NoopCheck): void {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as (...a: any[]) => any;
    const key = INTERNAL_PREFIX + name;
    const wrapper = {
      [key](this: any, ...args: any[]) {
        let target: ReturnType<TargetPicker>;
        let inert = false;
        try { target = pick(this, args); inert = noop !== undefined && noop(this, args); } catch { target = null; }
        const result = original.apply(this, args);
        try { if (!inert) capture(target, hint, args); } catch { /* never break the page */ }
        return result;
      },
    }[key];
    Object.defineProperty(proto, name, { ...desc, value: wrapper });
    restores.push(() => Object.defineProperty(proto, name, desc));
  }

  function patchSetter(proto: object, name: string, pick: (self: any) => Node | null | undefined, hint: HintPicker, noop?: NoopCheck): void {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.set !== 'function') return;
    const originalSet = desc.set;
    const key = INTERNAL_PREFIX + name;
    const set = {
      [key](this: any, value: any) {
        let target: Node | null | undefined;
        let inert = false;
        try { target = pick(this); inert = noop !== undefined && noop(this, [value]); } catch { target = null; }
        originalSet.call(this, value);
        try { if (!inert) capture(target, hint, [value]); } catch { /* never break the page */ }
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
  // Moving a node emits two MutationRecords -- a removal from the old parent and an
  // insertion into the new one -- from a single call. Record the child's current parent
  // as well, otherwise the removal side has no write record and reports no source.
  const selfAndOldParent = (i: number) => (s: any, args: any[]) => [s as Node, (args[i] as Node | null | undefined)?.parentNode];
  // beforebegin/afterend insert into the parent's child list per spec; the other two
  // positions insert into the element's own child list. Keyword matching is ASCII-case-insensitive.
  const adjacent = (s: any, args: any[]) => {
    const pos = String(args[0]).toLowerCase();
    return pos === 'beforebegin' || pos === 'afterend' ? (s as Node).parentNode : (s as Node);
  };

  // Provably inert writes -- these are the common ones that leave a record behind
  // without ever producing a MutationRecord.
  // `innerHTML` is [LegacyNullToEmptyString] DOMString, so only null becomes ''; undefined
  // stringifies to the text "undefined" and inserts a node (verified in Chrome 148 and in
  // jsdom). `textContent` and `nodeValue` are nullable, so undefined clears them like null.
  const emptyHtml = (v: unknown): boolean => v === '' || v === null;
  const empty = (v: unknown): boolean => emptyHtml(v) || v === undefined;
  const noAttribute: NoopCheck = (s, a) => !(s as Element).hasAttribute(String(a[0]));
  const noAttributeNS: NoopCheck = (s, a) => !(s as Element).hasAttributeNS((a[0] as string | null) ?? null, String(a[1]));
  const emptyHtmlArg: NoopCheck = (_s, a) => a[1] === '';
  // Replacing the children of a childless node with nothing queues no record.
  const clearingEmptyNode: NoopCheck = (s, a) => empty(a[0]) && !isCharacterData(s as Node) && (s as Node).firstChild === null;
  /** Same, for innerHTML, which is never character data and does not clear on undefined. */
  const clearingEmptyHtml: NoopCheck = (s, a) => emptyHtml(a[0]) && (s as Node).firstChild === null;
  const unsetProperty: NoopCheck = (s, a) => (s as CSSStyleDeclaration).getPropertyValue(String(a[0])) === '';

  const N = Node.prototype;
  const E = Element.prototype;
  for (const m of ['appendChild', 'insertBefore', 'replaceChild']) patchMethod(N, m, selfAndOldParent(0), children);
  patchMethod(N, 'removeChild', self, children);
  for (const m of ['append', 'prepend', 'replaceChildren']) patchMethod(E, m, self, children);
  patchMethod(E, 'insertAdjacentHTML', adjacent, children, emptyHtmlArg);
  for (const m of ['insertAdjacentElement', 'insertAdjacentText']) patchMethod(E, m, adjacent, children);
  patchMethod(E, 'remove', parent, children);
  for (const m of ['setAttribute', 'toggleAttribute']) patchMethod(E, m, self, attrAt(0));
  patchMethod(E, 'removeAttribute', self, attrAt(0), noAttribute);
  patchMethod(E, 'setAttributeNS', self, attrAt(1));
  patchMethod(E, 'removeAttributeNS', self, attrAt(1), noAttributeNS);
  patchSetter(E, 'innerHTML', self, children, clearingEmptyHtml);
  patchSetter(E, 'outerHTML', parent, children);
  patchSetter(E, 'className', self, attrNamed('class'));
  patchSetter(E, 'id', self, attrNamed('id'));
  patchSetter(N, 'textContent', self, textOrChildren, clearingEmptyNode);
  patchSetter(N, 'nodeValue', self, textOrChildren, clearingEmptyNode);
  if (typeof CharacterData !== 'undefined') patchSetter(CharacterData.prototype, 'data', self, () => ({ kind: 'characterData' }));

  patchOwnerGetter(E, 'classList');
  if (typeof DOMTokenList !== 'undefined') {
    // Only classList registers an owner above, so every attributed token-list write is a class write.
    for (const m of ['add', 'remove', 'toggle', 'replace']) patchMethod(DOMTokenList.prototype, m, ofOwner, attrNamed('class'));
  }
  if (typeof HTMLElement !== 'undefined') patchOwnerGetter(HTMLElement.prototype, 'style');
  if (typeof SVGElement !== 'undefined') patchOwnerGetter(SVGElement.prototype, 'style');
  if (typeof CSSStyleDeclaration !== 'undefined') {
    const CSD = CSSStyleDeclaration.prototype;
    patchMethod(CSD, 'setProperty', ofOwner, attrNamed('style'));
    patchMethod(CSD, 'removeProperty', ofOwner, attrNamed('style'), unsetProperty);
    // Browser matrix for a direct named style write (`el.style.color = 'red'`).
    // This loop patches every get+set accessor pair it finds on the prototype, and
    // unpatches them again on stop; how many that is depends entirely on the engine:
    //   - engines that expose the ~700 named CSS property setters on
    //     CSSStyleDeclaration.prototype (the historical Blink/WebKit layout) are fully
    //     covered, at the price of redefining ~700 accessors per start/stop cycle,
    //     which is then the bulk of the cost of both operations;
    //   - Chrome 148 (measured) exposes only cssText and cssFloat there and serves the
    //     named properties as per-instance own properties, so 2 accessors are patched;
    //   - Gecko puts the named setters on CSS2Properties.prototype and jsdom serves
    //     them from a per-instance Proxy, so neither is reached either.
    // Where they are not reached, a named style write still behaves exactly as it
    // would without DOM Pulse and its mutation is still recorded -- it just degrades
    // to "unknown source". setProperty / removeProperty / cssText / classList /
    // setAttribute('style') are attributed on every engine.
    for (const name of Object.getOwnPropertyNames(CSD)) {
      const d = Object.getOwnPropertyDescriptor(CSD, name);
      if (d && typeof d.set === 'function' && typeof d.get === 'function') patchSetter(CSD, name, ofOwner, attrNamed('style'));
    }
  }

  return () => { for (const r of restores.splice(0).reverse()) r(); };
}
