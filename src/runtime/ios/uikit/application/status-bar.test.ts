import { describe, expect, it } from "vite-plus/test";
import { TALL_SCREEN } from "../screen";
import { statusBarFrame, STATUS_BAR_HEIGHT } from "./status-bar";

describe("status bar", () => {
  it("reports its frame in portrait screen points", () => {
    expect(statusBarFrame({ hidden: false, orientation: 1, style: 0 }, TALL_SCREEN)).toEqual([
      0,
      0,
      320,
      STATUS_BAR_HEIGHT,
    ]);
    expect(statusBarFrame({ hidden: false, orientation: 3, style: 0 }, TALL_SCREEN)).toEqual([
      0,
      0,
      STATUS_BAR_HEIGHT,
      568,
    ]);
    expect(statusBarFrame({ hidden: true, orientation: 1, style: 0 }, TALL_SCREEN)).toEqual([
      0, 0, 0, 0,
    ]);
  });
});
