import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";

const DrawMode = { Fill: 0, EOFill: 1, Stroke: 2 } as const;
const COLOR_MAXIMUM = 255;
const RGB_COMPONENTS = 3;
const RECT_FLOATS = 4;
const POINT_FLOATS = 2;
const SEGMENT_POINTS = 2;
/** CGContextSetLineDash(context, phase, lengths, count). */
const DASH_COUNT = 3;
const ARC_TO_FLOATS = 5;
const CURVE_FLOATS = 6;
const HALF = 2;
const FULL_TURN = Math.PI * HALF;
/** CGContextAddLines and CGContextStrokeLineSegments take (context, points, count). */
const Points = { Address: 1, Count: 2 } as const;
const CAPS = ["butt", "round", "square"] as const;
const JOINS = ["miter", "round", "bevel"] as const;
/** CGBlendMode in order, from kCGBlendModeNormal (0) to kCGBlendModePlusLighter (27). */
const BLENDS: readonly GlobalCompositeOperation[] = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "destination-out",
  "copy",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "xor",
  "darken",
  "lighter",
];
export type DrawingCanvas = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "rect"
  | "ellipse"
  | "arcTo"
  | "bezierCurveTo"
  | "quadraticCurveTo"
  | "rotate"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "miterLimit"
  | "lineDashOffset"
  | "globalCompositeOperation"
>;
export interface ContextDrawingHost {
  context(pointer: number): DrawingCanvas | null;
  bounds(pointer: number, x: number, y: number, width: number, height: number): void;
  draw(pointer: number, mode: number): void;
  floats(address: number, count: number): number[];
  spaceComponents(space: number): number | undefined;
}

/** The CSS color for gray or RGB components followed by alpha. */
export function componentColor(components: readonly number[]): string {
  const [first = 0, second = 0, third = 0, fourth = 1] = components;
  const gray = components.length <= POINT_FLOATS;
  const [red, green, blue] = gray ? [first, first, first] : [first, second, third];
  const alpha = gray ? second : fourth;
  return `rgba(${red * COLOR_MAXIMUM},${green * COLOR_MAXIMUM},${blue * COLOR_MAXIMUM},${alpha})`;
}

type Imports = Record<string, (args: GuestArguments) => void>;
const values = (args: GuestArguments, first: number, count: number) =>
  Array.from({ length: count }, (_, index) => floatFromBits(args(first + index)));

export function contextDrawingImports(host: ContextDrawingHost): Imports {
  return {
    ...shapeImports(host),
    ...curveImports(host),
    ...styleImports(host),
    ...colorImports(host),
  };
}

function shapeImports(host: ContextDrawingHost): Imports {
  const ellipse = (args: GuestArguments) => {
    const pointer = args(0),
      [x = 0, y = 0, width = 0, height = 0] = values(args, 1, RECT_FLOATS);
    host
      .context(pointer)
      ?.ellipse(
        x + width / HALF,
        y + height / HALF,
        Math.abs(width / HALF),
        Math.abs(height / HALF),
        0,
        0,
        FULL_TURN,
      );
    host.bounds(pointer, x, y, width, height);
  };
  const rect = (args: GuestArguments) => {
    const [x = 0, y = 0, width = 0, height = 0] = values(args, 1, RECT_FLOATS);
    host.context(args(0))?.rect(x, y, width, height);
    host.bounds(args(0), x, y, width, height);
  };
  const shape = (args: GuestArguments, add: (args: GuestArguments) => void, mode: number) => {
    host.context(args(0))?.beginPath();
    add(args);
    host.draw(args(0), mode);
  };
  const lines = (pointer: number, address: number, count: number, segments: boolean) => {
    const canvas = host.context(pointer);
    if (!canvas || !address) return;
    const points = host.floats(address, count * POINT_FLOATS);
    for (let index = 0; index < count; index++) {
      const x = points[index * POINT_FLOATS] ?? 0,
        y = points[index * POINT_FLOATS + 1] ?? 0;
      if (index === 0 || (segments && index % SEGMENT_POINTS === 0)) canvas.moveTo(x, y);
      else canvas.lineTo(x, y);
      host.bounds(pointer, x, y, 0, 0);
    }
  };
  return {
    _CGContextAddEllipseInRect: ellipse,
    _CGContextFillEllipseInRect: (args) => shape(args, ellipse, DrawMode.Fill),
    _CGContextStrokeEllipseInRect: (args) => shape(args, ellipse, DrawMode.Stroke),
    _CGContextStrokeRect: (args) => shape(args, rect, DrawMode.Stroke),
    _CGContextStrokeRectWithWidth: (args) => {
      const canvas = host.context(args(0));
      if (canvas) canvas.lineWidth = floatFromBits(args(1 + RECT_FLOATS));
      shape(args, rect, DrawMode.Stroke);
    },
    _CGContextAddLines: (args) => lines(args(0), args(Points.Address), args(Points.Count), false),
    _CGContextStrokeLineSegments: (args) => {
      host.context(args(0))?.beginPath();
      lines(args(0), args(Points.Address), args(Points.Count), true);
      host.draw(args(0), DrawMode.Stroke);
    },
    _CGContextEOFillPath: (args) => host.draw(args(0), DrawMode.EOFill),
  };
}

