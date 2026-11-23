import { Gauge, gauges } from "../../diagnostics/gauges";
import { GuestLayout } from "../../memory/guest-layout";
import { read32, write32 } from "../../memory/guest-memory";
import {
  MAIN_THREAD,
  type GuestThread,
  type SpawnedThread,
  type ThreadCpu,
  type ThreadHeap,
} from "./thread-types";

/** Darwin's PTHREAD_KEYS_MAX; each thread mirrors its values in a guest table for the ARM getter. */
export const TLS_KEYS = 512;
const WORD_BYTES = 4;
/**
 * Words of a thread block: a private word holding the SJLJ context chain, then the visible
 * pthread_self word and the TLS table pointer the ARM getter reads.
 */
const Block = { Bytes: 16, Self: 8, Keys: 12 } as const;
/** Offsets from the pthread_self word. */
const SelfOffset = { Unwind: -4, Keys: 4 } as const;
const DEFAULT_STACK_BYTES = 524_288;
const STACK_TOP_RESERVE = 16;
const MAX_START_ARGUMENTS = 4;

export interface SpawnOptions {
  readonly size?: number;
  readonly detached?: boolean;
}

/** The main thread, the threads the guest created and the one whose registers the CPU holds. */
export class ThreadTable {
  readonly workers = new Map<number, SpawnedThread>();
  /** TLS keys and their destructors. */
  readonly keys = new Map<number, number>();
  readonly main: GuestThread;
  current: GuestThread;
  #nextId = MAIN_THREAD + 1;
  constructor(
    private readonly cpu: ThreadCpu,
    private readonly heap: ThreadHeap,
    private readonly returnAddress: number,
  ) {
    gauges.read(
      Gauge.GuestThreads,
      () => 1 + [...this.workers.values()].filter((t) => !t.done).length,
    );
    this.main = {
      id: MAIN_THREAD,
      tls: new Map(),
      stackBottom: GuestLayout.StackBottom,
      pointer: this.#threadPointer(MAIN_THREAD),
    };
    if (!this.main.pointer) throw Error("Guest heap exhausted initializing the main thread");
    cpu.threadPointer = this.main.pointer;
    this.current = this.main;
  }
  #threadPointer(id: number): number {
    const base = this.heap.zero(Block.Bytes),
      keys = base && this.heap.zero(TLS_KEYS * WORD_BYTES);
    if (!keys) {
      if (base) this.heap.free(base);
      return 0;
    }
    write32(this.cpu, base + Block.Self, id);
    write32(this.cpu, base + Block.Keys, keys);
    return base + Block.Self;
  }
  /** Whether `id` names the main thread or a live guest-created one. */
  exists(id: number): boolean {
    return id === MAIN_THREAD || this.workers.has(id);
  }
  keyTable(thread: GuestThread): number {
    return read32(this.cpu, thread.pointer + SelfOffset.Keys);
  }
  setKeySlot(thread: GuestThread, key: number, value: number): void {
    write32(this.cpu, this.keyTable(thread) + key * WORD_BYTES, value);
  }
  get unwindTop(): number {
    return read32(this.cpu, this.current.pointer + SelfOffset.Unwind);
  }
  set unwindTop(frame: number) {
    write32(this.cpu, this.current.pointer + SelfOffset.Unwind, frame);
  }
  spawn(
    pc: number,
    args: readonly number[],
    options: SpawnOptions,
    onExit?: (value: number) => unknown,
  ): number {
    if (!pc || args.length > MAX_START_ARGUMENTS) return 0;
    const size = options.size || DEFAULT_STACK_BYTES;
    const stack = this.heap.zero(size);
    if (!stack) return 0;
    const id = this.#nextId++,
      pointer = this.#threadPointer(id);
    if (!pointer) {
      this.heap.free(stack);
      return 0;
    }
    const thread: SpawnedThread = {
      id,
      pc,
      pointer,
      args: [...args],
      stack,
      stackBottom: stack,
      sp: stack + size - STACK_TOP_RESERVE,
      tls: new Map(),
      running: false,
      done: false,
      detached: Boolean(options.detached),
      onExit,
      state: undefined,
      wait: undefined,
      resume: undefined,
    };
    this.workers.set(id, thread);
    const remote = this.cpu.workers;
    if (remote) {
      const { sp } = thread,
        returnAddress = this.returnAddress;
      thread.remote = remote.place({ id, pc, args: thread.args, sp, pointer, returnAddress });
    }
    return id;
  }
  /** Frees the thread's registers, stack and thread block. */
  release(thread: SpawnedThread): void {
    if (thread.state !== undefined) this.cpu.freeState(thread.state);
    if (thread.stack) this.heap.free(thread.stack);
    if (thread.pointer) {
      this.heap.free(this.keyTable(thread));
      this.heap.free(thread.pointer - Block.Self);
    }
    thread.pointer = 0;
    thread.state = undefined;
    thread.stack = 0;
  }
  reap(thread: SpawnedThread): void {
    this.release(thread);
    this.workers.delete(thread.id);
  }
  close(): void {
    for (const thread of this.workers.values()) this.release(thread);
    this.workers.clear();
  }
}
