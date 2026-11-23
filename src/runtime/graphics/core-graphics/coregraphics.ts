import { readString, write32, type GuestMemory } from "../../memory/guest-memory";
import { bitmapImageMetadata, bitmapImports } from "./bitmap-imports";
import type { RasterContext } from "./bitmap-context";
import { colorImports } from "./colors/bindings";
import type { Colors } from "./colors/model";
import { colorSpaceImports } from "./color-space";
import { contextCallImports, setAntialias, type Imports } from "./context-calls";
import { componentColor, contextDrawingImports } from "./context-drawing";
import { contextEffectImports } from "./context-effects";
import { addDeviceBounds, drawPath } from "./context-raster";
import { drawingStateImports } from "./drawing-state";
import { gradientImports } from "./gradients";
import { imageMetadataImports } from "./image-metadata";
import { objectImports } from "./object-imports";
import { pathImports } from "./path-imports";
import { cgPathImports } from "./paths";
import { createQuartzImage, quartzPixels, type DecodedImage } from "./quartz-images";
import { QuartzObjects, type CoreGraphicsObjc, type QuartzHeap } from "./quartz-objects";
import { textImports } from "./text";

export type { CoreGraphicsObjc, QuartzHeap };
export interface CoreGraphicsOptions {
  readonly readFile?: (path: string) => Promise<Uint8Array | undefined>;
}
export interface CoreGraphics {
  readonly funcs: Imports;
  readonly data: Map<string, number>;
  readonly colors: Colors;
  owns(pointer: number): boolean;
  retainCount(pointer: number): number | undefined;
  equal(first: number, second: number): boolean | undefined;
  hash(pointer: number): number | undefined;
  createImage(width: number, height: number, rgba: ArrayLike<number>): number;
  pixels(pointer: number): DecodedImage | null;
  retain(pointer: number): number;
  release(pointer: number): Promise<void>;
  setColor(channels: readonly number[], fill: boolean, stroke: boolean): void;
  withContext<T>(canvas: RasterContext, callback: () => Promise<T> | T): Promise<T>;
  drawCurrent(draw: (canvas: RasterContext) => void): boolean;
  currentCanvas(): RasterContext | null;
}

function fontSet(): FontFaceSet | undefined {
  if (typeof document !== "undefined") return document.fonts;
  const fonts: unknown = Reflect.get(globalThis, "fonts");
  return fonts instanceof FontFaceSet ? fonts : undefined;
}
async function loadFont(family: string, bytes: Uint8Array): Promise<void> {
  const face = new FontFace(family, new Uint8Array(bytes));
  await face.load();
  fontSet()?.add(face);
}

function drawingImports(objects: QuartzObjects): Imports {
  const context = (pointer: number) => objects.canvas(pointer);
  const bounds = (pointer: number, x: number, y: number, width: number, height: number) =>
    addDeviceBounds(objects, pointer, x, y, width, height);
  const draw = (pointer: number, mode: number) => {
    const object = objects.context(pointer);
    if (object) drawPath(object, mode);
  };
  const spaceComponents = (pointer: number) => objects.space(pointer)?.components;
  return {
    ...contextEffectImports({
      context,
      setAntialias: (pointer, enabled) => setAntialias(objects, pointer, enabled),
      color: (pointer) => {
        const value = objects.colors.rgba(pointer);
        return value ? componentColor(value) : undefined;
      },
    }),
    ...colorImports({
      colors: objects.colors,
      text: (pointer) => objects.objc.stringText(pointer),
    }),
    ...drawingStateImports({ context, rgba: (pointer) => objects.colors.rgba(pointer) }),
    ...colorSpaceImports({ components: spaceComponents }),
    ...contextDrawingImports({
      context,
      bounds,
      draw,
      floats: (pointer, count) => objects.floats(pointer, count),
      spaceComponents,
    }),
    ...pathImports({
      context,
      reset: (pointer) => {
        const object = objects.context(pointer);
        if (object) object.bounds = null;
      },
      bounds,
      draw,
    }),
  };
}

