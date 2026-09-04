import { describe, it, expect } from 'vitest';
import { attributeDiff, textDiff, childDiff, parseStyle } from '../src/diff';

describe('attributeDiff', () => {
  it('reports plain attribute change', () => {
    expect(attributeDiff('href', '/a', '/b')).toEqual({ kind: 'attribute', name: 'href', oldValue: '/a', newValue: '/b' });
  });
  it('computes class add/remove', () => {
    const d = attributeDiff('class', 'a b', 'b c');
    expect(d.classAdded).toEqual(['c']);
    expect(d.classRemoved).toEqual(['a']);
  });
  it('treats null class as empty', () => {
    const d = attributeDiff('class', null, 'x');
    expect(d.classAdded).toEqual(['x']);
    expect(d.classRemoved).toEqual([]);
  });
  it('computes style property changes', () => {
    const d = attributeDiff('style', 'color: red; width: 1px', 'color: blue; height: 2px');
    expect(d.styleChanges).toEqual([
      { prop: 'color', oldValue: 'red', newValue: 'blue' },
      { prop: 'height', oldValue: null, newValue: '2px' },
      { prop: 'width', oldValue: '1px', newValue: null },
    ]);
  });
});

describe('parseStyle', () => {
  it('parses declarations and ignores junk', () => {
    expect([...parseStyle('a: 1; ; b:2;junk').entries()]).toEqual([['a', '1'], ['b', '2']]);
  });
});

describe('textDiff', () => {
  it('finds the changed span', () => {
    const d = textDiff('hello world', 'hello there world');
    expect(d).toMatchObject({ changeStart: 6, oldEnd: 6, newEnd: 12 });
  });
  it('handles replacement in the middle', () => {
    const d = textDiff('count: 41', 'count: 42');
    expect(d).toMatchObject({ changeStart: 8, oldEnd: 9, newEnd: 9 });
  });
  it('handles identical strings', () => {
    const d = textDiff('same', 'same');
    expect(d).toMatchObject({ changeStart: 4, oldEnd: 4, newEnd: 4 });
  });
});

describe('childDiff', () => {
  it('lists added and removed signatures and detects recreation', () => {
    const li1 = document.createElement('li'); li1.className = 'row';
    const li2 = document.createElement('li'); li2.className = 'row';
    const span = document.createElement('span');
    const d = childDiff([li2, span], [li1]);
    expect(d.added).toEqual(['li.row', 'span']);
    expect(d.removed).toEqual(['li.row']);
    expect(d.recreated).toEqual(['li.row']);
  });
  it('caps the retained signatures per side and keeps the totals exact', () => {
    const added = Array.from({ length: 50 }, () => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b>';
      return li;
    });
    const d = childDiff(added, []);
    expect(d.added).toHaveLength(20);
    expect(d.addedMore).toBe(30);
    expect(d.addedTotal).toBe(100); // 50 li + 50 b, counted for every node, not just the listed ones
    expect(d.removed).toEqual([]);
    expect(d.removedMore).toBe(0);
    expect(d.removedTotal).toBe(0);
  });
  it('recreation is a multiset match', () => {
    const mk = () => document.createElement('i');
    const d = childDiff([mk(), mk(), mk()], [mk()]);
    expect(d.recreated).toEqual(['i']);
  });
});
