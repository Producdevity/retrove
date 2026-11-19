import { describe, expect, it } from "vite-plus/test";
import { CodeBudgetBytes, deviceBudget } from "./device-budget";
import { checkDeviceTouch, TOUCH_LIMIT_MB, touchedLimitMB } from "./touch-check";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
const pause = () => Promise.resolve();

describe("touch check", () => {
  it("is unmeasured until a check has run", () => {
    expect(touchedLimitMB(memoryStorage())).toBeUndefined();
  });
  it("stops at the first refused step", async () => {
    const storage = memoryStorage();
    let steps = 0;
    const touch = () => {
      if (++steps > 4) throw new RangeError("out of memory");
    };
    await checkDeviceTouch({ storage, touch, pause });
    expect(touchedLimitMB(storage)).toBe(512);
    await checkDeviceTouch({ storage, touch: () => expect.unreachable(), pause });
  });
  it("takes the step the page did not survive as its limit", async () => {
    const storage = memoryStorage();
    const record = { version: 1, touchMB: 1408, attemptMB: 1536, done: false };
    storage.setItem("retrove.deviceTouch", JSON.stringify(record));
    expect(touchedLimitMB(storage)).toBe(1408);
    await checkDeviceTouch({ storage, touch: () => expect.unreachable(), pause });
    expect(JSON.parse(storage.getItem("retrove.deviceTouch") ?? "{}")).toMatchObject({
      done: true,
    });
  });
  it("skips the fill on devices reporting plenty of memory", async () => {
    const storage = memoryStorage();
    await checkDeviceTouch({ storage, deviceMemoryGB: 8, touch: () => expect.unreachable() });
    expect(touchedLimitMB(storage)).toBe(TOUCH_LIMIT_MB);
  });
  it("reduces budgets below the limit and turns translation off when memory is scarce", () => {
    const storage = memoryStorage();
    expect(deviceBudget(storage, undefined, TOUCH_LIMIT_MB).codeBytes).toBe(CodeBudgetBytes.Full);
    expect(deviceBudget(storage, undefined, 1408)).toMatchObject({
      translation: true,
      codeBytes: CodeBudgetBytes.Reduced,
    });
    expect(deviceBudget(storage, undefined, 640).translation).toBe(false);
  });
});
