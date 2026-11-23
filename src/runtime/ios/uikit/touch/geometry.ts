import { floatBits, floatFromBits, GeometryField, WORD_BYTES } from "../../abi/scalars";
import { Argument } from "../../objc/host";
import type { GuestArguments } from "../../objc/host";
import { isLandscape, Orientation } from "../screen";
import type { TouchBase } from "./context";
import type { ViewKit } from "./kit";
import { viewClip } from "../view/clipping";
import {
  DEFAULT_ANCHOR,
  toPoint,
  type Point,
  type PointLike,
  type Rect,
  type ViewData,
} from "./view-data";

const LANDSCAPE_RIGHT = Orientation.UIInterfaceOrientationLandscapeRight;
const LANDSCAPE_LEFT = Orientation.UIInterfaceOrientationLandscapeLeft;

export interface DrawableGeometry {
  width: number;
  height: number;
  scale: number;
  screenScale: number;
  display?: { width: number; height: number };
  toDisplay?: (point: Point) => Point;
}
export interface Geometry {
  toParent: (view: ViewData, point: PointLike) => Point;
  fromParent: (view: ViewData, point: PointLike) => Point;
  convertPoint: (point: PointLike, from: number, to: number) => Point;
  displayBounds: (window: number) => Rect;
  displayPoint: (point: PointLike, from: number, window: number) => Point;
  drawableGeometry: (layer: number) => DrawableGeometry;
  clip: (self: number) => string;
}

export function readRectangle(args: GuestArguments): Rect {
  return [
    floatFromBits(args(Argument.First)),
    floatFromBits(args(Argument.Second)),
    floatFromBits(args(Argument.Third)),
    floatFromBits(args(Argument.Fourth)),
  ];
}
export function writePoint(
  write: (address: number, value: number) => void,
  destination: number,
  values: readonly number[],
): void {
  values.forEach((value, index) => {
    write(destination + index * WORD_BYTES, floatBits(value));
  });
}

type RootTransform = (view: ViewData, point: PointLike, inverse: boolean) => Point;

// UIKit transforms operate about the view's center. Keep model frame and
// bounds in logical points even when the browser scales the backing canvas.
function createRootTransform(base: TouchBase, kit: ViewKit): RootTransform {
  const { getOrientation } = base;
  const { data } = kit;
  const rotation = (view: ViewData): number => {
    const parent = view.parent ? data(view.parent) : undefined;
    if (
      !parent ||
      !view.controller ||
      parent.rootController !== view.controller ||
      parent.bounds[GeometryField.Width] >= parent.bounds[GeometryField.Height]
    ) {
      return 0;
    }
    return isLandscape(getOrientation()) ? getOrientation() : 0;
  };
  // Before iOS 8 the window remains portrait in landscape. UIKit centers its
  // root controller's view and applies the interface-orientation transform.
  return (view, point, inverse) => {
    const orient = rotation(view);
    if (!orient || !view.parent) return [point[0], point[1]];
    const [wx, wy, ww, wh] = data(view.parent).bounds;
    const [x, y] = point;
    if (inverse) {
      const dx = x - wx;
      const dy = y - wy;
      return orient === LANDSCAPE_RIGHT ? [dy, ww - dx] : [wh - dy, dx];
    }
    return orient === LANDSCAPE_RIGHT ? [wx + ww - y, wy + x] : [wx + y, wy + wh - x];
  };
}

function createViewTransforms(rootToWindow: RootTransform) {
  const fromParent: Geometry["fromParent"] = (view, original) => {
    const point = rootToWindow(view, original, true);
    const [x, y, w, h] = view.frame;
    const [bx, by, bw, bh] = view.bounds;
    const [a, b, c, d, tx, ty] = view.transform;
    const det = a * d - b * c;
    if (!det) return [Infinity, Infinity];
    const [ax, ay] = view.anchorPoint ?? DEFAULT_ANCHOR;
    const px = point[0] - (x + w * ax + tx);
    const py = point[1] - (y + h * ay + ty);
    return [bx + bw * ax + (px * d - py * c) / det, by + bh * ay + (py * a - px * b) / det];
  };
  const toParent: Geometry["toParent"] = (view, point) => {
    const [x, y, w, h] = view.frame;
    const [bx, by, bw, bh] = view.bounds;
    const [a, b, c, d, tx, ty] = view.transform;
    const [ax, ay] = view.anchorPoint ?? DEFAULT_ANCHOR;
    const px = point[0] - bx - bw * ax;
    const py = point[1] - by - bh * ay;
    return rootToWindow(
      view,
      [x + w * ax + tx + a * px + c * py, y + h * ay + ty + b * px + d * py],
      false,
    );
  };
  return { fromParent, toParent };
}

export function createGeometry(base: TouchBase, kit: ViewKit): Geometry {
  const { state, getOrientation, phoneScreen } = base;
  const { data } = kit;
  const { fromParent, toParent } = createViewTransforms(createRootTransform(base, kit));
  const convertPoint: Geometry["convertPoint"] = (original, from, to) => {
    let point: Point = toPoint(original);
    for (let pointer = from; pointer && pointer !== state.window; pointer = data(pointer).parent) {
      point = toParent(data(pointer), point);
    }
    const chain: number[] = [];
    for (let pointer = to; pointer && pointer !== state.window; pointer = data(pointer).parent) {
      chain.push(pointer);
    }
    for (const pointer of chain.reverse()) point = fromParent(data(pointer), point);
    return point;
  };
  const displayBounds: Geometry["displayBounds"] = (window) => {
    const [, , w, h] = data(window).bounds;
    return w < h && isLandscape(getOrientation()) ? [0, 0, h, w] : [0, 0, w, h];
  };
  const displayPoint: Geometry["displayPoint"] = (point, from, window) => {
    const [bx, by, w, h] = data(window).bounds;
    const converted = convertPoint(point, from, window);
    const x = converted[0] - bx;
    const y = converted[1] - by;
    if (w < h && getOrientation() === LANDSCAPE_RIGHT) return [y, w - x];
    if (w < h && getOrientation() === LANDSCAPE_LEFT) return [h - y, x];
    return [x, y];
  };
  // Renderbuffer size comes from the layer alone; its display placement needs the window.
  const drawableGeometry: Geometry["drawableGeometry"] = (layer) => {
    const owner = data(layer).backingView ?? layer;
    const view = data(owner);
    const [bx, by, width, height] = view.bounds;
    const scale = view.contentScaleFactor ?? data(layer).contentsScale;
    const size = {
      width,
      height,
      scale: scale === undefined ? 1 : floatFromBits(scale),
      screenScale: phoneScreen.scale,
    };
    if (!state.window) return size;
    const [, , dw, dh] = displayBounds(state.window);
    return {
      ...size,
      display: { width: dw, height: dh },
      toDisplay: ([x, y]) => displayPoint([bx + x, by + y], owner, state.window),
    };
  };
  const clip: Geometry["clip"] = (self) =>
    viewClip({ view: data, convert: convertPoint }, self, state.window);
  return {
    toParent,
    fromParent,
    convertPoint,
    displayBounds,
    displayPoint,
    drawableGeometry,
    clip,
  };
}
