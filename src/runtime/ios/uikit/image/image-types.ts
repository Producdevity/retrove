import type { RGBA } from "../../../graphics/core-graphics/colors/model";
import type { CoreGraphics } from "../../../graphics/core-graphics/coregraphics";
import type { FoundationHost, HostResult } from "../../objc/host";
import type { HostRegistrar, Implementation, StructureRegistrar } from "../../objc/registrars";
import type { Diagnostic, IpaArchive } from "../../package/zip-types";
import type { Rectangle, ViewState } from "../host";
import type { Point } from "../scroll/state";
import type { ImageCaps } from "./caps";

export const UIImageClass = {
  Image: "UIImage",
  Placeholder: "UIImageNibPlaceholder",
  View: "UIImageView",
  Object: "NSObject",
} as const;
export const Orientation = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
  UpMirrored: 4,
  DownMirrored: 5,
  LeftMirrored: 6,
  RightMirrored: 7,
} as const;
export const ContentMode = {
  ScaleToFill: 0,
  ScaleAspectFit: 1,
  ScaleAspectFill: 2,
  Redraw: 3,
  Center: 4,
  Top: 5,
  Bottom: 6,
  Left: 7,
  Right: 8,
  TopLeft: 9,
  TopRight: 10,
  BottomLeft: 11,
  BottomRight: 12,
} as const;

/** The pixels a UIImage draws: a decoded file or a canvas holding a CGImage's pixels. */
export type ImageSurface = HTMLImageElement | HTMLCanvasElement;
export interface ImageRecord {
  width: number;
  height: number;
  scale: number;
  orientation: number;
  source?: ImageSurface | undefined;
  pointer?: number | undefined;
  caps?: ImageCaps | undefined;
}
export type ImageDrawContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "transform"
  | "drawImage"
  | "createPattern"
  | "fillStyle"
  | "fillRect"
>;
/** A running UIView animation's timing, which the compositor mirrors as a CSS transition. */
export interface ViewTiming {
  readonly start: number;
  readonly duration: number;
  readonly delay: number;
  readonly curve: string;
}
export interface ImageViewData extends ViewState {
  children: number[];
  parent?: number | undefined;
  hidden: boolean;
  alpha: number;
  layer: number;
  transform?: readonly number[] | undefined;
  anchorPoint?: readonly number[] | undefined;
  clipsToBounds?: number | undefined;
  masksToBounds?: number | undefined;
  zPosition?: number | undefined;
  highlighted?: boolean | undefined;
  image?: number | undefined;
  highlightedImage?: number | undefined;
  backgroundColor?: number | undefined;
  layerBackgroundColor?: number | undefined;
  borderColor?: number | undefined;
  borderWidth?: number | undefined;
  contents?: number | undefined;
  contentsScale?: number | undefined;
  contentScaleFactor?: number | undefined;
  contentMode?: number | undefined;
  clearsContextBeforeDrawing?: number | undefined;
  imageAdjustment?: { readonly brightness: number; readonly opacity: number } | undefined;
  opacityAnimation?: ViewTiming | undefined;
  layoutAnimation?: ViewTiming | undefined;
}
export type DisplayPoint = (point: Point, view: number, window: number) => Point;

export interface ImagesHost extends Pick<
  FoundationHost,
  "hostClass" | "alloc" | "destroy" | "autorelease" | "retain" | "text" | "write"
> {
  readonly method: HostRegistrar & StructureRegistrar;
  readonly names: ReadonlyMap<string, number>;
  readonly ipa: Pick<IpaArchive, "bundlePath" | "has" | "read">;
  readonly mediaHost: HTMLElement | undefined;
  readonly diagnostic?: Diagnostic | undefined;
  releaseFromHost(pointer: number): Promise<void>;
  send(self: number, selector: string, args?: number[], optional?: boolean): Promise<HostResult>;
  lookup(classPointer: number, selector: string): Implementation;
  read(address: number): number;
  data(pointer: number): ImageViewData;
  setFrame(pointer: number, frame: Rectangle): number;
  readFile(path: string): Promise<Uint8Array | undefined>;
  elements(array: number): readonly number[];
  getCoreGraphics?(): CoreGraphics | undefined;
  convertPoint?: DisplayPoint | undefined;
  displayPoint?: DisplayPoint | undefined;
  displayBounds?(window: number): Rectangle | undefined;
  hasHostDrawing?(view: number): boolean;
  drawHost?(view: number, context: CanvasRenderingContext2D): Promise<void> | void;
  clip?(view: number): string;
  uiColor?(color: number): RGBA | undefined;
  uiPattern?(color: number): number | undefined;
  glLayer?(layer: number): boolean;
  movieVideo?: ((view: number) => HTMLElement | null | undefined) | undefined;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("UIKit image drawing requires a 2D canvas context");
  return context;
}
export function surfaceSize(surface: ImageSurface): readonly [number, number] {
  return surface instanceof HTMLImageElement
    ? [surface.naturalWidth, surface.naturalHeight]
    : [surface.width, surface.height];
}
