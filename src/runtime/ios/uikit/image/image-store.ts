import { decodeCgBI } from "../../../formats/cgbi";
import type { CoreGraphics } from "../../../graphics/core-graphics/coregraphics";
import { capSlices } from "./caps";
import { imageFile } from "./files";
import {
  context2d,
  Orientation,
  surfaceSize,
  type ImageDrawContext,
  type ImageRecord,
  type ImagesHost,
  type ImageSurface,
} from "./image-types";

type Matrix = readonly [number, number, number, number, number, number];
/** Unit-square transforms for each UIImageOrientation. */
const ORIENTATION_TRANSFORMS: readonly Matrix[] = [
  [1, 0, 0, 1, 0, 0],
  [-1, 0, 0, -1, 1, 1],
  [0, -1, 1, 0, 0, 1],
  [0, 1, -1, 0, 1, 0],
  [-1, 0, 0, 1, 1, 0],
  [1, 0, 0, -1, 0, 1],
  [0, 1, 1, 0, 0, 0],
  [0, -1, -1, 0, 1, 1],
];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SIDEWAYS: readonly number[] = [
  Orientation.Left,
  Orientation.Right,
  Orientation.LeftMirrored,
  Orientation.RightMirrored,
];
type Rect = readonly [number, number, number, number];

/** UIImage instances: decoded files, or CGImages whose pixels are copied to a canvas on demand. */
export class ImageStore {
  readonly images = new Map<number, ImageRecord>();
  readonly #document: Document | undefined;

  constructor(private readonly host: ImagesHost) {
    this.#document = host.mediaHost?.ownerDocument;
  }

  get document(): Document | undefined {
    return this.#document;
  }
  coreGraphics(): CoreGraphics | undefined {
    return this.host.getCoreGraphics?.();
  }
  pixelCanvas(width: number, height: number): HTMLCanvasElement {
    if (!this.#document) throw Error("UIKit image drawing requires a browser canvas");
    const canvas = this.#document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  /** A canvas holding RGBA pixels. */
  rgbaCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
    const canvas = this.pixelCanvas(width, height);
    const context = context2d(canvas);
    const buffer = context.createImageData(width, height);
    buffer.data.set(rgba);
    context.putImageData(buffer, 0, 0);
    return canvas;
  }
  makeImage(
    classPointer: number,
    fields: Pick<ImageRecord, "source" | "pointer">,
    width: number,
    height: number,
    scale: number,
    orientation = 0,
  ): number {
    if (!(scale > 0) || orientation >= ORIENTATION_TRANSFORMS.length) return 0;
    const sideways = SIDEWAYS.includes(orientation);
    const pointer = this.host.alloc(classPointer);
    this.images.set(pointer, {
      ...fields,
      width: (sideways ? height : width) / scale,
      height: (sideways ? width : height) / scale,
      scale,
      orientation,
    });
    return this.host.autorelease(pointer);
  }
  async load(path: string, named: boolean): Promise<number> {
    const { host } = this;
    const file = await imageFile(
      { ipa: host.ipa, contents: (name) => host.readFile(name) },
      path,
      named,
    );
    if (!file) return 0;
    const { bytes, scale, path: entry } = file;
    const imageClass = host.names.get("UIImage") ?? 0;
    let optimized;
    try {
      optimized = decodeCgBI(bytes);
    } catch (error) {
      host.diagnostic?.("warn", "graphics", "Failed to decode optimized UIKit image", {
        path: entry,
        error: String(error),
      });
      return 0;
    }
    if (optimized) {
      const { width, height, rgba } = optimized;
      const source = this.rgbaCanvas(width, height, rgba);
      return this.makeImage(imageClass, { source }, width, height, scale);
    }
    const img = this.#document?.createElement("img");
    if (!img) throw Error("UIImage decoding requires a browser image decoder");
    const resource = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    try {
      img.src = resource;
      await img.decode();
      return this.makeImage(
        imageClass,
        { source: img },
        img.naturalWidth,
        img.naturalHeight,
        scale,
      );
    } catch (error) {
      host.diagnostic?.("warn", "graphics", "Failed to decode UIKit image", {
        path: entry,
        error: String(error),
      });
      return 0;
    } finally {
      URL.revokeObjectURL(resource);
    }
  }
  fromCG(classPointer: number, pointer: number, scale: number, orientation: number): number {
    const cg = this.coreGraphics();
    const content = cg?.pixels(pointer);
    if (!cg || !content) return 0;
    const image = this.makeImage(
      classPointer,
      { pointer },
      content.width,
      content.height,
      scale,
      orientation,
    );
    if (image) cg.retain(pointer);
    return image;
  }
  source(image: ImageRecord): ImageSurface {
    if (image.source) return image.source;
    const content =
      image.pointer === undefined ? undefined : this.coreGraphics()?.pixels(image.pointer);
    if (!content) throw new Error("UIImage pixels are unavailable");
    image.source = this.rgbaCanvas(content.width, content.height, content.rgba);
    return image.source;
  }
  tile(image: ImageRecord, context: ImageDrawContext, [x, y, width, height]: Rect): void {
    const pixels = this.source(image);
    const fill = image.width && image.height ? context.createPattern(pixels, "repeat") : null;
    if (!fill) return;
    fill.setTransform(
      new DOMMatrix().scale(image.width / pixels.width, image.height / pixels.height),
    );
    context.save();
    context.fillStyle = fill;
    try {
      context.fillRect(x, y, width, height);
    } finally {
      context.restore();
    }
  }
  draw(
    image: ImageRecord | undefined,
    context: ImageDrawContext | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!image || !context || !width || !height) return;
    if (image.caps && !image.orientation) {
      const pixels = this.source(image);
      const [naturalWidth, naturalHeight] = surfaceSize(pixels);
      const kx = naturalWidth / image.width;
      const ky = naturalHeight / image.height;
      for (const [sx, sy, sw, sh, dx, dy, dw, dh] of capSlices(
        image.width,
        image.height,
        image.caps,
        [x, y, width, height],
      ))
        context.drawImage(pixels, sx * kx, sy * ky, sw * kx, sh * ky, dx, dy, dw, dh);
      return;
    }
    context.save();
    context.translate(x, y);
    context.scale(width, height);
    const [a, b, c, d, e, f] = ORIENTATION_TRANSFORMS[image.orientation] ?? IDENTITY;
    context.transform(a, b, c, d, e, f);
    try {
      context.drawImage(this.source(image), 0, 0, 1, 1);
    } finally {
      context.restore();
    }
  }
  size(pointer: number): [number, number] {
    const image = this.images.get(pointer);
    return [image?.width ?? 0, image?.height ?? 0];
  }
}
