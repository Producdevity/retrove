import type { ThreadTable } from "./thread-table";
import type { NestedCall, SpawnedThread } from "./thread-types";

/** Darwin's PTHREAD_DESTRUCTOR_ITERATIONS. */
const DESTRUCTOR_PASSES = 4;
export type ExitHandler = (thread: number) => unknown;

/** Runs a finished thread's TLS destructors and exit handlers, then frees it. */
export class ThreadExits {
  readonly #handlers: ExitHandler[] = [];
  constructor(private readonly table: ThreadTable) {}
  add(handler: ExitHandler): void {
    this.#handlers.push(handler);
  }
  async finish(thread: SpawnedThread, value: number, nested: NestedCall): Promise<void> {
    const { table } = this;
    thread.value = value;
    for (let pass = 0; pass < DESTRUCTOR_PASSES; pass++) {
      const pending = [...thread.tls].filter(([key, data]) => data && table.keys.get(key));
      if (!pending.length) break;
      for (const [key, data] of pending) {
        thread.tls.delete(key);
        table.setKeySlot(thread, key, 0);
        const destructor = table.keys.get(key);
        if (destructor !== undefined) await nested(destructor, [data]);
      }
    }
    for (const handler of this.#handlers) await handler(thread.id);
    thread.done = true;
    await thread.onExit?.(thread.value);
    table.release(thread);
    if (thread.detached) table.reap(thread);
  }
}