function curveImports(host: ContextDrawingHost): Imports {
  const points = (pointer: number, coordinates: readonly number[]) => {
    for (let index = 0; index < coordinates.length; index += POINT_FLOATS)
      host.bounds(pointer, coordinates[index] ?? 0, coordinates[index + 1] ?? 0, 0, 0);
  };
  return {
    _CGContextAddArcToPoint: (args) => {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, radius = 0] = values(args, 1, ARC_TO_FLOATS);
      host.context(args(0))?.arcTo(x1, y1, x2, y2, radius);
      points(args(0), [x1, y1, x2, y2]);
    },
    _CGContextAddCurveToPoint: (args) => {
      const coordinates = values(args, 1, CURVE_FLOATS);
      const [c1x = 0, c1y = 0, c2x = 0, c2y = 0, x = 0, y = 0] = coordinates;
      host.context(args(0))?.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
      points(args(0), coordinates);
    },
    _CGContextAddQuadCurveToPoint: (args) => {
      const coordinates = values(args, 1, RECT_FLOATS);
      const [cx = 0, cy = 0, x = 0, y = 0] = coordinates;
      host.context(args(0))?.quadraticCurveTo(cx, cy, x, y);
      points(args(0), coordinates);
    },
    _CGContextRotateCTM: (args) => host.context(args(0))?.rotate(floatFromBits(args(1))),
  };
}

function styleImports(host: ContextDrawingHost): Imports {
  const style = <Key extends "lineCap" | "lineJoin" | "miterLimit" | "globalCompositeOperation">(
    pointer: number,
    key: Key,
    value: DrawingCanvas[Key] | undefined,
  ) => {
    const canvas = host.context(pointer);
    if (canvas && value !== undefined) canvas[key] = value;
  };
  return {
    _CGContextSetLineCap: (args) => style(args(0), "lineCap", CAPS[args(1)]),
    _CGContextSetLineJoin: (args) => style(args(0), "lineJoin", JOINS[args(1)]),
    _CGContextSetMiterLimit: (args) => style(args(0), "miterLimit", floatFromBits(args(1))),
    _CGContextSetBlendMode: (args) => style(args(0), "globalCompositeOperation", BLENDS[args(1)]),
    _CGContextSetLineDash: (args) => {
      const canvas = host.context(args(0));
      if (!canvas) return;
      canvas.lineDashOffset = floatFromBits(args(1));
      canvas.setLineDash(
        args(SEGMENT_POINTS) && args(DASH_COUNT)
          ? host.floats(args(SEGMENT_POINTS), args(DASH_COUNT))
          : [],
      );
    },
  };
}

function colorImports(host: ContextDrawingHost): Imports {
  const spaces = new Map<number, { fill: number; stroke: number }>();
  const space = (pointer: number) => {
    let entry = spaces.get(pointer);
    if (!entry) {
      entry = { fill: RGB_COMPONENTS, stroke: RGB_COMPONENTS };
      spaces.set(pointer, entry);
    }
    return entry;
  };
  const setColor = (args: GuestArguments, stroke: boolean) => {
    const canvas = host.context(args(0));
    if (!canvas || !args(1)) return;
    const entry = space(args(0));
    const value = componentColor(host.floats(args(1), (stroke ? entry.stroke : entry.fill) + 1));
    if (stroke) canvas.strokeStyle = value;
    else canvas.fillStyle = value;
  };
  const setSpace = (args: GuestArguments, stroke: boolean) => {
    const components = host.spaceComponents(args(1)) ?? RGB_COMPONENTS;
    if (stroke) space(args(0)).stroke = components;
    else space(args(0)).fill = components;
  };
  return {
    _CGContextSetFillColorSpace: (args) => setSpace(args, false),
    _CGContextSetStrokeColorSpace: (args) => setSpace(args, true),
    _CGContextSetFillColor: (args) => setColor(args, false),
    _CGContextSetStrokeColor: (args) => setColor(args, true),
  };
}
