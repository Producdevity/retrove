import type { DiagnosticSink } from "../ios/libc/files/types";
import { drawableRenderer, type DrawableSize } from "./drawable-renderer";
import {
  drawablePlacement,
  drawableSize,
  type DrawablePlacement,
  type LayerGeometry,
  type LayerSize,
} from "./drawable-placement";
import type { GraphicsContext } from "./gl-parameters";

export { drawableRenderer, type DrawableRenderer } from "./drawable-renderer";
const CLIP_SPAN = 2;
export const FULL_DISPLAY: DrawablePlacement = {
  origin: [-1, -1],
  u: [CLIP_SPAN, 0],
  v: [0, CLIP_SPAN],
};

/** A drawable's CAEAGLLayer; `display` is absent until UIKit has placed it. */
export type DrawableLayer = LayerSize & Partial<Pick<LayerGeometry, "display" | "toDisplay">>;
export type DrawableGeometry = (drawable: number) => DrawableLayer | undefined;
export type RemoteCommand = (kind: "allocate" | "present", payload: object) => number;
export interface Drawable {
  allocate(target: number, drawable: number, colorFormat: string): number;
  present(target: number): number;
}

function isPlaced(layer: DrawableLayer): layer is LayerGeometry {
  return Boolean(layer.display);
}
const placementOf = (layer: DrawableLayer | undefined): DrawablePlacement =>
  layer && isPlaced(layer) ? drawablePlacement(layer) : FULL_DISPLAY;
const allocated = (layer: DrawableLayer | undefined, size: Partial<DrawableSize> | null) => ({
  width: size?.width,
  height: size?.height,
  points: layer && [layer.width, layer.height],
  scale: layer?.scale,
});
const noGeometry: DrawableGeometry = () => undefined;
const noDiagnostic: DiagnosticSink = () => {};

/**
 * A CAEAGLLayer owns a renderbuffer sized from its bounds and contents scale. Presenting draws it
 * where UIKit places the layer, turned when a portrait layer shows in a landscape interface.
 */
export function eaglDrawable(
  context: () => GraphicsContext,
  geometry: DrawableGeometry = noGeometry,
  diagnostic: DiagnosticSink = noDiagnostic,
): Drawable {
  const renderer = drawableRenderer(context);
  return {
    allocate(target, drawable, colorFormat) {
      const layer = geometry(drawable),
        size = renderer.allocate(target, drawable, colorFormat, layer && drawableSize(layer));
      if (size) diagnostic("info", "graphics", "Drawable allocated", allocated(layer, size));
      return size ? 1 : 0;
    },
    present: (target) => renderer.present(target, (drawable) => placementOf(geometry(drawable))),
  };
}

/**
 * The same drawable for a WebGL context another thread owns: UIKit geometry stays here, so each
 * command carries the sizes and placements the owner needs.
 */
export function remoteDrawable(
  command: RemoteCommand,
  geometry: DrawableGeometry = noGeometry,
  diagnostic: DiagnosticSink = noDiagnostic,
): Drawable {
  const drawables = new Set<number>();
  return {
    allocate(target, drawable, colorFormat) {
      const layer = geometry(drawable),
        size = (layer && drawableSize(layer)) ?? null;
      const result = command("allocate", { target, drawable, colorFormat, size });
      if (result) {
        drawables.add(drawable);
        diagnostic("info", "graphics", "Drawable allocated", allocated(layer, size));
      }
      return result;
    },
    present: (target) =>
      command("present", {
        target,
        placements: [...drawables].map((drawable) => [drawable, placementOf(geometry(drawable))]),
      }),
  };
}
