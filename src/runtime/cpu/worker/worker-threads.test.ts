import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { ExecutionBudget } from "../execution-budget";
import { OwnCpu } from "../own/own-cpu";
import type { RemoteThread } from "./remote-thread";
import { bundleNodeWorker, nodeExecutionPort } from "./testing/node-port";
import { configureWorkerThreads, type WorkerThreads } from "./worker-host";

const Guest = {
  Code: 0x10000,
  MainLoop: 0x10100,
  CallLoop: 0x10200,
  Data: 0x20000,
  Gate: 0x30000,
  Return: 0x40000,
  Stack: 0x50000,
  Page: 0x1000,
} as const;
const Counter = Guest.Data,
  Result = Guest.Data + 4;
/**
 * r0 = counter, r1 = iterations, r2 = result address: calls the host gate with r0 = 7, stores its
 * result, then increments the counter r1 times with LDREX/STREX.
 */
const WorkerThread = [
  0xe92d4070, // push {r4-r6, lr}
  0xe1a04000, // mov r4, r0
  0xe1a05001, // mov r5, r1
  0xe1a06002, // mov r6, r2
  0xe3a00007, // mov r0, #7
  0xe3a0c803, // mov r12, #0x30000
  0xe12fff3c, // blx r12
  0xe5860000, // str r0, [r6]
  0xe1942f9f, // 1: ldrex r2, [r4]
  0xe2822001, // add r2, r2, #1
  0xe1843f92, // strex r3, r2, [r4]
  0xe3530000, // cmp r3, #0
  0x1afffffa, // bne 1b
  0xe2555001, // subs r5, r5, #1
  0x1afffff9, // bne 1b
  0xe8bd8070, // pop {r4-r6, pc}
];
/** r0 = counter, r1 = iterations: the same increment loop for the main thread. */
const MainLoop = [
  0xe1902f9f, // 1: ldrex r2, [r0]
  0xe2822001, // add r2, r2, #1
  0xe1803f92, // strex r3, r2, [r0]
  0xe3530000, // cmp r3, #0
  0x1afffffa, // bne 1b
  0xe2511001, // subs r1, r1, #1
  0x1afffff9, // bne 1b
  0xe12fff1e, // bx lr
];
/** r0 = n: sums the host gate's results for r0 = n, n - 1, ..., 1 into the result word. */
const CallLoop = [
  0xe92d4030, // push {r4, r5, lr}
  0xe1a04000, // mov r4, r0
  0xe3a05000, // mov r5, #0
  0xe1a00004, // 1: mov r0, r4
  0xe3a0c803, // mov r12, #0x30000
  0xe12fff3c, // blx r12
  0xe0855000, // add r5, r5, r0
  0xe2544001, // subs r4, r4, #1
  0x1afffff9, // bne 1b
  0xe3a00802, // mov r0, #0x20000
  0xe5805004, // str r5, [r0, #4]
  0xe8bd8030, // pop {r4, r5, pc}
];
const HOST_FACTOR = 6;

function words(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(4 * values.length),
    view = new DataView(bytes.buffer);
  values.forEach((value, k) => view.setUint32(4 * k, value, true));
  return bytes;
}

let bundle = "";
beforeAll(async () => {
  bundle = await bundleNodeWorker(
    new URL("./execution-core.ts", import.meta.url),
    "serveExecution",
  );
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
  configureWorkerThreads({ place: () => false });
});

function machine(codeBudget?: number) {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "retrove.sharedMemory" || key === "retrove.workerThreads" ? "on" : null,
  });
  configureWorkerThreads({ place: () => true, spawn: () => nodeExecutionPort(bundle) });
  const cpu = new OwnCpu(ExecutionBudget.Blocks, codeBudget ? { codeBudget } : {});
  const workers = cpu.workers;
  if (!workers) throw new Error("Worker threads are off");
  for (const [address, permissions] of [
    [Guest.Code, 5],
    [Guest.Data, 3],
    [Guest.Gate, 5],
    [Guest.Return, 5],
    [Guest.Stack, 3],
  ] as const)
    cpu.map(address, Guest.Page, permissions);
  cpu.write(Guest.Code, words(WorkerThread));
  cpu.write(Guest.MainLoop, words(MainLoop));
  cpu.write(Guest.CallLoop, words(CallLoop));
  cpu.trapRange(Guest.Gate, Guest.Gate + Guest.Page - 1, () => {});
  return { cpu, workers };
}

