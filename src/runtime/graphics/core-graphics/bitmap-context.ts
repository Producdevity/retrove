import { packBitmap, unpackBitmap } from "./bitmap-format";
import type { BitmapLayout } from "./bitmap-format";

export type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
export interface RasterImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}
export interface BitmapMemory {
  read(pointer: number, length: number): Uint8Array;
  write(pointer: number, bytes: Uint8Array): void;
  free(pointer: number): void;
}
function surface(width: number, height: number): { canvas: RasterCanvas; context: RasterContext } {
  const canvas =
    typeof OffscreenCanvas === "undefined"
      ? document.createElement("canvas")
      : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || !("putImageData" in context))
    throw new Error("Bitmap drawing requires a 2D canvas.");
  return { canvas, context };
}
function putPixels(context: RasterContext, image: RasterImage): void {
  const data = context.createImageData(image.width, image.height);
  data.data.set(image.rgba);
  context.putImageData(data, 0, 0);
}
const imageCanvases = new WeakMap<RasterImage, RasterCanvas>();
export function drawRasterImage(
  context: RasterContext,
  image: RasterImage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!width || !height) return;
  let canvas = imageCanvases.get(image);
  if (!canvas) {
    const created = surface(image.width, image.height);
    putPixels(created.context, image);
    canvas = created.canvas;
    imageCanvases.set(image, canvas);
  }
  context.save();
  try {
    context.translate(x, y + height);
    context.scale(width / image.width, -height / image.height);
    context.drawImage(canvas, 0, 0);
  } finally {
    context.restore();
  }
}
export class BitmapContext {
  readonly canvas: RasterContext;
  private previous: Uint8ClampedArray | undefined;
  constructor(
    readonly layout: BitmapLayout,
    readonly data: number,
    readonly ownsData: boolean,
    readonly space: number,
    private readonly memory: BitmapMemory,
  ) {
    this.canvas = surface(layout.width, layout.height).context;
    this.refresh();
    this.canvas.setTransform(1, 0, 0, -1, 0, layout.height);
  }
  refresh(): void {
    const rgba = unpackBitmap(this.layout, this.memory.read(this.data, this.layout.length));
    this.previous = rgba;
    putPixels(this.canvas, { ...this.layout, rgba });
  }
  rgba(): Uint8ClampedArray {
    return this.canvas.getImageData(0, 0, this.layout.width, this.layout.height).data;
  }
  commit(): void {
    const bytes = this.memory.read(this.data, this.layout.length);
    packBitmap(this.layout, this.rgba(), bytes, this.previous);
    this.memory.write(this.data, bytes);
  }
  close(): void {
    if (this.ownsData) this.memory.free(this.data);
    this.canvas.canvas.width = 0;
    this.canvas.canvas.height = 0;
  }
}
