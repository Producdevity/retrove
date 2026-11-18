import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import { QuartzTable, type TableMemory } from "./quartz-table";

type Point = readonly [number, number];
export type Segment =
  | { readonly op: "move" | "line"; readonly to: Point }
  | { readonly op: "arcTo"; readonly from: Point; readonly to: Point; readonly radius: number }
  | { readonly op: "curve"; readonly first: Point; readonly second: Point; readonly to: Point }
  | { readonly op: "quad"; readonly control: Point; readonly to: Point }
  | { readonly op: "close" };
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
}
interface PathHost extends TableMemory {
  floats(address: number, count: number): number[];
  context(pointer: number): PathSink | null;
  bounds(pointer: number, x: number, y: number, width: number, height: number): void;
}
/** CGPath functions take (path, transform, values...). */
const Arg = { Path: 0, Transform: 1, Values: 2 } as const;
const TRANSFORM_FLOATS = 6;
/** Float arguments after (path, transform) for each CGPath call. */
const Floats = { Point: 2, Quad: 4, Rect: 4, ArcTo: 5, Curve: 6 } as const;
const HALF = 2;
/** Control-point distance for a quarter-circle cubic Bézier. */
const KAPPA = 0.5522847498;

type Transform = (point: Point) => Point;
function transform(host: PathHost, pointer: number): { map: Transform; scale: number } {
  if (!pointer) return { map: (point) => point, scale: 1 };
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = host.floats(pointer, TRANSFORM_FLOATS);
  return {
    map: ([x, y]) => [a * x + c * y + tx, b * x + d * y + ty],
    scale: Math.sqrt(Math.abs(a * d - b * c)),
  };
}
function ellipse([x, y, width, height]: readonly number[]): Segment[] {
  const rx = (width ?? 0) / HALF,
    ry = (height ?? 0) / HALF,
    cx = (x ?? 0) + rx,
    cy = (y ?? 0) + ry;
  const kx = rx * KAPPA,
    ky = ry * KAPPA;
  return [
    { op: "move", to: [cx + rx, cy] },
    { op: "curve", first: [cx + rx, cy + ky], second: [cx + kx, cy + ry], to: [cx, cy + ry] },
    { op: "curve", first: [cx - kx, cy + ry], second: [cx - rx, cy + ky], to: [cx - rx, cy] },
    { op: "curve", first: [cx - rx, cy - ky], second: [cx - kx, cy - ry], to: [cx, cy - ry] },
    { op: "curve", first: [cx + kx, cy - ry], second: [cx + rx, cy - ky], to: [cx + rx, cy] },
    { op: "close" },
  ];
}
function rectangle([x = 0, y = 0, width = 0, height = 0]: readonly number[]): Segment[] {
  return [
    { op: "move", to: [x, y] },
    { op: "line", to: [x + width, y] },
    { op: "line", to: [x + width, y + height] },
    { op: "line", to: [x, y + height] },
    { op: "close" },
  ];
}
function mapped(segment: Segment, map: Transform, scale: number): Segment {
  switch (segment.op) {
    case "close":
      return segment;
    case "arcTo":
      return {
        ...segment,
        from: map(segment.from),
        to: map(segment.to),
        radius: segment.radius * scale,
      };
    case "curve":
      return {
        op: "curve",
        first: map(segment.first),
        second: map(segment.second),
        to: map(segment.to),
      };
    case "quad":
      return { op: "quad", control: map(segment.control), to: map(segment.to) };
    default:
      return { op: segment.op, to: map(segment.to) };
  }
}
/** Points a segment passes through or is bounded by, for bounds tracking. */
export function segmentPoints(segment: Segment): Point[] {
  switch (segment.op) {
    case "close":
      return [];
    case "arcTo":
      return [segment.from, segment.to];
    case "curve":
      return [segment.first, segment.second, segment.to];
    case "quad":
      return [segment.control, segment.to];
    default:
      return [segment.to];
  }
}
export function replay(sink: PathSink, segments: readonly Segment[]): void {
  for (const segment of segments) {
    switch (segment.op) {
      case "close":
        sink.closePath();
        break;
      case "move":
        sink.moveTo(...segment.to);
        break;
      case "line":
        sink.lineTo(...segment.to);
        break;
      case "arcTo":
        sink.arcTo(...segment.from, ...segment.to, segment.radius);
        break;
      case "curve":
        sink.bezierCurveTo(...segment.first, ...segment.second, ...segment.to);
        break;
      case "quad":
        sink.quadraticCurveTo(...segment.control, ...segment.to);
    }
  }
}

export function cgPathImports(host: PathHost) {
  const paths = new QuartzTable<Segment[]>(host);
  const values = (args: GuestArguments, count: number) =>
    Array.from({ length: count }, (_, index) => floatFromBits(args(Arg.Values + index)));
  const add = (args: GuestArguments, segments: (values: number[]) => Segment[], count: number) => {
    const path = paths.get(args(Arg.Path));
    if (!path) return;
    const { map, scale } = transform(host, args(Arg.Transform));
    path.push(...segments(values(args, count)).map((segment) => mapped(segment, map, scale)));
  };
  const imports = {
    _CGPathCreateMutable: () => paths.add([]),
    _CGPathCreateCopy: (args: GuestArguments) => {
      const path = paths.get(args(0));
      return path ? paths.add([...path]) : 0;
    },
    _CGPathCreateMutableCopy: (args: GuestArguments) => imports._CGPathCreateCopy(args),
    _CGPathRetain: (args: GuestArguments) => (args(0) ? paths.retain(args(0)) : 0),
    _CGPathRelease: (args: GuestArguments) => paths.release(args(0)),
    _CGPathIsEmpty: (args: GuestArguments) => Number(!paths.get(args(0))?.length),
    _CGPathMoveToPoint: (args: GuestArguments) =>
      add(args, ([x = 0, y = 0]) => [{ op: "move", to: [x, y] }], Floats.Point),
    _CGPathAddLineToPoint: (args: GuestArguments) =>
      add(args, ([x = 0, y = 0]) => [{ op: "line", to: [x, y] }], Floats.Point),
    _CGPathAddArcToPoint: (args: GuestArguments) =>
      add(
        args,
        ([x1 = 0, y1 = 0, x2 = 0, y2 = 0, radius = 0]) => [
          { op: "arcTo", from: [x1, y1], to: [x2, y2], radius },
        ],
        Floats.ArcTo,
      ),
    _CGPathAddCurveToPoint: (args: GuestArguments) =>
      add(
        args,
        ([a = 0, b = 0, c = 0, d = 0, x = 0, y = 0]) => [
          { op: "curve", first: [a, b], second: [c, d], to: [x, y] },
        ],
        Floats.Curve,
      ),
    _CGPathAddQuadCurveToPoint: (args: GuestArguments) =>
      add(
        args,
        ([cx = 0, cy = 0, x = 0, y = 0]) => [{ op: "quad", control: [cx, cy], to: [x, y] }],
        Floats.Quad,
      ),
    _CGPathAddRect: (args: GuestArguments) => add(args, rectangle, Floats.Rect),
    _CGPathAddEllipseInRect: (args: GuestArguments) => add(args, ellipse, Floats.Rect),
    _CGPathCloseSubpath: (args: GuestArguments) => void paths.get(args(0))?.push({ op: "close" }),
    _CGContextAddPath: (args: GuestArguments) => {
      const context = host.context(args(0)),
        path = paths.get(args(1));
      if (!context || !path) return;
      replay(context, path);
      for (const [x, y] of path.flatMap(segmentPoints)) host.bounds(args(0), x, y, 0, 0);
    },
  };
  return { imports, paths };
}
