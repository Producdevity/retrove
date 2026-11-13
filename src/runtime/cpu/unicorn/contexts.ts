interface ContextBackend<T> {
  allocate(): T;
  save(context: T): void;
  restore(context: T): void;
  free(context: T): void;
}
interface SavedContext<T> {
  readonly handle: T;
}
const MAXIMUM_IDLE_CONTEXTS = 16;
export class UnicornContexts<T> {
  readonly #backend: ContextBackend<T>;
  readonly #active = new Set<SavedContext<T>>();
  readonly #idle: T[] = [];
  #closed = false;
  constructor(backend: ContextBackend<T>) {
    this.#backend = backend;
  }
  #requireOpen(): void {
    if (this.#closed) throw new Error("CPU contexts are closed.");
  }
  save(): SavedContext<T> {
    this.#requireOpen();
    const handle = this.#idle.pop() ?? this.#backend.allocate();
    try {
      this.#backend.save(handle);
      const context = { handle };
      this.#active.add(context);
      return context;
    } catch (error) {
      this.#backend.free(handle);
      throw error;
    }
  }
  restore(context: SavedContext<T>): void {
    this.#requireOpen();
    if (!this.#active.has(context)) throw new Error("Unknown CPU state.");
    this.#backend.restore(context.handle);
  }
  release(context: SavedContext<T>): void {
    if (!this.#active.delete(context)) return;
    if (this.#idle.length < MAXIMUM_IDLE_CONTEXTS) this.#idle.push(context.handle);
    else this.#backend.free(context.handle);
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const context of this.#active) this.#backend.free(context.handle);
    for (const handle of this.#idle) this.#backend.free(handle);
    this.#active.clear();
    this.#idle.length = 0;
  }
}
