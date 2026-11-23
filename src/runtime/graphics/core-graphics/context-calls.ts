import type { GuestArguments } from "../../ios/objc/host";
import { addBounds, addDeviceBounds, deviceBounds, drawPath, fillRect } from "./context-raster";
import { floatWords, type QuartzObjects } from "./quartz-objects";

export type Imports = Record<string, (args: GuestArguments) => unknown>;

const Argument = { Context: 0, First: 1, Clockwise: 6 } as const;
const Count = { Point: 2, Arc: 5, Rect: 4, Scale: 2 } as const;
const DIAMETER = 2;

export function setAntialias(objects: QuartzObjects, pointer: number, enabled: boolean): void {
  const object = objects.context(pointer);
  if (!object) return;
  object.antialias = enabled;
  object.canvas.imageSmoothingEnabled = enabled;
}

/** The context stack and the graphics-state, path and fill calls that track device bounds. */
export function contextCallImports(objects: QuartzObjects): Imports {
  return {
    _UIGraphicsGetCurrentContext: () => objects.current(),
    _UIGraphicsPushContext: (a) => {
      const pointer = a(Argument.Context);
      if (objects.context(pointer)) objects.push(pointer);
    },
    _UIGraphicsPopContext: () => objects.pop(),
    _CGContextSaveGState: (a) => {
      const object = objects.context(a(Argument.Context));
      if (!object) return;
      object.canvas.save();
      object.saves++;
    },
    _CGContextRestoreGState: (a) => {
      const object = objects.context(a(Argument.Context));
      if (!object?.saves) return;
      object.canvas.restore();
      object.saves--;
    },
    _CGContextScaleCTM: (a) => {
      const [x = 0, y = 0] = floatWords(a, Argument.First, Count.Scale);
      objects.canvas(a(Argument.Context))?.scale(x, y);
    },
    _CGContextSetAllowsAntialiasing: (a) =>
      setAntialias(objects, a(Argument.Context), Boolean(a(Argument.First))),
    _CGContextMoveToPoint: (a) => {
      const object = objects.context(a(Argument.Context));
      if (!object) return;
      const [x = 0, y = 0] = floatWords(a, Argument.First, Count.Point);
      object.canvas.moveTo(x, y);
      addBounds(object, deviceBounds(object.canvas, x, y, 0, 0));
    },
    _CGContextClosePath: (a) => objects.canvas(a(Argument.Context))?.closePath(),
    _CGContextAddArc: (a) => {
      const object = objects.context(a(Argument.Context));
      if (!object) return;
      const [x = 0, y = 0, radius = 0, from = 0, to = 0] = floatWords(a, Argument.First, Count.Arc);
      object.canvas.arc(x, y, radius, from, to, Boolean(a(Argument.Clockwise)));
      addDeviceBounds(
        objects,
        a(Argument.Context),
        x - radius,
        y - radius,
        DIAMETER * radius,
        DIAMETER * radius,
      );
    },
    _CGContextFillRect: (a) => {
      const object = objects.context(a(Argument.Context));
      if (!object) return;
      const [x = 0, y = 0, width = 0, height = 0] = floatWords(a, Argument.First, Count.Rect);
      fillRect(object, x, y, width, height);
    },
    _CGContextDrawPath: (a) => {
      const object = objects.context(a(Argument.Context));
      if (object) drawPath(object, a(Argument.First));
    },
  };
}