function bitmapHostImports(objects: QuartzObjects): Imports {
  const { cpu, heap } = objects;
  return bitmapImports({
    read: (pointer, length) => cpu.read(pointer, length),
    write: (pointer, bytes) => cpu.write(pointer, bytes),
    allocate: (length) => heap.zero(length),
    free: (pointer) => heap.free(pointer),
    components: (pointer) => objects.space(pointer)?.components,
    create: (bitmap) => {
      const pointer = objects.add({
        kind: "context",
        canvas: bitmap.canvas,
        bitmap,
        saves: 0,
        antialias: true,
        bounds: null,
      });
      if (pointer) objects.retain(bitmap.space);
      return pointer;
    },
    context: (pointer) => objects.context(pointer),
    image: (pointer) => quartzPixels(objects, pointer) ?? undefined,
    snapshot: (bitmap) => {
      const pointer = objects.add({
        kind: "image",
        ...bitmapImageMetadata(bitmap),
        rgba: new Uint8ClampedArray(bitmap.rgba()),
      });
      if (pointer) objects.retain(bitmap.space);
      return pointer;
    },
  });
}

/** Quartz objects live independently of Objective-C objects and retain their backing storage. */
export function coreGraphics(
  cpu: GuestMemory,
  heap: QuartzHeap,
  objc: CoreGraphicsObjc,
  { readFile = async () => undefined }: CoreGraphicsOptions = {},
): CoreGraphics {
  const objects = new QuartzObjects(cpu, heap, objc);
  const memory = { allocate: (size: number) => heap.zero(size), free: (p: number) => heap.free(p) };
  const floats = (pointer: number, count: number) => objects.floats(pointer, count);
  const paint = (pointer: number, draw: (canvas: RasterContext) => void) =>
    objects.paint(pointer, draw);
  const paths = cgPathImports({
    ...memory,
    floats,
    context: (pointer) => objects.canvas(pointer),
    bounds: (pointer, x, y, width, height) =>
      addDeviceBounds(objects, pointer, x, y, width, height),
  });
  const gradients = gradientImports({
    ...memory,
    floats,
    spaceComponents: (pointer) => objects.space(pointer)?.components,
    paint,
  });
  const text = textImports({
    ...memory,
    paint,
    readFile,
    readBytes: (pointer, length) => cpu.read(pointer, length),
    cString: (pointer) => readString(cpu, pointer),
    writeWord: (pointer, value) => write32(cpu, pointer, value),
    providerBytes: (pointer) => objects.providerBytes(pointer),
    loadFont,
  });
  objects.tables.push(paths.paths, gradients.gradients, ...text.tables);
  objects.forgetContext = (pointer) => void text.forget(pointer);
  const funcs: Imports = {
    ...paths.imports,
    ...text.imports,
    ...gradients.imports,
    ...drawingImports(objects),
    ...bitmapHostImports(objects),
    ...objectImports(objects),
    ...imageMetadataImports({ image: (pointer) => objects.image(pointer) }),
    ...contextCallImports(objects),
  };
  return {
    funcs,
    data: new Map(),
    colors: objects.colors,
    owns: (pointer) => objects.owns(pointer),
    retainCount: (pointer) => objects.retainCount(pointer),
    equal: (first, second) => {
      if (objects.colors.has(first) || objects.colors.has(second))
        return objects.colors.equal(first, second);
      return objects.owns(first) || objects.owns(second) ? first === second : undefined;
    },
    hash: (pointer) => {
      if (objects.colors.has(pointer)) return objects.colors.hash(pointer);
      return objects.owns(pointer) ? pointer : undefined;
    },
    createImage: (width, height, rgba) => createQuartzImage(objects, width, height, rgba),
    pixels: (pointer) => quartzPixels(objects, pointer),
    retain: (pointer) => objects.retain(pointer),
    release: (pointer) => objects.release(pointer),
    setColor: (channels, fill, stroke) => objects.setColor(channels, fill, stroke),
    withContext: (canvas, callback) => objects.withContext(canvas, callback),
    drawCurrent: (draw) => objects.drawCurrent(draw),
    currentCanvas: () => objects.canvas(objects.current()),
  };
}
