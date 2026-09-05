import { describe, it, expect } from 'vitest';
import { describeNode, summarizeNode } from '../src/describe';

describe('describeNode', () => {
  it('describes an element with id, up to 3 classes and descendant count', () => {
    const el = document.createElement('div');
    el.id = 'app'; el.className = 'a b c d';
    el.innerHTML = '<ul><li></li><li></li></ul>';
    expect(describeNode(el)).toBe('div#app.a.b.c (3)');
  });
  it('omits count for leaf elements', () => {
    const el = document.createElement('span');
    expect(describeNode(el)).toBe('span');
  });
  it('describes text nodes trimmed and truncated', () => {
    const t = document.createTextNode('  hello   world  ');
    expect(describeNode(t)).toBe('"hello world"');
    const long = document.createTextNode('x'.repeat(50));
    expect(describeNode(long)).toBe('"' + 'x'.repeat(29) + '…"');
  });
  it('describes comments and other nodes', () => {
    expect(describeNode(document.createComment('c'))).toBe('<!-- -->');
    expect(describeNode(document.createDocumentFragment())).toBe('#document-fragment');
  });
});

describe('summarizeNode', () => {
  it('returns the signature and the subtree size from one scan', () => {
    const a = document.createElement('div');
    a.innerHTML = '<p><b></b></p>';
    expect(summarizeNode(a)).toEqual({ signature: 'div (2)', nodes: 3 });
    expect(summarizeNode(document.createTextNode('x'))).toEqual({ signature: '"x"', nodes: 1 });
  });
  it('describeNode is its signature', () => {
    const el = document.createElement('span');
    expect(describeNode(el)).toBe(summarizeNode(el).signature);
  });
});
