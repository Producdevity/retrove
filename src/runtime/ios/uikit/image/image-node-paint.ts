import type { RGBA } from "../../../graphics/core-graphics/colors/model";
import type { DecodedImage } from "../../../graphics/core-graphics/quartz-images";
import { floatBits, floatFromBits } from "../../abi/scalars";
import { drawLayerBackground, drawLayerBorder } from "../layer-colors";
import type { ImageStore } from "./image-store";
import {
  ContentMode,
  context2d,
  type ImageRecord,
  type ImagesHost,
  type ImageViewData,
} from "./image-types";

type Rect = readonly [number, number, number, number];
const CENTER = 0.5;
const LEFT_MODES: readonly number[] = [
  ContentMode.Left,
  ContentMode.TopLeft,
  ContentMode.BottomLeft,
];
const RIGHT_MODES: readonly number[] = [
  ContentMode.Right,
  ContentMode.TopRight,
  ContentMode.BottomRight,
];
const TOP_MODES: readonly number[] = [ContentMode.Top, ContentMode.TopLeft, ContentMode.TopRight];
const BOTTOM_MODES: readonly number[] = [
  ContentMode.Bottom,
  ContentMode.BottomLeft,
  ContentMode.BottomRight,
];

/** What a view draws into its node. */
export interface NodeContent {
  readonly image: ImageRecord | undefined;
  readonly layerContent: DecodedImage | null | undefined;
  readonly custom: boolean;
  readonly hostDrawing: boolean;
  readonly background: RGBA | undefined;
  readonly pattern: ImageRecord | undefined;
  readonly colored: boolean;
}

/** The rectangle `contentMode` places an image of `size` in, within `bounds`. */
export function imageRect(
  size: { readonly width: number; readonly height: number },
  mode: number | undefined,
  [x, y, w, h]: Rect,
): [number, number, number, number] {
  if (!mode || mode === ContentMode.Redraw) return [x, y, w, h];
  let width = size.width;
  let height = size.height;
  if (mode === ContentMode.ScaleAspectFit || mode === ContentMode.ScaleAspectFill) {
    const fit = mode === ContentMode.ScaleAspectFit ? Math.min : Math.max;
    const scale = fit(w / width, h / height);
    width *= scale;
    height *= scale;
  }
  const left = LEFT_MODES.includes(mode) ? 0 : RIGHT_MODES.includes(mode) ? 1 : CENTER;
  const top = TOP_MODES.includes(mode) ? 0 : BOTTOM_MODES.includes(mode) ? 1 : CENTER;
  return [x + (w - width) * left, y + (h - height) * top, width, height];
}

export function nodeContent(
  host: ImagesHost,
  store: ImageStore,
  animationFrame: number,
  view: number,
  state: ImageViewData,
): NodeContent {
  const imageKey =
    animationFrame || (state.highlighted ? state.highlightedImage : undefined) || state.image;
  const cg = store.coreGraphics();
  const background = state.backgroundColor ? host.uiColor?.(state.backgroundColor) : undefined;
  const patternKey = state.backgroundColor ? host.uiPattern?.(state.backgroundColor) : undefined;
  const pattern = patternKey ? store.images.get(patternKey) : undefined;
  return {
    image: imageKey ? store.images.get(imageKey) : undefined,
    layerContent: state.contents ? cg?.pixels(state.contents) : undefined,
    custom: typeof host.lookup(host.read(view), "drawRect:") === "number",
    hostDrawing: Boolean(host.hasHostDrawing?.(view)),
    background,
    pattern,
    colored: Boolean(background || pattern || state.layerBackgroundColor || state.borderColor),
  };
}

/** Redraws a view's node: backgrounds, image, layer contents, host drawing, drawRect:, border. */
export async function paintNode(
  host: ImagesHost,
  store: ImageStore,
  node: HTMLCanvasElement,
  view: number,
  state: ImageViewData,
  content: NodeContent,
): Promise<void> {
  const { image, layerContent, custom, hostDrawing, background, pattern, colored } = content;
  const [bx, by, vw, vh] = state.bounds;
  const cg = store.coreGraphics();
  const rgba = (pointer: number) => cg?.colors.rgba(pointer);
  const context = context2d(node);
  const scaleX = node.width / vw;
  const scaleY = node.height / vh;
  state.needsDisplay = false;
  context.setTransform(scaleX, 0, 0, scaleY, -bx * scaleX, -by * scaleY);
  if (state.clearsContextBeforeDrawing !== 0) context.clearRect(bx, by, vw, vh);
  if (colored) drawLayerBackground(context, state, rgba, background);
  if (pattern && !state.layerBackgroundColor) store.tile(pattern, context, state.bounds);
  if (image) {
    const [x, y, width, height] = imageRect(image, state.contentMode, state.bounds);
    store.draw(image, context, x, y, width, height);
  }
  if (layerContent) {
    const layer = store.rgbaCanvas(layerContent.width, layerContent.height, layerContent.rgba);
    const scale = state.contentsScale ? floatFromBits(state.contentsScale) : 1;
    const [x, y, width, height] = imageRect(
      { width: layerContent.width / scale, height: layerContent.height / scale },
      state.contentMode,
      state.bounds,
    );
    context.drawImage(layer, x, y, width, height);
  }
  if (hostDrawing) await host.drawHost?.(view, context);
  if (custom && cg)
    await cg.withContext(context, () =>
      host.send(
        view,
        "drawRect:",
        state.bounds.map((value) => floatBits(value)),
      ),
    );
  if (state.borderColor) drawLayerBorder(context, state, rgba);
}
