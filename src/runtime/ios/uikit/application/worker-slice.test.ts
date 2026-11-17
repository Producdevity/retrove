import { expect, test } from "vite-plus/test";
import { DISPLAY_INTERVAL_MS, workerSliceMs } from "./display-refresh";

test("worker threads receive the rest of the refresh interval", () => {
  expect(workerSliceMs(100, 101)).toBeCloseTo(DISPLAY_INTERVAL_MS - 3);
});

test("a late main thread still leaves worker threads a minimum slice", () => {
  expect(workerSliceMs(100, 100 + DISPLAY_INTERVAL_MS)).toBe(8);
});
