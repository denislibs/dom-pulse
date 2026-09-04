const ELEMENT = 1, TEXT = 3, COMMENT = 8;

export function describeNode(node: Node, maxText = 30): string {
  if (node.nodeType === ELEMENT) {
    const el = node as Element;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = el.getAttribute('class') ?? '';
    for (const c of cls.split(/\s+/).filter(Boolean).slice(0, 3)) s += '.' + c;
    const kids = el.querySelectorAll('*').length;
    if (kids > 0) s += ` (${kids})`;
    return s;
  }
  if (node.nodeType === TEXT) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return '"' + (t.length > maxText ? t.slice(0, maxText - 1) + '…' : t) + '"';
  }
  if (node.nodeType === COMMENT) return '<!-- -->';
  return node.nodeName.toLowerCase();
}

export function countNodes(nodes: Iterable<Node>): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.nodeType === ELEMENT) n += (node as Element).querySelectorAll('*').length;
  }
  return n;
}
