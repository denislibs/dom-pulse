/** Counts events whose timestamp is within (now - windowMs, now]. */
export class SlidingCounter {
  private times: number[] = [];

  constructor(readonly windowMs: number) {}

  add(now: number): void { this.times.push(now); this.prune(now); }

  count(now: number): number { this.prune(now); return this.times.length; }

  clear(): void { this.times = []; }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.times.length && this.times[i] < cutoff) i++;
    if (i > 0) this.times.splice(0, i);
  }
}
