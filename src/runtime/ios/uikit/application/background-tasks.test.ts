import { describe, expect, it, vi } from "vite-plus/test";
import type { HostMethod } from "../../objc/host";
import { installBackgroundTasks } from "./background-tasks";

function fixture(state = 0) {
  const methods = new Map<string, HostMethod>();
  const releaseBlock = vi.fn(async (_block: number) => {});
  installBackgroundTasks({
    method: (_name, _meta, selector, implementation) => methods.set(selector, implementation),
    state: () => state,
    copyBlock: async (block) => block + 1000,
    releaseBlock,
  });
  const call = async (selector: string, args: number[] = []) => {
    const method = methods.get(selector);
    if (!method) throw new Error(`missing ${selector}`);
    return method(0, (index) => args[index] ?? 0);
  };
  return { call, releaseBlock };
}

describe("background tasks", () => {
  it("grants distinct task identifiers and releases each handler once", async () => {
    const x = fixture();
    const first = await x.call("beginBackgroundTaskWithExpirationHandler:", [5]);
    const second = await x.call("beginBackgroundTaskWithName:expirationHandler:", [0, 6]);
    expect(first).not.toBe(0);
    expect(second).not.toBe(first);
    await x.call("endBackgroundTask:", [Number(first)]);
    await x.call("endBackgroundTask:", [Number(first)]);
    expect(x.releaseBlock.mock.calls).toEqual([[1005]]);
  });
  it("reports unlimited time only while active", async () => {
    const view = new DataView(new ArrayBuffer(8));
    const seconds = async (state: number) => {
      const bits = await fixture(state).call("backgroundTimeRemaining");
      if (typeof bits !== "bigint") throw new Error("expected double bits");
      view.setBigUint64(0, bits, true);
      return view.getFloat64(0, true);
    };
    expect(await seconds(0)).toBe(Number.MAX_VALUE);
    expect(await seconds(2)).toBe(0);
  });
});
