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
const SYMBOL_LIMIT = 2048;
export class ExecutionMetrics {
  private readonly samples = new Map<string, Sample>();
  sample(thread: number, pc: number, symbol?: SymbolLocation): void {
    const address = symbol ? pc - symbol.offset : pc;
    const name = symbol?.name ?? `0x${address.toString(HEXADECIMAL)}`;
    const key = `${thread}:${address}`;
    const previous = this.samples.get(key);
    if (previous) previous.samples++;
    else if (this.samples.size < SYMBOL_LIMIT)
      this.samples.set(key, { thread, symbol: name, address, samples: 1 });
  }
  snapshot(): ReadonlyArray<Readonly<Sample>> {
    return [...this.samples.values()]
      .sort((left, right) => right.samples - left.samples)
      .slice(0, SNAPSHOT_LIMIT)
      .map((sample) => ({ ...sample }));
  }
}
