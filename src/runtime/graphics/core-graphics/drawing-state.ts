import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
const Channel = { Context: 0, Red: 1, Green: 2, Blue: 3, Alpha: 4, Gray: 1, GrayAlpha: 2 } as const;
const COLOR_MAXIMUM = 255;
interface DrawingHost {
  context(
    pointer: number,
  ): Pick<
    CanvasRenderingContext2D,
    "fillStyle" | "strokeStyle" | "globalAlpha" | "lineWidth"
  > | null;
}
export function drawingStateImports(host: DrawingHost) {
  const color = (args: GuestArguments, gray: boolean, stroke: boolean): void => {
    const context = host.context(args(Channel.Context));
    if (!context) return;
    const red = floatFromBits(args(Channel.Red)),
      green = gray ? red : floatFromBits(args(Channel.Green)),
      blue = gray ? red : floatFromBits(args(Channel.Blue)),
      alpha = floatFromBits(args(gray ? Channel.GrayAlpha : Channel.Alpha));
    const value = `rgba(${red * COLOR_MAXIMUM},${green * COLOR_MAXIMUM},${blue * COLOR_MAXIMUM},${alpha})`;
    if (stroke) context.strokeStyle = value;
    else context.fillStyle = value;
  };
  return {
    _CGContextSetGrayFillColor: (args: GuestArguments) => color(args, true, false),
    _CGContextSetGrayStrokeColor: (args: GuestArguments) => color(args, true, true),
    _CGContextSetRGBFillColor: (args: GuestArguments) => color(args, false, false),
    _CGContextSetRGBStrokeColor: (args: GuestArguments) => color(args, false, true),
    _CGContextSetLineWidth: (args: GuestArguments) => {
      const context = host.context(args(0));
      if (context) context.lineWidth = floatFromBits(args(1));
    },
    _CGContextSetAlpha: (args: GuestArguments) => {
      const context = host.context(args(0));
      if (context) context.globalAlpha = floatFromBits(args(1));
    },
  };
}
