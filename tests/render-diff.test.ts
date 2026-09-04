import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderDiff, escapeHtml } from '../src/hud/render-diff';
import { attributeDiff, textDiff, childDiff } from '../src/diff';
import { drawSparkline } from '../src/hud/sparkline';

// jsdom has no real canvas backend: `canvas.getContext('2d')` is expected to
// return null (the exact behavior this module is built to tolerate), but
// jsdom's own implementation also logs a "Not implemented" warning as a side
// effect of that. Stub the method to return null directly so the module sees
// the same null context without the unrelated console noise.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalGetContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('escapeHtml', () => {
  it('escapes', () => { expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;'); });
});

describe('renderDiff', () => {
  it('renders class changes', () => {
    expect(renderDiff(attributeDiff('class', 'a b', 'b c'))).toBe('<b>class</b> <ins>+c</ins> <del>−a</del>');
  });
  it('renders style changes', () => {
    expect(renderDiff(attributeDiff('style', 'color: red', 'color: blue'))).toBe('<b>style</b> color: <del>red</del> → <ins>blue</ins>');
  });
  it('renders plain attributes with ∅ for null and escapes', () => {
    expect(renderDiff(attributeDiff('data-x', null, '<b>'))).toBe('<b>data-x</b> <del>∅</del> → <ins>&lt;b&gt;</ins>');
  });
  it('renders text with context and ellipses', () => {
    const d = textDiff('0123456789abcdefghij count: 41 0123456789abcdefghij', '0123456789abcdefghij count: 42 0123456789abcdefghij');
    expect(renderDiff(d)).toBe('<b>text</b> "…hij count: 4<del>1</del><ins>2</ins> 0123456789ab…"');
  });
  it('renders children with counts and recreation', () => {
    const li = () => document.createElement('li');
    const d = childDiff([li(), li()], [li()]);
    expect(renderDiff(d)).toBe('<b>children</b> <ins>+li ×2</ins> <del>−li</del> <mark>↻ recreated ×1</mark>');
  });
});

describe('drawSparkline', () => {
  it('does not throw without a 2d context', () => {
    const c = document.createElement('canvas');
    expect(() => drawSparkline(c, [1, 2, 3])).not.toThrow();
  });
});
