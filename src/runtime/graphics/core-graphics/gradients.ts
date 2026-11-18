import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import { componentColor } from "./context-drawing";
import { QuartzTable, type TableMemory } from "./quartz-table";

type Stop = readonly [offset: number, color: string];
type GradientCanvas = Pick<
  CanvasRenderingContext2D,
  | "createLinearGradient"
  | "createRadialGradient"
  | "fillStyle"
  | "save"
  | "restore"
  | "getTransform"
> & {
  fill(path: Path2D): void;
  readonly canvas: { readonly width: number; readonly height: number };
};
interface GradientHost extends TableMemory {
  floats(address: number, count: number): number[];
  spaceComponents(space: number): number | undefined;
  /** Runs a drawing operation on a context, keeping bitmap memory in sync. */
  paint(pointer: number, draw: (canvas: GradientCanvas) => void): void;
}
const Option = { BeforeStart: 1, AfterEnd: 2 } as const;
const Linear = {
  Context: 0,
  Gradient: 1,
  StartX: 2,
  StartY: 3,
  EndX: 4,
  EndY: 5,
  Options: 6,
} as const;
const Radial = {
  Context: 0,
  Gradient: 1,
  StartX: 2,
  StartY: 3,
  StartRadius: 4,
  EndX: 5,
  EndY: 6,
  EndRadius: 7,
  Options: 8,
} as const;
const Create = { Space: 0, Components: 1, Locations: 2, Count: 3 } as const;

/** Color stops for CGGradientCreateWithColorComponents; locations default to even spacing. */
export function gradientStops(
  components: readonly number[],
  locations: readonly number[] | undefined,
  count: number,
  perColor: number,
): Stop[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = locations?.[index] ?? (count > 1 ? index / (count - 1) : 0);
    const color = componentColor(components.slice(index * perColor, (index + 1) * perColor));
    return [Math.min(1, Math.max(0, offset)), color];
  });
}

/** The user-space quadrilateral a linear gradient paints, extended past its ends when asked. */
export function linearBand(
  start: readonly [number, number],
  end: readonly [number, number],
  options: number,
  extent: number,
): [number, number][] | undefined {
  const dx = end[0] - start[0],
    dy = end[1] - start[1],
    length = Math.hypot(dx, dy);
  if (!length) return undefined;
  const ux = dx / length,
    uy = dy / length;
  const before = options & Option.BeforeStart ? extent : 0,
    after = options & Option.AfterEnd ? extent : 0;
  const from = [start[0] - ux * before, start[1] - uy * before] as const,
    to = [end[0] + ux * after, end[1] + uy * after] as const;
  const nx = -uy * extent,
    ny = ux * extent;
  return [
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
    [to[0] - nx, to[1] - ny],
    [from[0] - nx, from[1] - ny],
  ];
}

/** The canvas corners in user space, in drawing order. */
function userCorners(canvas: GradientCanvas): [number, number][] {
  const inverse = canvas.getTransform().inverse(),
    { width, height } = canvas.canvas;
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x = 0, y = 0]) => {
    const point = inverse.transformPoint({ x, y });
    return [point.x, point.y];
  });
}
/** A length from `origin` that reaches past every canvas corner. */
function reach(origin: readonly [number, number], corners: readonly [number, number][]): number {
  return Math.max(...corners.map(([x, y]) => Math.hypot(x - origin[0], y - origin[1]))) + 1;
}
const CIRCLE_SEGMENTS = 64;
const FULL_TURN = Math.PI + Math.PI;
function circle(x: number, y: number, radius: number): [number, number][] {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
    const angle = (index / CIRCLE_SEGMENTS) * FULL_TURN;
    return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
  });
}

export function gradientImports(host: GradientHost) {
  const gradients = new QuartzTable<Stop[]>(host);
  const fill = (canvas: GradientCanvas, style: CanvasGradient, polygon: [number, number][]) => {
    const path = new Path2D();
    polygon.forEach(([x, y], index) => (index ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    canvas.save();
    try {
      canvas.fillStyle = style;
      canvas.fill(path);
    } finally {
      canvas.restore();
    }
  };
  const styled = (style: CanvasGradient, stops: readonly Stop[]) => {
    for (const [offset, color] of stops) style.addColorStop(offset, color);
    return style;
  };
  const imports = {
    _CGGradientCreateWithColorComponents: (args: GuestArguments) => {
      const components = host.spaceComponents(args(Create.Space)),
        count = args(Create.Count);
      if (!components || !args(Create.Components) || count <= 0) return 0;
      const perColor = components + 1;
      return gradients.add(
        gradientStops(
          host.floats(args(Create.Components), count * perColor),
          args(Create.Locations) ? host.floats(args(Create.Locations), count) : undefined,
          count,
          perColor,
        ),
      );
    },
    _CGGradientRetain: (args: GuestArguments) => (args(0) ? gradients.retain(args(0)) : 0),
    _CGGradientRelease: (args: GuestArguments) => gradients.release(args(0)),
    _CGContextDrawLinearGradient: (args: GuestArguments) => {
      const stops = gradients.get(args(Linear.Gradient));
      if (!stops) return;
      const point = (x: number, y: number) =>
        [floatFromBits(args(x)), floatFromBits(args(y))] as const;
      const start = point(Linear.StartX, Linear.StartY),
        end = point(Linear.EndX, Linear.EndY);
      host.paint(args(Linear.Context), (canvas) => {
        const band = linearBand(
          start,
          end,
          args(Linear.Options),
          reach(start, userCorners(canvas)),
        );
        if (band) fill(canvas, styled(canvas.createLinearGradient(...start, ...end), stops), band);
      });
    },
    _CGContextDrawRadialGradient: (args: GuestArguments) => {
      const stops = gradients.get(args(Radial.Gradient));
      if (!stops) return;
      const value = (index: number) => floatFromBits(args(index));
      host.paint(args(Radial.Context), (canvas) => {
        const style = canvas.createRadialGradient(
          value(Radial.StartX),
          value(Radial.StartY),
          Math.max(0, value(Radial.StartRadius)),
          value(Radial.EndX),
          value(Radial.EndY),
          Math.max(0, value(Radial.EndRadius)),
        );
        const area =
          args(Radial.Options) & Option.AfterEnd
            ? userCorners(canvas)
            : circle(value(Radial.EndX), value(Radial.EndY), Math.max(0, value(Radial.EndRadius)));
        fill(canvas, styled(style, stops), area);
      });
    },
  };
  return { imports, gradients };
}
