import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
const STROKE_PATH = 2;
const Argument = { Context: 0, X: 1, Y: 2, Width: 3, Height: 4 } as const;
interface PathHost {
  context(
    pointer: number,
  ): Pick<CanvasRenderingContext2D, "beginPath" | "rect" | "lineTo" | "clip"> | null;
  reset(pointer: number): void;
  bounds(pointer: number, x: number, y: number, width: number, height: number): void;
  draw(pointer: number, mode: number): void;
}
export function pathImports(host: PathHost) {
  return {
    _CGContextBeginPath: (args: GuestArguments) => {
      host.context(args(0))?.beginPath();
      host.reset(args(0));
    },
    _CGContextAddRect: (args: GuestArguments) => {
      const pointer = args(Argument.Context),
        x = floatFromBits(args(Argument.X)),
        y = floatFromBits(args(Argument.Y)),
        w = floatFromBits(args(Argument.Width)),
        h = floatFromBits(args(Argument.Height));
      host.context(pointer)?.rect(x, y, w, h);
      host.bounds(pointer, x, y, w, h);
    },
    _CGContextAddLineToPoint: (args: GuestArguments) => {
      const pointer = args(Argument.Context),
        x = floatFromBits(args(Argument.X)),
        y = floatFromBits(args(Argument.Y));
      host.context(pointer)?.lineTo(x, y);
      host.bounds(pointer, x, y, 0, 0);
    },
    _CGContextFillPath: (args: GuestArguments) => host.draw(args(0), 0),
    _CGContextStrokePath: (args: GuestArguments) => host.draw(args(0), STROKE_PATH),
    _CGContextClip: (args: GuestArguments) => {
      const pointer = args(0);
      const context = host.context(pointer);
      context?.clip();
      context?.beginPath();
      host.reset(pointer);
    },
  };
}
