import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { ExecutionBudget } from "../../cpu/execution-budget";
import { OwnCpu } from "../../cpu/own/own-cpu";
import { Placement } from "../../cpu/worker/placement";
import { bundleNodeWorker, nodeExecutionPort } from "../../cpu/worker/testing/node-port";
import { configureWorkerThreads } from "../../cpu/worker/worker-host";
import { readString } from "../../memory/guest-memory";
import { CallKind } from "./graphics-channel";
import type { GraphicsLink } from "./graphics-link";

const Guest = {
  Code: 0x10000,
  Data: 0x20000,
  Gate: 0x30000,
  Return: 0x40000,
  Stack: 0x50000,
  Page: 0x1000,
} as const;
const Result = Guest.Data + 4,
  Allocation = Guest.Data + 0x100;
/** r0 = n: sums the gate's results for r0 = n, n - 1, ..., 1 into the result word. */
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

function words(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(4 * values.length),
    view = new DataView(bytes.buffer);
  values.forEach((value, k) => view.setUint32(4 * k, value, true));
  return bytes;
}

let bundle = "";
beforeAll(async () => {
  bundle = await bundleNodeWorker(
    new URL("./testing/fake-graphics.ts", import.meta.url),
    "serveFakeGraphics",
  );
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
  configureWorkerThreads({ place: undefined });
});

/** A CPU on shared memory whose WebGL context lives on a worker running the fake GL functions. */
async function machine(allocations: number[]): Promise<{ cpu: OwnCpu; link: GraphicsLink }> {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "retrove.sharedMemory" || key === "retrove.workerThreads" ? "on" : null,
  });
  configureWorkerThreads({ spawn: () => nodeExecutionPort(bundle) });
  const cpu = new OwnCpu(ExecutionBudget.Blocks);
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
  cpu.write(Guest.Code, words(CallLoop));
  cpu.trapRange(Guest.Gate, Guest.Gate + Guest.Page - 1, () => {});
  const link = await workers.startGraphics({
    canvas: new ArrayBuffer(8),
    lost: () => {},
    errorFlag: 0,
    bindingShadow: 0,
    heap: {
      alloc: (size) => {
        allocations.push(size);
        return Allocation;
      },
      free: () => {},
    },
    idle: (promise) => promise,
    diagnostic: () => {},
  });
  return { cpu, link };
}

function forward(link: GraphicsLink, name: string, registers: readonly number[]) {
  const index = link.index(name);
  if (index === undefined) throw new Error(`No ${name}`);
  return link.call(index, { registers, sp: Guest.Stack, api: 2, context: 0 });
}

test("main-thread GL calls run on the worker that owns the context", async () => {
  const allocations: number[] = [];
  const { cpu, link } = await machine(allocations);
  try {
    cpu.write(Guest.Stack, words([5, 6]));
    expect(forward(link, "_glSum", [1, 2, 3, 4])).toBe(21);
    expect(forward(link, "_glNothing", [])).toBeUndefined();
    expect(() => forward(link, "_glFail", [])).toThrow("fake GL failure");
    // The owner asks the main thread for guest heap while the main thread waits for its answer.
    const text = forward(link, "_glString", []);
    expect(text).toBe(Allocation);
    expect(readString(cpu, Allocation)).toBe("worker");
    expect(allocations).toEqual([7]);
    const later = forward(link, "_glLater", [21]);
    expect(later).toBeInstanceOf(Promise);
    expect(await later).toBe(42);
    expect(link.command(CallKind.Present, [1, 2, 3])).toBe(3);
    expect(link.statistics()).toMatchObject({ forwardedCalls: 6, localCalls: 0 });
  } finally {
    cpu.close();
  }
}, 30_000);

test("the graphics thread calls GL on its worker without a round trip", async () => {
  const calls = 2_000;
  const { cpu, link } = await machine([]);
  const workers = cpu.workers;
  if (!workers) throw new Error("Worker threads are off");
  try {
    link.setGates([[Guest.Gate, "_glTwice"]]);
    configureWorkerThreads({ place: () => Placement.Graphics });
    const thread = workers.place({
      id: 6,
      pc: Guest.Code,
      args: [calls],
      sp: Guest.Stack + Guest.Page,
      pointer: 0,
      returnAddress: Guest.Return,
    });
    if (!thread) throw new Error("The graphics thread was not placed");
    // A main-thread call is answered while the graphics thread runs.
    cpu.write(Guest.Stack, words([0, 0]));
    expect(forward(link, "_glSum", [1, 1, 1, 1])).toBe(4);
    const deadline = performance.now() + 20_000;
    for (;;) {
      if (performance.now() > deadline) throw new Error("The graphics thread did not finish.");
      const request = thread.take();
      if (request?.exit) break;
      if (request) throw new Error(`Unexpected host call at 0x${request.pc.toString(16)}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    thread.finish();
    expect(cpu.read32(Result)).toBe(calls * (calls + 1));
    const statistics = workers.statistics();
    expect(statistics).toMatchObject({ hostCalls: 0, graphicsThreads: [6] });
    expect(statistics.graphics?.localCalls).toBe(calls);
  } finally {
    cpu.close();
  }
}, 30_000);
