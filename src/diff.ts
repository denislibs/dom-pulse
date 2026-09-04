import type { AttributeDiff, TextDiff, ChildDiff, StyleChange } from './types';
import { describeNode } from './describe';

export function splitClasses(v: string | null): string[] {
  return (v ?? '').split(/\s+/).filter(Boolean);
}

export function parseStyle(v: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const decl of (v ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (prop) m.set(prop, val);
  }
  return m;
}

export function attributeDiff(name: string, oldValue: string | null, newValue: string | null): AttributeDiff {
  const d: AttributeDiff = { kind: 'attribute', name, oldValue, newValue };
  if (name === 'class') {
    const o = new Set(splitClasses(oldValue));
    const n = new Set(splitClasses(newValue));
    d.classAdded = [...n].filter(c => !o.has(c));
    d.classRemoved = [...o].filter(c => !n.has(c));
  } else if (name === 'style') {
    const o = parseStyle(oldValue);
    const n = parseStyle(newValue);
    const changes: StyleChange[] = [];
    for (const [p, v] of n) if (o.get(p) !== v) changes.push({ prop: p, oldValue: o.get(p) ?? null, newValue: v });
    for (const [p, v] of o) if (!n.has(p)) changes.push({ prop: p, oldValue: v, newValue: null });
    d.styleChanges = changes;
  }
  return d;
}

export function textDiff(oldValue: string, newValue: string): TextDiff {
  let start = 0;
  const max = Math.min(oldValue.length, newValue.length);
  while (start < max && oldValue[start] === newValue[start]) start++;
  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) { oldEnd--; newEnd--; }
  return { kind: 'text', oldValue, newValue, changeStart: start, oldEnd, newEnd };
}

export function childDiff(added: Iterable<Node>, removed: Iterable<Node>): ChildDiff {
  const a = [...added].map(n => describeNode(n));
  const r = [...removed].map(n => describeNode(n));
  const pool = new Map<string, number>();
  for (const s of r) pool.set(s, (pool.get(s) ?? 0) + 1);
  const recreated: string[] = [];
  for (const s of a) {
    const c = pool.get(s) ?? 0;
    if (c > 0) { recreated.push(s); pool.set(s, c - 1); }
  }
  return { kind: 'children', added: a, removed: r, recreated };
}
