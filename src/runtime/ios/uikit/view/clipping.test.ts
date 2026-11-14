import { expect, test } from "vite-plus/test";
import { viewClip } from "./clipping";
import type { Rectangle } from "../host";
import type { Point } from "../scroll/state";
interface Node {
  parent: number;
  bounds: Rectangle;
  clipsToBounds: number;
}
const nodes: Readonly<Record<number, Node>> = {
  1: { parent: 0, bounds: [0, 0, 320, 480], clipsToBounds: 0 },
  2: { parent: 1, bounds: [0, 100, 300, 300], clipsToBounds: 1 },
  3: { parent: 2, bounds: [0, 0, 100, 50], clipsToBounds: 0 },
};
test("scrolled descendants are clipped in their own coordinates", () => {
  const host = {
    view: (p: number) =>
      nodes[p] ?? nodes[1] ?? { parent: 0, bounds: [0, 0, 0, 0], clipsToBounds: 0 },
    convert: ([x, y]: Point, from: number): Point => (from === 2 ? [x, y - 120] : [x, y]),
  };
  const polygon = viewClip(host, 3, 1);
  expect(polygon).toContain("0% 0%");
  expect(polygon).toContain("100% 100%");
  const outside = {
    ...host,
    convert: ([x, y]: Point, from: number): Point => (from === 2 ? [x, y + 1000] : [x, y]),
  };
  expect(viewClip(outside, 3, 1)).toBe("polygon(0% 0%,0% 0%,0% 0%)");
});
