import { structureMethod } from "../host";
import type { StructureMethod } from "../host";
import type { CoreGraphics } from "../../../graphics/core-graphics/coregraphics";
import { writePoint } from "./geometry";
import type { TouchContext } from "./context";
import type { Point } from "./view-data";

export interface UiHelpers {
  thread: () => number;
  now: () => number;
  responds: (pointer: number, selector: string) => boolean;
  touchPoint: (touches: number, view: number) => Point | undefined;
  touchInside: (touches: number, view: number) => boolean;
}

const MAIN_THREAD = 1;

export function createHelpers(ctx: TouchContext): UiHelpers {
  const { state, kit, geo, collections, lookup, read, currentThread } = ctx;
  const touchPoint = (set: number, view: number): Point | undefined => {
    const first = collections.items(set)[0];
    const touch = first === undefined ? undefined : state.touches.get(first);
    return touch ? geo.convertPoint(touch.point, touch.window, view) : undefined;
  };
  return {
    thread: () => currentThread?.() ?? MAIN_THREAD,
    now: () => performance.now(),
    responds: (pointer, selector) => !!pointer && !!lookup(read(pointer), selector),
    touchPoint,
    touchInside: (set, view) => {
      const point = touchPoint(set, view);
      if (!point) return false;
      const [x, y] = point;
      const [bx, by, width, height] = kit.data(view).bounds;
      return x >= bx && y >= by && x < bx + width && y < by + height;
    },
  };
}

export function rectangleMethod(
  ctx: TouchContext,
  className: string,
  selector: string,
  read: (self: number) => readonly number[],
): void {
  ctx.method(
    className,
    false,
    selector,
    pointMethod(ctx, (self) => read(self)),
  );
}

export function pointMethod(
  ctx: TouchContext,
  read: (self: number, args: (index: number) => number) => readonly number[],
): StructureMethod {
  return structureMethod((self, args, destination) => {
    writePoint(ctx.write, destination, read(self, args));
  });
}

export function requireCoreGraphics(ctx: TouchContext): CoreGraphics {
  const graphics = ctx.getCoreGraphics();
  if (!graphics) throw new Error("Quartz is unavailable");
  return graphics;
}
