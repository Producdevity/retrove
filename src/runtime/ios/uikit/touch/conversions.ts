import { doubleBits, floatFromBits } from "../../abi/scalars";
import { Argument } from "../../objc/host";
import type { UiContext } from "./context";
import { readRectangle } from "./geometry";
import { pointMethod } from "./helpers";
import type { Point } from "./view-data";

const VIEW_CLASS = "UIView";
const TOUCH_CLASS = "UITouch";
const EVENT_CLASS = "UIEvent";
const RECT_ARGUMENT_COUNT = 4;

function installPointConversions(ctx: UiContext): void {
  const { method, geo } = ctx;
  for (const [selector, fromSelf] of [
    ["convertPoint:toView:", true],
    ["convertPoint:fromView:", false],
  ] as const) {
    method(
      VIEW_CLASS,
      false,
      selector,
      pointMethod(ctx, (self, args) =>
        geo.convertPoint(
          [floatFromBits(args(0)), floatFromBits(args(1))],
          fromSelf ? self : args(Argument.Third),
          fromSelf ? args(Argument.Third) : self,
        ),
      ),
    );
  }
}

function installRectConversions(ctx: UiContext): void {
  const { method, geo } = ctx;
  for (const [selector, fromSelf] of [
    ["convertRect:toView:", true],
    ["convertRect:fromView:", false],
  ] as const) {
    method(
      VIEW_CLASS,
      false,
      selector,
      pointMethod(ctx, (self, args) => {
        const [x, y, width, height] = readRectangle(args);
        const from = fromSelf ? self : args(RECT_ARGUMENT_COUNT);
        const to = fromSelf ? args(RECT_ARGUMENT_COUNT) : self;
        const corners: Point[] = [
          [x, y],
          [x + width, y],
          [x, y + height],
          [x + width, y + height],
        ];
        const mapped = corners.map((corner) => geo.convertPoint(corner, from, to));
        const xs = mapped.map((point) => point[0]);
        const ys = mapped.map((point) => point[1]);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
      }),
    );
  }
  method("UIViewController", false, "interfaceOrientation", () => ctx.getOrientation());
}

function installTouchMethods(ctx: UiContext): void {
  const { method, state, geo, destroy } = ctx;
  const touch = (self: number) => {
    const record = state.touches.get(self);
    if (!record) throw new Error("Unknown UITouch.");
    return record;
  };
  for (const [selector, previous] of [
    ["locationInView:", false],
    ["previousLocationInView:", true],
  ] as const) {
    method(
      TOUCH_CLASS,
      false,
      selector,
      pointMethod(ctx, (self, args) => {
        const record = touch(self);
        return geo.convertPoint(previous ? record.previous : record.point, state.window, args(0));
      }),
    );
  }
  method(TOUCH_CLASS, false, "view", (self) => touch(self).target);
  method(TOUCH_CLASS, false, "window", (self) => touch(self).window);
  method(TOUCH_CLASS, false, "phase", (self) => touch(self).phase);
  method(TOUCH_CLASS, false, "timestamp", (self) => doubleBits(touch(self).time));
  method(TOUCH_CLASS, false, "tapCount", (self) => touch(self).taps);
  method(TOUCH_CLASS, false, "dealloc", (self) => {
    state.touches.delete(self);
    destroy(self);
  });
  method(EVENT_CLASS, false, "allTouches", (self) => state.eventTouches.get(self));
  method(EVENT_CLASS, false, "dealloc", (self) => {
    state.eventTouches.delete(self);
    destroy(self);
  });
}

export function installConversions(ctx: UiContext): void {
  installPointConversions(ctx);
  installRectConversions(ctx);
  installTouchMethods(ctx);
}
