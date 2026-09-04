import type { PulseEvent, ReflowHit } from './types';

export interface WriteRecord {
  target: Node;
  stack: string | undefined;
  time: number;
  reflows: ReflowHit[];
  event: PulseEvent | null;
  matched: boolean;
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

  record(target: Node, stack: string | undefined): WriteRecord {
    const r: WriteRecord = { target, stack, time: this.now(), reflows: [], event: null, matched: false };
    if (this.records.length >= this.max) this.records.shift();
    this.records.push(r);
    if (!this.frameScheduled) {
      this.frameScheduled = true;
      this.schedule(() => { this.frameScheduled = false; this.records = []; });
    }
    return r;
  }

  match(target: Node): WriteRecord | null {
    let newest: WriteRecord | null = null;
    for (const r of this.records) {
      if (r.target !== target) continue;
      if (!r.matched) { r.matched = true; return r; }
      newest = r;
    }
    return newest;
  }

  last(): WriteRecord | null {
    return this.records.length ? this.records[this.records.length - 1] : null;
  }

  get size(): number { return this.records.length; }

  clear(): void { this.records = []; }
}
