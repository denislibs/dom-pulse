export class RingBuffer<T> {
  private items: T[] = [];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new RangeError('RingBuffer capacity must be >= 1');
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items.push(item);
      this.count++;
    } else {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  get size(): number { return this.count; }

  /** Oldest → newest. */
  toArray(): T[] {
    if (this.count < this.capacity) return this.items.slice();
    return this.items.slice(this.head).concat(this.items.slice(0, this.head));
  }

  clear(): void { this.items = []; this.head = 0; this.count = 0; }
}
