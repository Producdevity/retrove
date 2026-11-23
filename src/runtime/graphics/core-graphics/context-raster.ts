import type { RasterContext } from "./bitmap-context";
import type { Bounds, ContextObject, QuartzObjects } from "./quartz-objects";

const PIXEL_CENTER = 0.5;
const DrawMode = {
  Fill: 0,
  EvenOddFill: 1,
  Stroke: 2,
  FillStroke: 3,
  EvenOddFillStroke: 4,
} as const;
const FILL_MODES: readonly number[] = [
  DrawMode.Fill,
  DrawMode.EvenOddFill,
  DrawMode.FillStroke,
  DrawMode.EvenOddFillStroke,
];
const STROKE_MODES: readonly number[] = [
  DrawMode.Stroke,
  DrawMode.FillStroke,
  DrawMode.EvenOddFillStroke,
];

/** Device-space box of a rectangle under the canvas transform. */
export function deviceBounds(
  canvas: Pick<RasterContext, "getTransform">,
  x: number,
  y: number,
  width: number,
  height: number,
): Bounds {
  const m = canvas.getTransform();
  const x1 = m.a * x + m.c * y + m.e;
  const y1 = m.b * x + m.d * y + m.f;
  const u = m.a * width;
  const v = m.c * height;
  const r = m.b * width;
  const s = m.d * height;
  return [
    x1 + Math.min(0, u) + Math.min(0, v),
    y1 + Math.min(0, r) + Math.min(0, s),
    x1 + Math.max(0, u) + Math.max(0, v),
    y1 + Math.max(0, r) + Math.max(0, s),
  ];
}

export function addBounds(object: ContextObject, rect: Bounds): void {
  const [left, top, right, bottom] = rect;
  if (!object.bounds) {
    object.bounds = rect;
    return;
  }
  const [oldLeft, oldTop, oldRight, oldBottom] = object.bounds;
  object.bounds = [
    Math.min(oldLeft, left),
    Math.min(oldTop, top),
    Math.max(oldRight, right),
    Math.max(oldBottom, bottom),
  ];
}

export function addDeviceBounds(
  objects: QuartzObjects,
  pointer: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const object = objects.context(pointer);
  if (object) addBounds(object, deviceBounds(object.canvas, x, y, width, height));
}

/**
 * Canvas antialiases vector edges unconditionally. For Quartz contexts that disable it, sample
 * the actual Cairo/WebKit path once at each pixel center.
 */
export function rasterize(
  canvas: RasterContext,
  bounds: Bounds | null,
  contains: (x: number, y: number) => boolean,
  stroke: boolean,
): void {
  if (!bounds) return;
  const [minX, minY, maxX, maxY] = bounds;
  const m = canvas.getTransform();
  const margin = stroke
    ? canvas.lineWidth *
      Math.max(1, canvas.miterLimit) *
      Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))
    : 0;
  const left = Math.max(0, Math.floor(minX - margin));
  const right = Math.min(canvas.canvas.width, Math.ceil(maxX + margin));
  const top = Math.max(0, Math.floor(minY - margin));
  const bottom = Math.min(canvas.canvas.height, Math.ceil(maxY + margin));
  const spans: [number, number, number][] = [];
  for (let y = top; y < bottom; y++) {
    let start = -1;
    for (let x = left; x <= right; x++) {
      const inside = x < right && contains(x + PIXEL_CENTER, y + PIXEL_CENTER);
      if (inside && start < 0) start = x;
      else if (!inside && start >= 0) {
        spans.push([start, y, x - start]);
        start = -1;
      }
    }
  }
  canvas.save();
  canvas.setTransform(1, 0, 0, 1, 0, 0);
  try {
    if (stroke) canvas.fillStyle = canvas.strokeStyle;
    for (const [x, y, width] of spans) canvas.fillRect(x, y, width, 1);
  } finally {
    canvas.restore();
  }
}

export function fillRect(
  object: ContextObject,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  object.bitmap?.refresh();
  const canvas = object.canvas;
  if (object.antialias) {
    canvas.fillRect(x, y, width, height);
    object.bitmap?.commit();
    return;
  }
  const path = new Path2D();
  path.rect(x, y, width, height);
  rasterize(
    canvas,
    deviceBounds(canvas, x, y, width, height),
    (px, py) => canvas.isPointInPath(path, px, py),
    false,
  );
  object.bitmap?.commit();
}

export function drawPath(object: ContextObject, mode: number): void {
  object.bitmap?.refresh();
  const canvas = object.canvas;
  const rule =
    mode === DrawMode.EvenOddFill || mode === DrawMode.EvenOddFillStroke ? "evenodd" : "nonzero";
  if (FILL_MODES.includes(mode)) {
    if (object.antialias) canvas.fill(rule);
    else rasterize(canvas, object.bounds, (x, y) => canvas.isPointInPath(x, y, rule), false);
  }
  if (STROKE_MODES.includes(mode)) {
    if (object.antialias) canvas.stroke();
    else rasterize(canvas, object.bounds, (x, y) => canvas.isPointInStroke(x, y), true);
  }
  canvas.beginPath();
  object.bounds = null;
  object.bitmap?.commit();
}
