interface SymbolLocation {
  readonly name: string;
  readonly offset: number;
}
interface Sample {
  readonly thread: number;
  readonly symbol: string;
  readonly address: number;
  samples: number;
}
const HEXADECIMAL = 16;
const SNAPSHOT_LIMIT = 12;
export const ExecutionMetricLimit = { Samples: 4096 };
export class ExecutionMetrics {
  private readonly samples = new Map<string, Sample>();
  private readonly recent: (string | undefined)[] = [];
  private cursor = 0;
  sample(thread: number, pc: number, symbol?: SymbolLocation): void {
    const address = symbol ? pc - symbol.offset : pc;
    const name = symbol?.name ?? `0x${address.toString(HEXADECIMAL)}`;
    const key = `${thread}:${address}`;
    const expiredKey = this.recent[this.cursor];
    const expired = expiredKey === undefined ? undefined : this.samples.get(expiredKey);
    if (expired && --expired.samples === 0 && expiredKey !== undefined)
      this.samples.delete(expiredKey);
    this.recent[this.cursor] = key;
    this.cursor = (this.cursor + 1) % ExecutionMetricLimit.Samples;
    const previous = this.samples.get(key);
    if (previous) previous.samples++;
    else this.samples.set(key, { thread, symbol: name, address, samples: 1 });
  }
  get sampleCount(): number {
    return this.recent.length;
  }
  snapshot(): ReadonlyArray<Readonly<Sample>> {
    return [...this.samples.values()]
      .sort((left, right) => right.samples - left.samples)
      .slice(0, SNAPSHOT_LIMIT)
      .map((sample) => ({ ...sample }));
  }
}