/** Answers a worker thread's requests as the runtime does: host calls see the worker's registers. */
class Host {
  exited = false;
  constructor(
    private readonly cpu: OwnCpu,
    private readonly workers: WorkerThreads,
    readonly thread: RemoteThread,
  ) {}
  /** Answers one waiting request; false when there was none. */
  service(): boolean {
    const { cpu, thread } = this,
      request = thread.take();
    if (!request) return false;
    if (request.exit) {
      thread.finish();
      this.exited = true;
      return true;
    }
    const saved = cpu.saveState();
    thread.enter(request.pc);
    const lr = cpu.getReg(14);
    cpu.setReg(0, cpu.getReg(0) * HOST_FACTOR);
    thread.leave();
    cpu.restoreState(saved);
    thread.resume(lr);
    return true;
  }
  /** Waits as an idle main thread does, answering the worker whenever it rings, until it exits. */
  async finish(): Promise<void> {
    const deadline = performance.now() + 20_000;
    while (!this.exited) {
      if (performance.now() > deadline) throw new Error("The worker thread did not finish.");
      await this.workers.idle(new Promise((resolve) => setTimeout(resolve, 10)), async () => {
        this.workers.acknowledge();
        while (this.service());
        await Promise.resolve();
      });
    }
  }
}

function start(cpu: OwnCpu, workers: WorkerThreads, pc: number, args: readonly number[]): Host {
  const thread = workers.place({
    id: 2,
    pc,
    args,
    sp: Guest.Stack + Guest.Page,
    pointer: 0,
    returnAddress: Guest.Return,
  });
  if (!thread) throw new Error("The thread was not placed");
  return new Host(cpu, workers, thread);
}

test.each([undefined, 1])(
  "a worker thread and the main thread increment one counter with LDREX/STREX (code budget %s)",
  async (codeBudget) => {
    const iterations = 400_000;
    const { cpu, workers } = machine(codeBudget);
    try {
      const host = start(cpu, workers, Guest.Code, [Counter, iterations, Result]);
      // The main thread starts once the worker has made its host call, so both loops overlap.
      while (!host.service()) await new Promise((resolve) => setTimeout(resolve, 0));
      const before = cpu.read32(Counter);
      cpu.setReg(0, Counter);
      cpu.setReg(1, iterations);
      cpu.setReg(14, Guest.Return);
      for (let pc: number = Guest.MainLoop; ;) {
        const result = cpu.run(pc, { until: Guest.Return, count: 65_536 });
        host.service();
        if (result.reason === "until") break;
        pc = result.pc;
      }
      const after = cpu.read32(Counter);
      await host.finish();
      // The worker's increments landed while the main loop ran: the two threads overlapped.
      expect(after - before).toBeGreaterThan(iterations);
      expect(cpu.read32(Counter)).toBe(2 * iterations);
      expect(cpu.read32(Result)).toBe(7 * HOST_FACTOR);
      expect(workers.statistics()).toMatchObject({ threads: 1, hostCalls: 1 });
    } finally {
      cpu.close();
    }
  },
  30_000,
);

test("host calls from a worker thread return their values in r0", async () => {
  const calls = 10_000;
  const { cpu, workers } = machine();
  try {
    await start(cpu, workers, Guest.CallLoop, [calls]).finish();
    const statistics = workers.statistics();
    expect(statistics.hostCalls).toBe(calls);
    expect(cpu.read32(Result)).toBe((HOST_FACTOR * calls * (calls + 1)) / 2);
  } finally {
    cpu.close();
  }
}, 30_000);
