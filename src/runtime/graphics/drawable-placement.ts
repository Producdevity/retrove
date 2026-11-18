export type Point = readonly [number, number];

/** A layer's bounds size in points, its contents scale and the screen's native scale. */
export interface LayerSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly screenScale: number;
}
/** A layer as UIKit places it on the display. */
export interface LayerGeometry extends LayerSize {
  /** Display size in points. */
  readonly display: { readonly width: number; readonly height: number };
  /** Maps a point in the layer's bounds (origin at its top-left) to display points. */
  toDisplay(point: Point): Point;
}

/**
 * Clip-space placement of a drawable: `origin` is where renderbuffer pixel (0, 0) lands, and
 * `u` and `v` span its width and height.
 */
export interface DrawablePlacement {
  readonly origin: Point;
  readonly u: Point;
  readonly v: Point;
}

const CLIP_SPAN = 2;
const COVER_TOLERANCE = 1e-6;

/**
 * A CAEAGLLayer's renderbuffer is its bounds times its contents scale; undefined when empty.
 * BioShock (Unreal Engine 3) sets a scale of 0 yet renders on devices, so a non-positive scale
 * uses the screen's.
 */
export function drawableSize(geometry: LayerSize): { width: number; height: number } | undefined {
  const scale = geometry.scale > 0 ? geometry.scale : geometry.screenScale;
  const width = Math.round(geometry.width * scale),
    height = Math.round(geometry.height * scale);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** GL rows run bottom-up, so renderbuffer pixel (0, 0) is the layer's bottom-left corner. */
export function drawablePlacement(geometry: LayerGeometry): DrawablePlacement {
  const { width, height } = geometry.display;
  const clip = ([x, y]: Point): Point => [
    (CLIP_SPAN * x) / width - 1,
    1 - (CLIP_SPAN * y) / height,
  ];
  const origin = clip(geometry.toDisplay([0, geometry.height]));
  const right = clip(geometry.toDisplay([geometry.width, geometry.height]));
  const top = clip(geometry.toDisplay([0, 0]));
  return {
    origin,
    u: [right[0] - origin[0], right[1] - origin[1]],
    v: [top[0] - origin[0], top[1] - origin[1]],
  };
}

/** Whether the drawable maps onto the display without rotation or shear, so it can be blitted. */
export function isAxisAligned(placement: DrawablePlacement): boolean {
  return placement.u[1] === 0 && placement.v[0] === 0;
}

/** Whether the drawable covers the whole display, so nothing stale shows around it. */
export function coversDisplay(placement: DrawablePlacement): boolean {
  const { origin, u, v } = placement;
  const xs = [origin[0], origin[0] + u[0], origin[0] + v[0], origin[0] + u[0] + v[0]];
  const ys = [origin[1], origin[1] + u[1], origin[1] + v[1], origin[1] + u[1] + v[1]];
  const edge = 1 - COVER_TOLERANCE;
  return (
    Math.min(...xs) <= -edge &&
    Math.max(...xs) >= edge &&
    Math.min(...ys) <= -edge &&
    Math.max(...ys) >= edge
  );
}

/** Framebuffer pixel rectangle `[x0, y0, x1, y1]` for an axis-aligned placement. */
export function blitRectangle(
  placement: DrawablePlacement,
  target: { width: number; height: number },
): [number, number, number, number] {
  const pixel = ([x, y]: Point): Point => [
    Math.round(((x + 1) * target.width) / CLIP_SPAN),
    Math.round(((y + 1) * target.height) / CLIP_SPAN),
  ];
  const { origin, u, v } = placement;
  const start = pixel(origin),
    end = pixel([origin[0] + u[0] + v[0], origin[1] + u[1] + v[1]]);
  return [start[0], start[1], end[0], end[1]];
}
