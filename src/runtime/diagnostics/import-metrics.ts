export interface ImportCounter {
  readonly name: string;
  calls: number;
}
const SNAPSHOT_LIMIT = 12;
export class ImportMetrics {
  private readonly counters = new Map<string, ImportCounter>();
  register(name: string): ImportCounter {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = { name, calls: 0 };
      this.counters.set(name, counter);
    }
    return counter;
  }
  snapshot(): ReadonlyArray<Readonly<ImportCounter>> {
    return [...this.counters.values()]
      .filter((counter) => counter.calls > 0)
      .sort((left, right) => right.calls - left.calls)
      .slice(0, SNAPSHOT_LIMIT)
      .map((counter) => ({ ...counter }));
  }
}
