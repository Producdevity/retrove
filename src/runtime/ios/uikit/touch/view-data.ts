import type { ViewState } from "../host";
import type { installAnimationGroups } from "../animation/groups";

export type Point = [number, number];
export type PointLike = Readonly<Point>;
export type Rect = [number, number, number, number];
export type Matrix = [number, number, number, number, number, number];
export type ViewAnimation = ReturnType<ReturnType<typeof installAnimationGroups>["context"]>;
export type Animation = NonNullable<ViewAnimation>;
export interface ImageAdjustment {
  brightness: number;
  opacity: number;
}
export interface ViewData extends ViewState {
  children: number[];
  parent: number;
  hidden: boolean;
  multi: boolean;
  exclusive: boolean;
  alpha: number;
  layer: number;
  controller: number;
  transform: Matrix;
  clipsToBounds: number;
  layoutAnimation?: Animation;
  opacityAnimation?: Animation;
  image?: number;
  highlightedImage?: number;
  backgroundColor?: number;
  rootController?: number;
  contents?: number;
  borderColor?: number;
  layerBackgroundColor?: number;
  drawableProperties?: number;
  backingView?: number;
  screen?: number;
  anchorPoint?: Point;
  imageAdjustment?: ImageAdjustment;
  windowLevel?: number;
  isOpaque?: number;
  contentScaleFactor?: number;
  tag?: number;
  contentMode?: number;
  autoresizingMask?: number;
  clearsContextBeforeDrawing?: number;
  autoresizesSubviews?: number;
  contentsScale?: number;
  borderWidth?: number;
  cornerRadius?: number;
  masksToBounds?: number;
  wantsFullScreenLayout?: number;
}
export const IDENTITY_TRANSFORM: Matrix = [1, 0, 0, 1, 0, 0];
const CENTER = 0.5;
export const DEFAULT_ANCHOR: Point = [CENTER, CENTER];
export function createViewData(interactive: boolean): ViewData {
  return {
    frame: [0, 0, 0, 0],
    bounds: [0, 0, 0, 0],
    children: [],
    parent: 0,
    hidden: false,
    interactive,
    multi: false,
    exclusive: false,
    alpha: 1,
    layer: 0,
    controller: 0,
    transform: [...IDENTITY_TRANSFORM],
    clipsToBounds: 0,
    needsDisplay: false,
    needsLayout: false,
  };
}

export function applyAnimation(
  view: ViewData,
  key: "layoutAnimation" | "opacityAnimation",
  animation: ViewAnimation,
): void {
  if (animation) view[key] = animation;
  else Reflect.deleteProperty(view, key);
}
export function toPoint(point: PointLike): Point {
  return [point[0], point[1]];
}
