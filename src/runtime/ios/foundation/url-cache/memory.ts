const MAX_ENTRIES = 1024;
interface Entry<T> {
  value: T;
  cost: number;
}
export class MemoryURLCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private bytes = 0;
  private limit: number;
  constructor(capacity: number) {
    this.limit = this.validate(capacity);
  }
  get capacity(): number {
    return this.limit;
  }
  get usage(): number {
    return this.bytes;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  store(key: string, value: T, cost: number): T[] {
    this.validate(cost);
    if (!this.limit || cost > this.limit) return [value];
    const removed: T[] = [],
      previous = this.remove(key);
    if (previous !== undefined) removed.push(previous);
    this.entries.set(key, { value, cost });
    this.bytes += cost;
    return removed.concat(this.evict());
  }
  resize(capacity: number): T[] {
    this.limit = this.validate(capacity);
    return this.evict();
  }
  remove(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.bytes -= entry.cost;
    return entry.value;
  }
  clear(): T[] {
    const removed = Array.from(this.entries.values(), (entry) => entry.value);
    this.entries.clear();
    this.bytes = 0;
    return removed;
  }
  private evict(): T[] {
    const removed: T[] = [];
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.limit && this.entries.size <= MAX_ENTRIES && this.limit > 0) break;
      const value = this.remove(key);
      if (value !== undefined) removed.push(value);
    }
    return removed;
  }
  private validate(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid URL cache byte capacity.");
    return value;
  }
}
