import type { MutationKind, PulseEvent, ReflowHit } from './types';

/**
 * What kind of MutationRecord a write is expected to produce. Used to pair a
 * mutation with the write that actually caused it: several common writes produce
 * no MutationRecord at all (removeAttribute of an absent attribute, textContent
 * = '' on an empty node, insertAdjacentHTML(pos, ''), style.removeProperty of an
 * unset property), and without a hint such a no-op record would be handed to the
 * next genuine mutation and report the wrong call site.
 */
export interface WriteHint { kind: MutationKind; attr?: string | null }

export interface WriteRecord {
  target: Node;
  /** null for callers that do not know what the write will produce; matches anything. */
  hint: WriteHint | null;
  stack: string | undefined;
  time: number;
  reflows: ReflowHit[];
  event: PulseEvent | null;
  matched: boolean;
}

/** True when `rec` could plausibly have produced a mutation of this kind/attribute. */
function fits(rec: WriteRecord, kind: MutationKind | undefined, attr: string | null | undefined): boolean {
  const h = rec.hint;
  if (!h || kind === undefined) return true;
  if (h.kind !== kind) return false;
  if (kind !== 'attributes' || h.attr == null || attr == null) return true;
  // setAttribute lower-cases the name for HTML elements; compare case-insensitively.
  return h.attr.toLowerCase() === attr.toLowerCase();
}

/** DOM writes of the current frame. Cleared on the next animation frame. */
export class WriteLog {
  private records: WriteRecord[] = [];
  private frameScheduled = false;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void) => void = fn => requestAnimationFrame(fn),
    readonly max = 5000,
  ) {}

  record(target: Node, stack: string | undefined, hint: WriteHint | null = null): WriteRecord {
    const r: WriteRecord = { target, hint, stack, time: this.now(), reflows: [], event: null, matched: false };
    if (this.records.length >= this.max) this.records.shift();
    this.records.push(r);
    if (!this.frameScheduled) {
      this.frameScheduled = true;
      this.schedule(() => { this.frameScheduled = false; this.records = []; });
    }
    return r;
  }

  /**
   * The write that caused this mutation: the oldest unmatched record for the target
   * whose hint fits the mutation (writes to one target happen in order, so oldest
   * first keeps two real writes in their own order), skipping records that cannot
   * have produced it. Falls back to the newest already-matched fitting record, for
   * the case of one write producing several MutationRecords on the same target.
   */
  match(target: Node, kind?: MutationKind, attr?: string | null): WriteRecord | null {
    let fallback: WriteRecord | null = null;
    for (const r of this.records) {
      if (r.target !== target || !fits(r, kind, attr)) continue;
      if (!r.matched) { r.matched = true; return r; }
      fallback = r;
    }
    return fallback;
  }

  /**
   * The write a layout read should be blamed on: the newest record of this frame
   * whose target is the element being read, or an ancestor or descendant of it.
   * Callers fall back to `last()` when nothing is related.
   */
  forRead(node: Node): WriteRecord | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      const t = r.target;
      if (t === node || t.contains(node) || node.contains(t)) return r;
    }
    return null;
  }

  /**
   * Reflow hits recorded against writes for `target` that never produced a mutation
   * of their own (a no-op write, or one paired with a mutation elsewhere). Without
   * this the hit would sit on a record whose `event` stays null forever and be
   * dropped silently, so it is handed to the target's real event instead. The hits
   * are removed from those records so a second event cannot collect them again.
   */
  takeOrphanReflows(target: Node): ReflowHit[] {
    const out: ReflowHit[] = [];
    for (const r of this.records) {
      if (r.target !== target || r.matched || r.event || r.reflows.length === 0) continue;
      out.push(...r.reflows.splice(0));
    }
    return out;
  }

  last(): WriteRecord | null {
    return this.records.length ? this.records[this.records.length - 1] : null;
  }

  get size(): number { return this.records.length; }

  clear(): void { this.records = []; }
}
