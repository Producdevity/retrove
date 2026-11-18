import { expect, test } from "vite-plus/test";
import { animationFrame } from "./animation";

test("animation frames cycle through the images and stop after the repeat count", () => {
  expect(animationFrame(4, 1, 0, 0)).toBe(0);
  expect(animationFrame(4, 1, 0, 0.5)).toBe(2);
  expect(animationFrame(4, 1, 0, 2.76)).toBe(3);
  expect(animationFrame(4, 1, 2, 1.9)).toBe(3);
  expect(animationFrame(4, 1, 2, 2)).toBeUndefined();
  expect(animationFrame(0, 1, 0, 0)).toBeUndefined();
});
