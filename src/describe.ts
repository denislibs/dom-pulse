const ELEMENT = 1, TEXT = 3, COMMENT = 8;

/** A node's short signature plus how many nodes its subtree holds (itself included). */
export interface NodeSummary { signature: string; nodes: number }

/**
 * Describes a node and counts its subtree in a single pass. The descendant scan is
 * the expensive part (one querySelectorAll per node), and both the signature and the
 * node count need it, so callers that want both must go through here rather than
 * describing and counting separately.
 */
export function summarizeNode(node: Node, maxText = 30): NodeSummary {
  if (node.nodeType === ELEMENT) {
    const el = node as Element;
    const kids = el.querySelectorAll('*').length;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = el.getAttribute('class') ?? '';
    for (const c of cls.split(/\s+/).filter(Boolean).slice(0, 3)) s += '.' + c;
    if (kids > 0) s += ` (${kids})`;
    return { signature: s, nodes: kids + 1 };
  }
  if (node.nodeType === TEXT) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { signature: '"' + (t.length > maxText ? t.slice(0, maxText - 1) + '…' : t) + '"', nodes: 1 };
  }
  if (node.nodeType === COMMENT) return { signature: '<!-- -->', nodes: 1 };
  return { signature: node.nodeName.toLowerCase(), nodes: 1 };
}

export function describeNode(node: Node, maxText = 30): string {
  return summarizeNode(node, maxText).signature;
}
