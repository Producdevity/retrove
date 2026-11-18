import { describe, expect, it } from "vite-plus/test";
import { HotFunctions } from "./hot-functions";

describe("hot functions", () => {
  it("reports a function once it was entered the threshold number of times", () => {
    const hot = new HotFunctions(3);
    expect([hot.enter(0x2000), hot.enter(0x2000), hot.enter(0x2100)]).toEqual([
      false,
      false,
      false,
    ]);
    expect(hot.enter(0x2000)).toBe(true);
    expect(hot.enter(0x2100)).toBe(false);
  });
});
