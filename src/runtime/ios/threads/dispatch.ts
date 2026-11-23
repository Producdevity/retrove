import { read32, write32 } from "../../memory/guest-memory";
import { compareExchange32, store32, type AtomicGuestMemory } from "../../memory/guest-atomics";
import { WORD_BYTES } from "../abi/scalars";
import {
  UINT32_MAX,
  type GuestHeap,
  type GuestImport,
  type GuestJump,
  type HostWait,
} from "../libc/guest-imports";
import { BlockField, BlockRuntime, type BlockObjects, type NestedCall } from "./block-runtime";

const Register = { Argument: 0, Stack: 13, Link: 14 } as const;
const QUEUE_BYTES = 4;
const QueuePriority = { Default: 0, High: 2, Low: -2, Background: -0x8000 } as const;
const PRIORITIES = [
  QueuePriority.Default,
  QueuePriority.High,
  QueuePriority.Low,
  QueuePriority.Background,
];
const MAIN_QUEUE = "__dispatch_main_q";
const ONCE_PENDING = 1;
const FRAME_BYTES = 8;
const Once = { Predicate: 0, Block: 1 } as const;
const QueueCall = { Queue: 0, Block: 1 } as const;
const Priority = { Identifier: 0, Flags: 1 } as const;
const Assign = { Destination: 0, Value: 1, Flags: 2 } as const;
const Dispose = { Value: 0, Flags: 1 } as const;

export interface DispatchCpu extends AtomicGuestMemory {
  getReg(register: number): number;
  setReg(register: number, value: number): void;
}
export interface DispatchThreads {
  readonly funcs: {
    readonly _pthread_self: () => number;
    readonly _pthread_main_np: () => number;
  };
  readonly stackBottom: number;
  spawnDetached(target: number, args: number[], onExit: () => Promise<void>): number;
}
export type HostGate = (
  identity: { library: string; name: string },
  handler: () => GuestJump,
) => number;
export type DispatchHeap = Pick<GuestHeap, "zero" | "alloc" | "free">;
interface Job {
  readonly block: number;
  readonly waiting?: boolean;
  done?: boolean;
}

class DispatchQueues {
  readonly main: number;
  readonly global = new Map<number, number>();
  readonly data: Map<string, number>;
  readonly ids: Set<number>;
  readonly current = new Map<number, number>();
  readonly pending: Job[] = [];
  polling = false;
  constructor(heap: DispatchHeap) {
    this.main = heap.zero(QUEUE_BYTES);
    for (const priority of PRIORITIES) this.global.set(priority, heap.zero(QUEUE_BYTES));
    this.data = new Map([[MAIN_QUEUE, this.main]]);
    this.ids = new Set([this.main, ...this.global.values()]);
  }
}

class Dispatch {
  private readonly queues: DispatchQueues;
  private readonly blocks: BlockRuntime;
  private onceReturn = 0;
  private syncReturn = 0;
  constructor(
    private readonly cpu: DispatchCpu,
    heap: DispatchHeap,
    private readonly threads: DispatchThreads,
    private readonly nested: NestedCall,
    objects: BlockObjects,
    private readonly hostGate: HostGate | undefined,
  ) {
    this.queues = new DispatchQueues(heap);
    this.blocks = new BlockRuntime(cpu, heap, nested, objects);
  }

  get data(): Map<string, number> {
    return this.queues.data;
  }
  get copy(): (block: number) => Promise<number> {
    return (block) => this.blocks.copy(block);
  }
  get release(): (block: number, byref?: boolean) => Promise<void> {
    return (block, byref) => this.blocks.release(block, byref);
  }
  hasPendingMain(): boolean {
    return this.queues.pending.length !== 0;
  }

  private read(at: number): number {
    return read32(this.cpu, at);
  }
  private write(at: number, value: number): void {
    write32(this.cpu, at, value);
  }
  private caller(): number {
    return this.threads.funcs._pthread_self();
  }
  private invoke(block: number): Promise<number | void> {
    return this.nested(this.read(block + BlockField.Invoke), [block]);
  }

  private validate(queue: number, block: number): void {
    if (!this.queues.ids.has(queue) || !block || !this.read(block + BlockField.Invoke))
      throw new Error("Invalid guest dispatch queue or block");
  }

  private async run(queue: number, block: number): Promise<number | void> {
    const { current } = this.queues,
      thread = this.caller(),
      previous = current.get(thread);
    current.set(thread, queue);
    try {
      return await this.invoke(block);
    } finally {
      if (previous) current.set(thread, previous);
      else current.delete(thread);
    }
  }

  /**
   * Leaves the original return address and callback state on this pthread's guest stack, so a
   * blocked block can yield back to the thread scheduler.
   */
  private invokeOnCaller(block: number, value: number, gate: number): GuestJump {
    const { cpu } = this;
    const sp = cpu.getReg(Register.Stack) - FRAME_BYTES;
    if (sp < this.threads.stackBottom)
      throw new Error("Guest stack exhausted entering a dispatch block");
    this.write(sp, cpu.getReg(Register.Link));
    this.write(sp + WORD_BYTES, value);
    cpu.setReg(Register.Stack, sp);
    cpu.setReg(Register.Link, gate);
    cpu.setReg(Register.Argument, block);
    return { jump: this.read(block + BlockField.Invoke) };
  }

