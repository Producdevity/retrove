import type { Point } from "../scroll/state";
import type { Rectangle } from "../host";
const THIRD_CORNER = 2;
const EPSILON = 1e-9;
const PERCENT = 100;
interface ClipState {
  readonly parent: number;
  readonly bounds: Rectangle;
  readonly clipsToBounds?: number;
  readonly masksToBounds?: number;
}
interface ClipHost {
  view(pointer: number): ClipState;
  convert(point: Point, from: number, to: number): Point;
}
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function corners([x, y, w, h]: Rectangle): Point[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}
function intersect(subject: Point[], clip: Point[]): Point[] {
  let polygon = subject;
  const orientation =
    cross(clip[0] ?? [0, 0], clip[1] ?? [0, 0], clip[THIRD_CORNER] ?? [0, 0]) < 0 ? -1 : 1;
  for (let index = 0; index < clip.length; index++) {
    const a = clip[index],
      b = clip[(index + 1) % clip.length];
    if (!a || !b) continue;
    const input = polygon;
    polygon = [];
    for (let cursor = 0; cursor < input.length; cursor++) {
      const p = input[cursor],
        q = input[(cursor + 1) % input.length];
      if (!p || !q) continue;
      const first = cross(a, b, p) * orientation,
        last = cross(a, b, q) * orientation;
      if (first >= -EPSILON) polygon.push(p);
      if (first >= -EPSILON !== last >= -EPSILON) {
        const ratio = first / (first - last);
        polygon.push([p[0] + (q[0] - p[0]) * ratio, p[1] + (q[1] - p[1]) * ratio]);
      }
    }
  }
  return polygon;
}
export function viewClip(host: ClipHost, self: number, window: number): string {
  const [x, y, w, h] = host.view(self).bounds;
  if (!(w > 0 && h > 0)) return "none";
  let polygon = corners([x, y, w, h]),
    clipped = false;
  for (let parent = host.view(self).parent; parent; parent = host.view(parent).parent) {
    const state = host.view(parent);
    if (parent !== window && !state.clipsToBounds && !state.masksToBounds) continue;
    polygon = intersect(
      polygon,
      corners(state.bounds).map((point) => host.convert(point, parent, self)),
    );
    clipped = true;
  }
  if (!clipped) return "none";
  if (!polygon.length) return "polygon(0% 0%,0% 0%,0% 0%)";
  return (
    "polygon(" +
    polygon
      .map((point) => `${((point[0] - x) / w) * PERCENT}% ${((point[1] - y) / h) * PERCENT}%`)
      .join(",") +
    ")"
  );
}
