export interface TableMemory {
  allocate(bytes: number): number;
  free(pointer: number): void;
}
const HANDLE_BYTES = 4;

/** Reference-counted Quartz objects behind guest handles. */
export class QuartzTable<T> {
  private readonly entries = new Map<number, { readonly value: T; refs: number }>();
  constructor(private readonly memory: TableMemory) {}
  add(value: T): number {
    const pointer = this.memory.allocate(HANDLE_BYTES);
    if (pointer) this.entries.set(pointer, { value, refs: 1 });
    return pointer;
  }
  get(pointer: number): T | undefined {
    return this.entries.get(pointer)?.value;
  }
  has(pointer: number): boolean {
    return this.entries.has(pointer);
  }
  refs(pointer: number): number | undefined {
    return this.entries.get(pointer)?.refs;
  }
  retain(pointer: number): number {
    const entry = this.entries.get(pointer);
    if (!entry) return 0;
    entry.refs++;
    return pointer;
  }
  release(pointer: number): void {
    const entry = this.entries.get(pointer);
    if (!entry || --entry.refs > 0) return;
    this.entries.delete(pointer);
    this.memory.free(pointer);
  }
}
