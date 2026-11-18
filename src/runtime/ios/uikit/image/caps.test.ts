import { expect, test } from "vite-plus/test";
import { capSlices, stretchableCaps } from "./caps";

test("stretchable caps keep the edges and stretch the band after each cap", () => {
  const caps = stretchableCaps(21, 31, 10, 15);
  expect(caps).toEqual({ left: 10, top: 15, right: 10, bottom: 15 });
  const slices = capSlices(21, 31, caps, [0, 0, 100, 60]);
  expect(slices).toHaveLength(9);
  expect(slices[0]).toEqual([0, 0, 10, 15, 0, 0, 10, 15]);
  expect(slices[4]).toEqual([10, 15, 1, 1, 10, 15, 80, 30]);
  expect(slices[8]).toEqual([11, 16, 10, 15, 90, 45, 10, 15]);
});

test("a zero cap stretches that axis whole and caps shrink into small targets", () => {
  expect(capSlices(20, 10, stretchableCaps(20, 10, 0, 0), [5, 5, 40, 30])).toEqual([
    [0, 0, 20, 10, 5, 5, 40, 30],
  ]);
  const small = capSlices(21, 21, stretchableCaps(21, 21, 10, 10), [0, 0, 10, 40]);
  expect(small.map((slice) => slice[6])).toEqual([5, 5, 5, 5, 5, 5]);
});
