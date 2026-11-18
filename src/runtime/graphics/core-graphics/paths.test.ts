import { expect, test } from "vite-plus/test";
import { floatBits } from "../../ios/abi/scalars";
import { cgPathImports, type PathSink } from "./paths";

test("a CGPath records transformed segments and replays them into a context", () => {
  let next = 0x100;
  const transforms = new Map([[0x900, [2, 0, 0, 2, 10, 20]]]);
  const calls: string[] = [];
  const sink: PathSink = {
    moveTo: (x, y) => calls.push(`M${x},${y}`),
    lineTo: (x, y) => calls.push(`L${x},${y}`),
    arcTo: (x1, y1, x2, y2, r) => calls.push(`A${x1},${y1},${x2},${y2},${r}`),
    bezierCurveTo: () => calls.push("C"),
    quadraticCurveTo: () => calls.push("Q"),
    closePath: () => calls.push("Z"),
  };
  const bounds: number[][] = [];
  const { imports, paths } = cgPathImports({
    allocate: () => (next += 4),
    free: () => undefined,
    floats: (address, count) => (transforms.get(address) ?? []).slice(0, count),
    context: (pointer) => (pointer === 1 ? sink : null),
    bounds: (_pointer, x, y) => bounds.push([x, y]),
  });
  const path = imports._CGPathCreateMutable();
  const call = (name: keyof typeof imports, ...values: number[]) =>
    imports[name]((index) => values[index] ?? 0);
  call("_CGPathMoveToPoint", path, 0x900, floatBits(1), floatBits(2));
  call("_CGPathAddArcToPoint", path, 0, ...[5, 0, 5, 5, 3].map(floatBits));
  call("_CGPathCloseSubpath", path);
  expect(call("_CGPathIsEmpty", path)).toBe(0);
  call("_CGContextAddPath", 1, path);
  expect(calls).toEqual(["M12,24", "A5,0,5,5,3", "Z"]);
  expect(bounds).toEqual([
    [12, 24],
    [5, 0],
    [5, 5],
  ]);
  expect(call("_CGPathRetain", path)).toBe(path);
  call("_CGPathRelease", path);
  call("_CGPathRelease", path);
  expect(paths.has(path)).toBe(false);
});
