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
   * Second pass of a mutation batch: hand the reflow hits of writes that produced no
   * MutationRecord of their own to a real event, so they are not dropped when those
   * records' `event` stays null for the rest of the frame.
   *
   * Must run only once every record of the batch has been offered its mutation. Called
   * per event while the batch is still being built, it would rob the records that simply
   * have not been matched *yet*: a later write to the same element is still unmatched
   * while the earlier write's event is under construction, so its hits would land on the
   * earlier event and blame the wrong call site. After the matching pass, a record that
   * is merely waiting for its own event is `matched` and is skipped here.
   *
   * A hit only reaches a record while that record is the newest write related to the
   * element (see `forRead`), so the read provably happened after the orphan write, and
   * therefore after every write before it and before every write after it. The nearest
   * *earlier* write to the same target is the closest event that can have caused the
   * read, so it gets the hit. A later write is used only when the orphan precedes every
   * real write to that target and is thus the hit's only remaining home. Hits are moved
   * out of the record, so a second pass cannot deliver them twice.
   */
  drainOrphanReflows(): void {
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (r.matched || r.event || r.reflows.length === 0) continue;
      const host = this.nearestEvent(i, -1) ?? this.nearestEvent(i, 1);
      if (host) host.reflows.push(...r.reflows.splice(0));
    }
  }

  /** The event of the nearest record for the same target, scanning from `i` in `step`'s direction. */
  private nearestEvent(i: number, step: -1 | 1): PulseEvent | null {
    const { target } = this.records[i];
    for (let j = i + step; j >= 0 && j < this.records.length; j += step) {
      const r = this.records[j];
      if (r.target === target && r.event) return r.event;
    }
    return null;
  }

  last(): WriteRecord | null {
    return this.records.length ? this.records[this.records.length - 1] : null;
  }

  get size(): number { return this.records.length; }

  clear(): void { this.records = []; }
}
