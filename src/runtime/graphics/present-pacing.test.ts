import { expect, test } from "vite-plus/test";
import { DISPLAY_INTERVAL_MS } from "../ios/uikit/application/display-refresh";
import { PresentPacing } from "./present-pacing";

test("one present per display refresh, and none held while frames stall", () => {
  const frames: (() => void)[] = [];
  const pacing = new PresentPacing((callback) => frames.push(callback), 0);
  expect(pacing.take(1)).toBe(true);
  expect(pacing.take(2)).toBe(false);
  frames.shift()?.();
  expect(pacing.take(performance.now())).toBe(true);
  expect(pacing.take(performance.now())).toBe(false);
  const stalled = performance.now() + 3 * DISPLAY_INTERVAL_MS;
  expect(pacing.take(stalled)).toBe(true);
  expect(pacing.take(stalled + 1)).toBe(false);
  pacing.close();
});