  private continuation(name: string, finish: (value: number) => void): number {
    if (!this.hostGate) throw new Error("Host gates are unavailable");
    return this.hostGate({ library: "libdispatch", name }, () => {
      const { cpu } = this;
      const sp = cpu.getReg(Register.Stack),
        link = this.read(sp);
      finish(this.read(sp + WORD_BYTES));
      cpu.setReg(Register.Stack, sp + FRAME_BYTES);
      cpu.setReg(Register.Link, link);
      return { jump: link };
    });
  }

  async pollMain(): Promise<void> {
    const { queues } = this;
    if (queues.polling || !this.threads.funcs._pthread_main_np() || !queues.pending.length) return;
    queues.polling = true;
    try {
      for (const job of queues.pending.splice(0)) {
        try {
          await this.run(queues.main, job.block);
        } finally {
          if (job.waiting) job.done = true;
          else await this.release(job.block);
        }
      }
    } finally {
      queues.polling = false;
    }
  }

  private async once(a: (index: number) => number): Promise<HostWait | GuestJump | undefined> {
    const at = a(Once.Predicate),
      block = a(Once.Block);
    // Guest code tests the predicate inline, so claiming and publishing it must be atomic.
    const claimed = compareExchange32(this.cpu, at, 0, ONCE_PENDING);
    if (claimed === UINT32_MAX) return undefined;
    if (claimed) return { wait: () => (this.read(at) === UINT32_MAX ? 0 : undefined) };
    if (this.hostGate) {
      this.onceReturn ||= this.continuation("dispatch_once block return", (token) => {
        store32(this.cpu, token, UINT32_MAX);
      });
      return this.invokeOnCaller(block, at, this.onceReturn);
    }
    try {
      await this.invoke(block);
      store32(this.cpu, at, UINT32_MAX);
    } catch (error) {
      store32(this.cpu, at, 0);
      throw error;
    }
    return undefined;
  }

  private async dispatchSync(
    a: (index: number) => number,
  ): Promise<number | void | HostWait | GuestJump> {
    const queue = a(QueueCall.Queue),
      block = a(QueueCall.Block),
      { current, pending } = this.queues;
    this.validate(queue, block);
    if (queue !== this.queues.main) {
      if (!this.hostGate) return this.run(queue, block);
      const thread = this.caller(),
        previous = current.get(thread) ?? 0;
      this.syncReturn ||= this.continuation("dispatch_sync block return", (old) => {
        if (old) current.set(this.caller(), old);
        else current.delete(this.caller());
      });
      current.set(thread, queue);
      return this.invokeOnCaller(block, previous, this.syncReturn);
    }
    if (this.threads.funcs._pthread_main_np())
      throw new Error("Synchronous dispatch to the current main queue would deadlock");
    const job: Job = { block, waiting: true, done: false };
    pending.push(job);
    return { wait: () => (job.done ? 0 : undefined) };
  }

  private async dispatchAsync(a: (index: number) => number): Promise<void> {
    const queue = a(QueueCall.Queue),
      original = a(QueueCall.Block),
      { current, pending } = this.queues;
    this.validate(queue, original);
    const block = await this.copy(original);
    if (queue === this.queues.main) {
      pending.push({ block });
      return;
    }
    const id = this.threads.spawnDetached(
      this.read(block + BlockField.Invoke),
      [block],
      async () => {
        current.delete(id);
        await this.release(block);
      },
    );
    if (!id) {
      await this.release(block);
      throw new Error("Guest dispatch worker could not start");
    }
    current.set(id, queue);
  }

  imports(): Record<string, GuestImport> {
    const { queues } = this;
    return {
      __Block_copy: (a) => this.copy(a(0)),
      __Block_release: (a) => this.release(a(0)),
      __Block_object_assign: async (a) => {
        this.write(
          a(Assign.Destination),
          (await this.blocks.field(a(Assign.Value), a(Assign.Flags), false)) ?? 0,
        );
      },
      __Block_object_dispose: (a) => this.blocks.field(a(Dispose.Value), a(Dispose.Flags), true),
      _dispatch_once: (a) => this.once(a),
      _dispatch_get_global_queue: (a) =>
        a(Priority.Flags) ? 0 : (queues.global.get(a(Priority.Identifier) | 0) ?? 0),
      _dispatch_get_current_queue: () =>
        queues.current.get(this.caller()) ??
        (this.threads.funcs._pthread_main_np()
          ? queues.main
          : queues.global.get(QueuePriority.Default)),
      _dispatch_sync: (a) => this.dispatchSync(a),
      _dispatch_async: (a) => this.dispatchAsync(a),
    };
  }
}

export function dispatchImports(
  cpu: DispatchCpu,
  heap: DispatchHeap,
  threads: DispatchThreads,
  nested: NestedCall,
  objects: BlockObjects,
  hostGate?: HostGate,
) {
  const dispatch = new Dispatch(cpu, heap, threads, nested, objects, hostGate);
  return {
    funcs: dispatch.imports(),
    data: dispatch.data,
    pollMain: () => dispatch.pollMain(),
    hasPendingMain: () => dispatch.hasPendingMain(),
    copy: dispatch.copy,
    release: dispatch.release,
  };
}
