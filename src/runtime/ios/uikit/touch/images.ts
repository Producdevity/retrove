import { drawScrollIndicators } from "../scroll/indicators";
import { floatBits, floatFromBits } from "../../abi/scalars";
import { uiImages } from "../../../../../web/uikit-images.mjs";
import type { TouchContext } from "./context";

type DrawContext = CanvasRenderingContext2D;

function hasHostDrawing(ctx: TouchContext, pointer: number): boolean {
  const { services } = ctx;
  return !!(
    services.tables.peek()?.has(pointer) ||
    services.textViews.peek()?.has(pointer) ||
    services.pickerViews.peek()?.has(pointer) ||
    services.pageControls.peek()?.has(pointer) ||
    services.segmentedControls.peek()?.has(pointer) ||
    services.switches.peek()?.has(pointer) ||
    services.toolbars.peek()?.has(pointer) ||
    services.scrollers.peek()?.views.states.has(pointer)
  );
}

function drawHost(ctx: TouchContext, pointer: number, canvas: DrawContext): void {
  const { services } = ctx;
  const tables = services.tables.peek();
  const scrollers = services.scrollers.peek();
  const labels = services.textViews.peek();
  if (tables?.has(pointer)) {
    tables.draw(pointer, canvas);
    if (!scrollers?.views.states.has(pointer)) return;
  }
  if (labels?.has(pointer)) {
    labels.draw(pointer, canvas);
    return;
  }
  if (scrollers?.views.states.has(pointer)) {
    drawScrollIndicators(scrollers.views, pointer, canvas);
    return;
  }
  for (const widget of [
    services.pickerViews.peek(),
    services.pageControls.peek(),
    services.segmentedControls.peek(),
    services.switches.peek(),
    services.toolbars.peek(),
  ]) {
    if (widget?.has(pointer)) {
      widget.draw(pointer, canvas);
      return;
    }
  }
  labels?.draw(pointer, canvas);
}

export function installImages(ctx: TouchContext): void {
  const { services, kit, geo, collections, lookup, read } = ctx;
  const images = uiImages({
    hostClass: ctx.hostClass,
    method: ctx.method,
    names: ctx.names,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain: ctx.retain,
    releaseFromHost: ctx.releaseFromHost,
    text: ctx.text,
    write: ctx.write,
    ipa: ctx.ipa,
    readFile: ctx.readFile,
    mediaHost: ctx.mediaHost,
    data: kit.data,
    setFrame: kit.setFrame,
    bits: floatBits,
    float: floatFromBits,
    lookup,
    read,
    send: ctx.send,
    getCoreGraphics: ctx.getCoreGraphics,
    diagnostic: ctx.diagnostic,
    convertPoint: geo.convertPoint,
    displayPoint: geo.displayPoint,
    displayBounds: geo.displayBounds,
    clip: geo.clip,
    movieVideo: ctx.movieVideo,
    uiColor: (pointer: number) => services.uiColors.peek()?.rgba(pointer),
    uiPattern: (pointer: number) => services.uiColors.peek()?.patterns.get(pointer),
    glLayer: (pointer: number) => !!lookup(read(pointer), "setDrawableProperties:"),
    elements: collections.items,
    hasHostDrawing: (pointer: number) => hasHostDrawing(ctx, pointer),
    drawHost: (pointer: number, canvas: DrawContext) => {
      drawHost(ctx, pointer, canvas);
    },
  });
  services.imageViews.set(images);
}
