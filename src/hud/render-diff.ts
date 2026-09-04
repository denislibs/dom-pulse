import type { Diff } from '../types';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

const nil = (v: string | null) => (v === null ? '∅' : escapeHtml(v));

function counted(list: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const s of list) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m.entries()];
}

export function renderDiff(d: Diff, context = 12): string {
  if (d.kind === 'attribute') {
    if (d.name === 'class' && d.classAdded && d.classRemoved) {
      const parts = [...d.classAdded.map(c => `<ins>+${escapeHtml(c)}</ins>`), ...d.classRemoved.map(c => `<del>−${escapeHtml(c)}</del>`)];
      return `<b>class</b> ${parts.join(' ') || '<i>no change</i>'}`;
    }
    if (d.name === 'style' && d.styleChanges) {
      const parts = d.styleChanges.map(c => `${escapeHtml(c.prop)}: <del>${nil(c.oldValue)}</del> → <ins>${nil(c.newValue)}</ins>`);
      return `<b>style</b> ${parts.join('; ') || '<i>no change</i>'}`;
    }
    return `<b>${escapeHtml(d.name)}</b> <del>${nil(d.oldValue)}</del> → <ins>${nil(d.newValue)}</ins>`;
  }
  if (d.kind === 'text') {
    const pre = d.oldValue.slice(Math.max(0, d.changeStart - context), d.changeStart);
    // Trailing window is one character wider than the leading one so that a boundary
    // character right after the change (e.g. a space) doesn't silently shrink the
    // amount of genuinely new trailing context shown to the reader.
    const post = d.oldValue.slice(d.oldEnd, d.oldEnd + context + 1);
    const oldMid = d.oldValue.slice(d.changeStart, d.oldEnd);
    const newMid = d.newValue.slice(d.changeStart, d.newEnd);
    const lead = d.changeStart > context ? '…' : '';
    const tail = d.oldEnd + context + 1 < d.oldValue.length ? '…' : '';
    return `<b>text</b> "${lead}${escapeHtml(pre)}<del>${escapeHtml(oldMid)}</del><ins>${escapeHtml(newMid)}</ins>${escapeHtml(post)}${tail}"`;
  }
  const parts: string[] = [];
  for (const [s, n] of counted(d.added)) parts.push(`<ins>+${escapeHtml(s)}${n > 1 ? ` ×${n}` : ''}</ins>`);
  for (const [s, n] of counted(d.removed)) parts.push(`<del>−${escapeHtml(s)}${n > 1 ? ` ×${n}` : ''}</del>`);
  if (d.recreated.length) parts.push(`<mark>↻ recreated ×${d.recreated.length}</mark>`);
  return `<b>children</b> ${parts.join(' ')}`;
}
