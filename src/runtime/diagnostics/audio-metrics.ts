const HISTORY_LIMIT = 8;
const ARGUMENT_COUNT = 4;
const COMPONENT_LOOKUP = "_AudioComponentFindNext";
type Arguments = (index: number) => number;
type AudioImport = (argumentsAt: Arguments) => number | Promise<number>;
interface AudioCall {
  readonly operation: string;
  readonly status: number;
  readonly arguments: readonly number[];
}
export class AudioMetrics {
  private readonly calls = new Map<string, number>();
  private readonly recent: AudioCall[] = [];
  private readonly failures: AudioCall[] = [];
  private record(operation: string, status: number, values: readonly number[]): void {
    this.calls.set(operation, (this.calls.get(operation) ?? 0) + 1);
    const call = { operation, status, arguments: [...values] };
    this.recent.push(call);
    if (this.recent.length > HISTORY_LIMIT) this.recent.shift();
    if (status !== 0 && operation !== COMPONENT_LOOKUP) {
      this.failures.push(call);
      if (this.failures.length > HISTORY_LIMIT) this.failures.shift();
    }
  }
  track(imports: Readonly<Record<string, AudioImport>>): Record<string, AudioImport> {
    return Object.fromEntries(
      Object.entries(imports).map(([operation, invoke]) => [
        operation,
        (argumentsAt: Arguments) => {
          const values = Array.from({ length: ARGUMENT_COUNT }, (_, index) => argumentsAt(index));
          const complete = (status: number) => {
            this.record(operation, status, values);
            return status;
          };
          const result = invoke(argumentsAt);
          return result instanceof Promise ? result.then(complete) : complete(result);
        },
      ]),
    );
  }
  snapshot() {
    const copy = (call: AudioCall) => ({ ...call, arguments: [...call.arguments] });
    return {
      calls: Object.fromEntries(this.calls),
      recent: this.recent.map(copy),
      failures: this.failures.map(copy),
    };
  }
}
