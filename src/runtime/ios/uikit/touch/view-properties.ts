import { floatBits, floatFromBits, GeometryField } from "../../abi/scalars";
import type { UiContext } from "./context";
import { pointMethod } from "./helpers";
import { applyAnimation, DEFAULT_ANCHOR, type Matrix, type ViewData } from "./view-data";

const VIEW_CLASS = "UIView";
const WINDOW_CLASS = "UIWindow";
const LAYER_CLASS = "CALayer";
const CONTROLLER_CLASS = "UIViewController";
const TRANSFORM_FIELDS = 6;
const ONE_BITS = floatBits(1);
type ScalarKey =
  | "windowLevel"
  | "isOpaque"
  | "contentScaleFactor"
  | "tag"
  | "contentMode"
  | "autoresizingMask"
  | "clearsContextBeforeDrawing"
  | "clipsToBounds"
  | "autoresizesSubviews"
  | "contentsScale"
  | "borderWidth"
  | "cornerRadius"
  | "masksToBounds"
  | "wantsFullScreenLayout";
type ScalarRow = readonly [string, ScalarKey, string, number];
const SCALAR_ROWS: readonly ScalarRow[] = [
  [WINDOW_CLASS, "windowLevel", "setWindowLevel:", 0],
  [VIEW_CLASS, "isOpaque", "setOpaque:", 1],
  [VIEW_CLASS, "contentScaleFactor", "setContentScaleFactor:", ONE_BITS],
  [VIEW_CLASS, "tag", "setTag:", 0],
  [VIEW_CLASS, "contentMode", "setContentMode:", 0],
  [VIEW_CLASS, "autoresizingMask", "setAutoresizingMask:", 0],
  [VIEW_CLASS, "clearsContextBeforeDrawing", "setClearsContextBeforeDrawing:", 1],
  [VIEW_CLASS, "clipsToBounds", "setClipsToBounds:", 0],
  [VIEW_CLASS, "autoresizesSubviews", "setAutoresizesSubviews:", 1],
  [LAYER_CLASS, "contentsScale", "setContentsScale:", ONE_BITS],
  [LAYER_CLASS, "isOpaque", "setOpaque:", 0],
  [LAYER_CLASS, "borderWidth", "setBorderWidth:", 0],
  [LAYER_CLASS, "cornerRadius", "setCornerRadius:", 0],
  [LAYER_CLASS, "masksToBounds", "setMasksToBounds:", 0],
  [CONTROLLER_CLASS, "wantsFullScreenLayout", "setWantsFullScreenLayout:", 0],
];
const COLOR_ROWS = [
  [VIEW_CLASS, "backgroundColor", "setBackgroundColor:"],
  ["CAEAGLLayer", "drawableProperties", "setDrawableProperties:"],
] as const;

export function installScalarProperties(ctx: UiContext): void {
  const { method, kit, retain, releaseFromHost } = ctx;
  const { data } = kit;
  for (const [className, getter, setter, fallback] of SCALAR_ROWS) {
    method(className, false, getter, (self) => data(self)[getter] ?? fallback);
    method(className, false, setter, (self, args) => {
      data(self)[getter] = args(0);
      data(self).needsDisplay = true;
    });
  }
  for (const [className, key, setter] of COLOR_ROWS) {
    method(className, false, key, (self) => data(self)[key] ?? 0);
    method(className, false, setter, async (self, args) => {
      const view = data(self);
      const old = view[key];
      view[key] = retain(args(0));
      view.needsDisplay = true;
      if (old) await releaseFromHost(old);
    });
  }
}

export function installCenter(ctx: UiContext): void {
  const { method, kit } = ctx;
  const { data } = kit;
  method(
    VIEW_CLASS,
    false,
    "center",
    pointMethod(ctx, (self) => {
      const view = data(self);
      const [x, y, width, height] = view.frame;
      const [ax, ay] = view.anchorPoint ?? DEFAULT_ANCHOR;
      return [x + width * ax, y + height * ay];
    }),
  );
  method(VIEW_CLASS, false, "setCenter:", (self, args) => {
    const view = data(self);
    const frame = view.frame;
    withLayoutAnimation(ctx, view);
    const [ax, ay] = view.anchorPoint ?? DEFAULT_ANCHOR;
    const [, , width, height] = frame;
    frame[GeometryField.X] = floatFromBits(args(0)) - width * ax;
    frame[GeometryField.Y] = floatFromBits(args(1)) - height * ay;
  });
}

export function installTransformMethods(ctx: UiContext): void {
  const { method, kit } = ctx;
  method(
    VIEW_CLASS,
    false,
    "transform",
    pointMethod(ctx, (self) => kit.data(self).transform),
  );
  method(VIEW_CLASS, false, "setTransform:", (self, args) => {
    const values = Array.from({ length: TRANSFORM_FIELDS }, (_, index) =>
      floatFromBits(args(index)),
    );
    const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = values;
    const matrix: Matrix = [a, b, c, d, tx, ty];
    kit.data(self).transform = matrix;
    withLayoutAnimation(ctx, kit.data(self));
  });
}

function withLayoutAnimation(ctx: UiContext, view: ViewData): void {
  applyAnimation(
    view,
    "layoutAnimation",
    ctx.state.animation ?? ctx.services.animationGroups.get().context(),
  );
}
