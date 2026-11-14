import { OperationClass, type OperationHost } from "./host";
const DEFAULT_CONCURRENCY = -1;
const WORKER_LIMIT = 4;
interface Queue {
  readonly pending: number[];
  readonly active: Set<number>;
  readonly main: boolean;
  maximum: number;
  suspended: boolean;
}
export class OperationQueues {
  private readonly queues = new Map<number, Queue>();
  private readonly queued = new Set<number>();
  private pumping = false;
  private mainPointer = 0;
  constructor(
    private readonly host: OperationHost,
    private readonly queueClass: number,
  ) {}
  main(): number {
    if (!this.mainPointer) {
      this.mainPointer = this.host.alloc(this.queueClass);
      this.queues.set(this.mainPointer, {
        pending: [],
        active: new Set(),
        main: true,
        maximum: 1,
        suspended: false,
      });
    }
    return this.mainPointer;
  }
  get(self: number): Queue {
    let state = this.queues.get(self);
    if (!state) {
      state = {
        pending: [],
        active: new Set(),
        main: false,
        maximum: DEFAULT_CONCURRENCY,
        suspended: false,
      };
      this.queues.set(self, state);
    }
    return state;
  }
  async add(self: number, operation: number): Promise<void> {
    if (!this.host.isKind(operation, OperationClass.Base)) throw new Error("Expected NSOperation.");
    if (
      this.queued.has(operation) ||
      (await this.host.send(operation, "isExecuting")) ||
      (await this.host.send(operation, "isFinished"))
    )
      throw new Error("Operation is already running or enqueued.");
    this.queued.add(operation);
    this.get(self).pending.push(this.host.retain(operation));
    await this.pump(false);
  }
  async pump(main: boolean): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (const state of this.queues.values()) {
        for (const operation of [...state.active])
          if (await this.host.send(operation, "isFinished")) await this.finished(state, operation);
        const maximum = state.main
          ? 1
          : state.maximum === DEFAULT_CONCURRENCY
            ? WORKER_LIMIT
            : state.maximum;
        if (state.suspended || (state.main && !main)) continue;
        for (const operation of [...state.pending]) {
          if (state.active.size >= maximum) break;
          if (!(await this.host.send(operation, "isReady"))) continue;
          state.pending.splice(state.pending.indexOf(operation), 1);
          state.active.add(operation);
          if (state.main) {
            await this.host.send(operation, "start");
            if (await this.host.send(operation, "isFinished"))
              await this.finished(state, operation);
          } else
            this.host.worker(
              operation,
              async () => {
                await this.host.send(operation, "start");
              },
              async () => {
                await this.pump(false);
              },
            );
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  private async finished(state: Queue, operation: number): Promise<void> {
    state.active.delete(operation);
    this.queued.delete(operation);
    await this.host.release(operation);
  }
  pending(): number {
    let count = 0;
    for (const state of this.queues.values()) count += state.pending.length + state.active.size;
    return count;
  }
  async cancel(self: number): Promise<void> {
    const state = this.get(self);
    for (const operation of [...state.pending, ...state.active])
      await this.host.send(operation, "cancel");
    await this.pump(false);
  }
  async destroy(self: number): Promise<void> {
    const state = this.get(self);
    if (state.pending.length || state.active.size)
      throw new Error("Cannot deallocate a queue with unfinished operations.");
    this.queues.delete(self);
    this.host.destroy(self);
  }
}
