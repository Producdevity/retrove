import { Argument } from "../../objc/host";
import { readString } from "../../../memory/guest-memory";
import { installThreadInstances } from "../thread-instances";
import { installThreadWaits } from "../thread-waits";
import { MAIN_THREAD_ID } from "./constants";
import type { FoundationContext, ThreadService } from "./types";

const THREAD = "NSThread";
const STACK_FAILURE = "Could not allocate NSThread stack";

export function installThreads(ctx: FoundationContext): {
  threadIdentity: (pointer: number) => number;
} {
  const { method, hostClass, h, threads, text, string } = ctx;
  hostClass(THREAD, "NSObject");
  installThreadWaits({
    now: () => performance.now(),
    wallTime: () => Date.now(),
    send: ctx.send,
    classMethod: (name, handler) => method(THREAD, true, name, (_, args) => handler(args)),
  });
  const objects = new Map<number, number>();
  const names = new Map<number, string>();
  const registry: { register: ((pointer: number) => void) | undefined } = { register: undefined };
  const thread = (id: number): number => {
    const existing = objects.get(id);
    if (existing !== undefined) return existing;
    const pointer = ctx.alloc(h.classPointer(THREAD));
    objects.set(id, pointer);
    registry.register?.(pointer);
    return pointer;
  };
  const threadId = () => threads?.funcs._pthread_self() ?? MAIN_THREAD_ID;
  const instances = installThreadInstances({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    release: ctx.release,
    autorelease: ctx.autorelease,
    text,
    string,
    write: ctx.write,
    selector: (pointer) => readString(ctx.cpu, pointer),
    send: ctx.send,
    guestMethod: (receiver, name) => typeof ctx.lookup(ctx.read(receiver), name) === "number",
    spawn: createSpawner(ctx, objects),
  });
  registry.register = (pointer) => instances.register(pointer);
  method(THREAD, true, "mainThread", () => thread(MAIN_THREAD_ID));
  method(THREAD, true, "currentThread", () => thread(threadId()));
  method(THREAD, true, "isMainThread", () => Number(threadId() === MAIN_THREAD_ID));
  method(THREAD, false, "isMainThread", (self) => Number(thread(MAIN_THREAD_ID) === self));
  method(THREAD, false, "setName:", (self, args) => {
    names.set(self, args(0) ? text(args(0)) : "");
  });
  method(THREAD, false, "name", (self) => {
    const value = names.get(self);
    return value === undefined ? 0 : string(value);
  });
  installDetached(ctx, requireThreads(threads));
  return {
    threadIdentity: (pointer) => [...objects].find(([, value]) => value === pointer)?.[0] ?? 0,
  };
}

function requireThreads(threads: ThreadService | undefined): () => ThreadService {
  return () => {
    if (!threads) throw new Error("NSThread workers are unavailable");
    return threads;
  };
}

function guestEntry(ctx: FoundationContext, receiver: number, name: string): number {
  const pc = ctx.lookup(ctx.read(receiver), name);
  if (typeof pc !== "number") throw new Error(`Expected guest NSThread selector ${name}`);
  return pc;
}

function installDetached(ctx: FoundationContext, threads: () => ThreadService): void {
  const { method, cpu, retain, release } = ctx;
  const detach = (selector: number, target: number, argument: number): void => {
    const pc = guestEntry(ctx, target, readString(cpu, selector));
    retain(target);
    retain(argument);
    const id = threads().spawnDetached(pc, [target, selector, argument], async () => {
      await release(target);
      await release(argument);
    });
    if (!id) throw new Error(STACK_FAILURE);
  };
  method(THREAD, true, "detachNewThreadSelector:toTarget:withObject:", (_, args) => {
    detach(args(0), args(1), args(Argument.Third));
  });
  for (const meta of [true, false]) {
    method("NSObject", meta, "performSelectorInBackground:withObject:", (self, args) => {
      detach(args(0), self, args(1));
    });
  }
}

type Spawn = Parameters<typeof installThreadInstances>[0]["spawn"];

function createSpawner(ctx: FoundationContext, objects: Map<number, number>): Spawn {
  const tasks = new Map<number, () => Promise<void>>();
  let gate: number | undefined;
  return (self, entry, task, exited) => {
    const { threads, hostGate } = ctx;
    if (!threads) throw new Error("NSThread workers are unavailable");
    if (entry) {
      const pc = guestEntry(ctx, entry.receiver, entry.selector);
      const id = threads.spawnDetached(
        pc,
        [entry.receiver, ctx.selector(entry.selector), ...entry.args],
        async () => {
          objects.delete(id);
          await exited();
        },
      );
      if (!id) throw new Error(STACK_FAILURE);
      objects.set(id, self);
      return;
    }
    if (!hostGate) throw new Error("NSThread workers are unavailable");
    gate ??= hostGate({ name: "NSThread main", library: "Foundation" }, async (args) => {
      const pending = tasks.get(args(0));
      if (!pending) throw new Error("Unknown NSThread worker");
      await pending();
      return 0;
    });
    tasks.set(self, task);
    const id = threads.spawnDetached(gate, [self], async () => {
      tasks.delete(self);
      objects.delete(id);
      await exited();
    });
    if (!id) {
      tasks.delete(self);
      throw new Error(STACK_FAILURE);
    }
    objects.set(id, self);
  };
}
