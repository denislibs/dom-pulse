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

/**
 * How far `nearestEvent` walks in each direction. A frame holds up to `max` records, and
 * a record for the same target further away than this is not a credible cause of the read
 * anyway; the bound keeps a pathological frame (thousands of unmatched writes) from turning
 * the drain into a full scan per orphan.
 */
const MAX_HOST_SCAN = 200;

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
   * real write to that target and is thus the hit's only remaining home.
   *
   * Known imprecision, deliberately kept: that forward fallback charges a write that ran
   * *after* the read, so its call site is blamed for a forced reflow it cannot have caused.
   * The alternative is dropping the hit entirely, which is the very thing this pass exists
   * to prevent, so the misattribution is accepted as best effort -- it is not a bug.
   *
   * Hits are handed to `deliver` and removed from the record, so a second pass cannot
   * deliver them twice. The caller decides how each host takes them: an event still being
   * built this batch has not reached the store yet, while one pushed in an earlier batch of
   * the same frame must go through `Store.addReflow` so the counters see the hit.
   *
   * A record for which no host exists in this batch is left alone and retried in later
   * batches of the same frame, not flagged off. `match()` hands a mutation to the OLDEST
   * unmatched record that fits it, so a record that produced no mutation of its own in this
   * batch can still be handed a later batch's MutationRecord for the same target, acquiring
   * an event it did not have here. That newly-matched record can then serve as an *earlier*
   * host for some other still-orphaned record on a subsequent call, so a record cannot be
   * permanently ruled out after one drain that merely found nothing yet.
   */
  drainOrphanReflows(deliver: (host: PulseEvent, hits: ReflowHit[]) => void): void {
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (r.matched || r.event || r.reflows.length === 0) continue;
      const host = this.nearestEvent(i, -1) ?? this.nearestEvent(i, 1);
      if (host) deliver(host, r.reflows.splice(0));
    }
  }

  /**
   * The event of the nearest record for the same target, scanning from `i` in `step`'s
   * direction and giving up after `MAX_HOST_SCAN` records.
   */
  private nearestEvent(i: number, step: -1 | 1): PulseEvent | null {
    const { target } = this.records[i];
    const stop = step < 0
      ? Math.max(-1, i - MAX_HOST_SCAN - 1)
      : Math.min(this.records.length, i + MAX_HOST_SCAN + 1);
    for (let j = i + step; j !== stop; j += step) {
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
