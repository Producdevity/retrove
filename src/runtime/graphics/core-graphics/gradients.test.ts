import { expect, test } from "vite-plus/test";
import { gradientStops, linearBand } from "./gradients";

test("gradient stops read RGBA components and space missing locations evenly", () => {
  expect(gradientStops([1, 0, 0, 1, 0, 0, 1, 0.5, 0, 1, 0, 1], undefined, 3, 4)).toEqual([
    [0, "rgba(255,0,0,1)"],
    [0.5, "rgba(0,0,255,0.5)"],
    [1, "rgba(0,255,0,1)"],
  ]);
  expect(gradientStops([0.5, 1, 1, 1], [0.2, 2], 2, 2)).toEqual([
    [0.2, "rgba(127.5,127.5,127.5,1)"],
    [1, "rgba(255,255,255,1)"],
  ]);
});

test("a linear gradient paints between its ends unless asked to extend", () => {
  expect(linearBand([0, 0], [10, 0], 0, 100)).toEqual([
    [0, 100],
    [10, 100],
    [10, -100],
    [0, -100],
  ]);
  expect(linearBand([0, 0], [10, 0], 3, 100)?.map(([x]) => x)).toEqual([-100, 110, 110, -100]);
  expect(linearBand([4, 4], [4, 4], 0, 100)).toBeUndefined();
});
