import { expect, test } from "vite-plus/test";
import { PlacementCache, type PlacedView } from "./placement-cache";

test("placements are reused until the view, an ancestor or the screen changes", () => {
  const views = new Map<number, PlacedView & { frame: number[] }>([
    [1, { frame: [0, 0, 320, 480], bounds: [0, 0, 320, 480], clipsToBounds: 1 }],
    [2, { frame: [10, 10, 50, 50], bounds: [0, 0, 50, 50], parent: 1 }],
  ]);
  const read = (view: number) => views.get(view) ?? { frame: [], bounds: [] };
  const cache = new PlacementCache<number>();
  let computed = 0;
  const place = (screen: number[]) => cache.get(2, read, screen, () => ++computed);
  expect(place([0, 0, 320, 480])).toBe(1);
  expect(place([0, 0, 320, 480])).toBe(1);
  const parent = views.get(1);
  if (parent) parent.frame[0] = 5;
  expect(place([0, 0, 320, 480])).toBe(2);
  expect(place([0, 0, 480, 320])).toBe(3);
  cache.forget(2);
  expect(place([0, 0, 480, 320])).toBe(4);
});
