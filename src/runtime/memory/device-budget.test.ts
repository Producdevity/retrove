import { describe, expect, it } from "vite-plus/test";
import { checkDeviceReserve, CodeBudgetBytes, deviceBudget } from "./device-budget";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
const pause = () => Promise.resolve();

describe("device budget", () => {
  it("keeps full budgets until a check has run", () => {
    expect(deviceBudget(memoryStorage(), undefined)).toEqual({
      measured: false,
      reserveMB: 3072,
      translation: true,
      codeBytes: CodeBudgetBytes.Full,
    });
  });
  it("stops at the first refused step and reduces budgets below the limits", async () => {
    const storage = memoryStorage();
    let grown = 0;
    const grow = () => {
      if (++grown > 6) throw new RangeError("out of memory");
    };
    await checkDeviceReserve({ storage, grow, pause });
    expect(deviceBudget(storage, undefined)).toMatchObject({
      measured: true,
      reserveMB: 1536,
      translation: false,
      codeBytes: CodeBudgetBytes.Reduced,
    });
    await checkDeviceReserve({ storage, grow: () => expect.unreachable(), pause });
  });
  it("treats a check the page did not survive as its limit", async () => {
    const storage = memoryStorage();
    const record = { version: 1, reserveMB: 2048, attemptMB: 2304, done: false };
    storage.setItem("retrove.deviceBudget", JSON.stringify(record));
    expect(deviceBudget(storage, undefined)).toMatchObject({
      measured: true,
      reserveMB: 2048,
      translation: true,
      codeBytes: CodeBudgetBytes.Reduced,
    });
    await checkDeviceReserve({ storage, grow: () => expect.unreachable(), pause });
    expect(JSON.parse(storage.getItem("retrove.deviceBudget") ?? "{}")).toMatchObject({
      done: true,
    });
  });
  it("reduces the code budget on devices reporting little memory", () => {
    const storage = memoryStorage();
    storage.setItem(
      "retrove.deviceBudget",
      JSON.stringify({ version: 1, reserveMB: 3072, attemptMB: 3072, done: true }),
    );
    expect(deviceBudget(storage, 2).codeBytes).toBe(CodeBudgetBytes.Reduced);
    expect(deviceBudget(storage, 8).codeBytes).toBe(CodeBudgetBytes.Full);
  });
});
