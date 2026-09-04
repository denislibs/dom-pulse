import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWritePatches } from '../src/attribution';
import { WriteLog } from '../src/write-log';
import { withInternal } from '../src/internal';
import { INTERNAL_PREFIX } from '../src/stack';

let log: WriteLog;
let restore: () => void;
const origAppend = Node.prototype.appendChild;
const origInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;

beforeEach(() => { log = new WriteLog(() => 0, () => {}); restore = installWritePatches(log); });
afterEach(() => restore());

describe('installWritePatches', () => {
  it('records appendChild with the parent as target and returns the child', () => {
    const p = document.createElement('div'), c = document.createElement('span');
    expect(p.appendChild(c)).toBe(c);
    expect(log.last()?.target).toBe(p);
    expect(log.last()?.stack).toContain(INTERNAL_PREFIX + 'appendChild');
  });
  it('records remove() against the former parent', () => {
    const p = document.createElement('div'), c = document.createElement('span');
    p.appendChild(c); log.clear();
    c.remove();
    expect(log.last()?.target).toBe(p);
  });
  it('records innerHTML, textContent and data setters', () => {
    const el = document.createElement('div');
    el.innerHTML = '<b></b>';
    expect(log.last()?.target).toBe(el);
    el.textContent = 'x';
    expect(log.last()?.target).toBe(el);
    const t = el.firstChild as Text;
    t.data = 'y';
    expect(log.last()?.target).toBe(t);
    expect(el.textContent).toBe('y');
  });
  it('records setAttribute, className and classList against the element', () => {
    const el = document.createElement('div');
    el.setAttribute('a', '1'); expect(log.last()?.target).toBe(el);
    el.className = 'c'; expect(log.last()?.target).toBe(el);
    el.classList.add('d'); expect(log.last()?.target).toBe(el);
    expect(el.className).toBe('c d');
  });
  it('records style writes against the element', () => {
    const el = document.createElement('div');
    el.style.setProperty('color', 'red'); expect(log.last()?.target).toBe(el);
    el.style.cssText = 'width: 1px'; expect(log.last()?.target).toBe(el);
    expect(el.style.width).toBe('1px');
  });
  it('skips internal writes', () => {
    const el = document.createElement('div');
    withInternal(() => el.setAttribute('a', '1'));
    expect(log.size).toBe(0);
  });
  it('records outerHTML writes against the former parent and applies the replacement', () => {
    const p = document.createElement('div'), c = document.createElement('span');
    p.appendChild(c); log.clear();
    c.outerHTML = '<em class="repl"></em>';
    expect(log.last()?.target).toBe(p);
    expect(p.firstElementChild?.tagName).toBe('EM');
    expect(p.firstElementChild?.className).toBe('repl');
  });
  it('attributes insertAdjacentHTML by position: parent for beforebegin/afterend, self for afterbegin/beforeend', () => {
    const p = document.createElement('div'), el = document.createElement('span');
    p.appendChild(el);

    el.insertAdjacentHTML('beforebegin', '<i class="bb"></i>');
    expect(log.last()?.target).toBe(p);
    expect(p.firstElementChild?.className).toBe('bb');

    el.insertAdjacentHTML('afterend', '<i class="ae"></i>');
    expect(log.last()?.target).toBe(p);
    expect(p.lastElementChild?.className).toBe('ae');

    el.insertAdjacentHTML('afterbegin', '<i class="ab"></i>');
    expect(log.last()?.target).toBe(el);
    expect(el.firstElementChild?.className).toBe('ab');

    el.insertAdjacentHTML('beforeend', '<i class="be"></i>');
    expect(log.last()?.target).toBe(el);
    expect(el.lastElementChild?.className).toBe('be');

    // Position matching is ASCII-case-insensitive per the DOM spec.
    // The DOM accepts mixed-case keywords, but TypeScript's InsertPosition union only lists lowercase forms.
    el.insertAdjacentHTML('AfterEnd' as InsertPosition, '<i class="ae2"></i>');
    expect(log.last()?.target).toBe(p);
    expect(el.nextElementSibling?.className).toBe('ae2');
  });
  it('restore puts originals back', () => {
    restore();
    expect(Node.prototype.appendChild).toBe(origAppend);
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set).toBe(origInner.set);
    restore = () => {};
  });
});
