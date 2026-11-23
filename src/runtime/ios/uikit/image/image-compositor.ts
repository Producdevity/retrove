import { floatFromBits } from "../../abi/scalars";
import type { Rectangle } from "../host";
import { PlacementCache } from "../view/placement-cache";
import type { ImageViewAnimations } from "./animation";
import type { ImageStore } from "./image-store";
import { nodeContent, paintNode, type NodeContent } from "./image-node-paint";
import {
  active,
  displayPlacement,
  hideStaleMovies,
  percent,
  placeVideo,
  StyleCache,
  transitionStyle,
  type Inherited,
  type Pass,
  type Placement,
} from "./image-placement";
import type { ImagesHost, ImageViewData } from "./image-types";

const NODE_STYLE =
  "position:absolute;pointer-events:none;background:transparent;transform-origin:0 0";

/** Mirrors each visible view as an absolutely positioned canvas over the media host. */
export class ImageCompositor {
  readonly nodes = new Map<number, HTMLCanvasElement>();
  readonly #placements = new PlacementCache<Placement>();
  readonly #styles = new StyleCache();

  constructor(
    private readonly host: ImagesHost,
    private readonly store: ImageStore,
    private readonly animations: ImageViewAnimations,
  ) {}

  close(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.store.images.clear();
    this.#placements.clear();
  }
  removeView(view: number): void {
    this.nodes.get(view)?.remove();
    this.nodes.delete(view);
    this.#placements.forget(view);
  }

  async render(window: number): Promise<void> {
    const media = this.host.mediaHost;
    if (!media || !this.store.document) return;
    const pass = this.#startPass(window, media);
    const [, , w, h] = pass.screen;
    if (w && h) {
      await this.#visit(pass, window, {
        x: 0,
        y: 0,
        alpha: 1,
        opacityTiming: undefined,
        layoutTiming: undefined,
      });
    }
    hideStaleMovies(media, pass.placed);
    const graphics = media.querySelector<HTMLCanvasElement>("canvas[data-graphics]");
    if (graphics) graphics.style.zIndex = pass.glOrder ? String(pass.glOrder) : "";
    for (const [view, node] of this.nodes) {
      if (pass.shown.has(view)) continue;
      node.remove();
      this.nodes.delete(view);
      this.#placements.forget(view);
    }
  }

  #startPass(window: number, media: HTMLElement): Pass {
    const { host } = this;
    const screen: Rectangle | undefined = window
      ? (host.displayBounds?.(window) ?? host.data(window).bounds)
      : undefined;
    const [, , w = 0, h = 0] = screen ?? [];
    const toDisplay = host.displayPoint ?? host.convertPoint;
    const aspect =
      media.offsetWidth && media.offsetHeight && w && h
        ? media.offsetHeight / h / (media.offsetWidth / w)
        : 1;
    const origin = toDisplay?.([0, 0], window, window);
    const unit = toDisplay?.([1, 1], window, window);
    return {
      window,
      screen: screen ?? [0, 0, 0, 0],
      aspect,
      toDisplay,
      screenKey: screen
        ? [...screen, aspect, origin?.[0] ?? 0, origin?.[1] ?? 0, unit?.[0] ?? 0, unit?.[1] ?? 0]
        : [],
      now: performance.now(),
      shown: new Set(),
      placed: new Set(),
      order: 1,
      glOrder: 0,
    };
  }

  async #visit(pass: Pass, view: number, inherited: Inherited): Promise<void> {
    const { host } = this;
    const state = host.data(view);
    const alpha = inherited.alpha * state.alpha;
    const opacityTiming = active(pass.now, state.opacityAnimation) ?? inherited.opacityTiming;
    const layoutTiming = active(pass.now, state.layoutAnimation) ?? inherited.layoutTiming;
    if (state.hidden || (alpha <= 0 && !opacityTiming)) return;
    const here: Inherited = { x: inherited.x, y: inherited.y, alpha, opacityTiming, layoutTiming };
    const [bx, by, vw, vh] = state.bounds;
    const content = nodeContent(host, this.store, this.animations.frame(view), view, state);
    if (vw > 0 && vh > 0 && this.#hasContent(content))
      await this.#drawNode(pass, view, state, here, content);
    const video = host.movieVideo?.(view);
    if (video && vw > 0 && vh > 0)
      placeVideo(pass, video, view, state, here, host.clip?.(view) ?? "none");
    // GL content sits in the view order at its EAGL layer, so views behind it stay behind the game.
    if (state.layer && host.glLayer?.(state.layer)) pass.glOrder = pass.order++;
    if (state.layer) await this.#visit(pass, state.layer, here);
    const children = [...state.children].sort(
      (a, b) => (host.data(a).zPosition ?? 0) - (host.data(b).zPosition ?? 0),
    );
    for (const child of children) {
      const frame = host.data(child).frame;
      await this.#visit(pass, child, {
        ...here,
        x: here.x + frame[0] - bx,
        y: here.y + frame[1] - by,
      });
    }
  }

  #hasContent(content: NodeContent): boolean {
    return Boolean(
      content.image ||
      content.custom ||
      content.hostDrawing ||
      content.layerContent ||
      content.colored,
    );
  }

  #node(view: number, state: ImageViewData): HTMLCanvasElement {
    const existing = this.nodes.get(view);
    if (existing) return existing;
    const node = this.store.pixelCanvas(1, 1);
    node.style.cssText = NODE_STYLE;
    this.host.mediaHost?.append(node);
    this.nodes.set(view, node);
    state.needsDisplay = true;
    return node;
  }

  async #drawNode(
    pass: Pass,
    view: number,
    state: ImageViewData,
    inherited: Inherited,
    content: NodeContent,
  ): Promise<void> {
    const { host } = this;
    const [bx, by, vw, vh] = state.bounds;
    const node = this.#node(view, state);
    pass.shown.add(view);
    const zIndex = pass.order++;
    const scale = state.contentScaleFactor ? floatFromBits(state.contentScaleFactor) : 1;
    const px = Math.max(1, Math.ceil(vw * scale));
    const py = Math.max(1, Math.ceil(vh * scale));
    if (node.width !== px || node.height !== py) {
      node.width = px;
      node.height = py;
      state.needsDisplay = true;
    }
    const clip = host.clip?.(view) ?? "none";
    const animating = Boolean(inherited.opacityTiming || inherited.layoutTiming);
    let placement: Placement = { x: inherited.x, y: inherited.y, matrix: "", clipPath: clip };
    const { toDisplay } = pass;
    if (toDisplay) {
      const compute = () => displayPlacement(pass, toDisplay, view, [bx, by], clip);
      placement = animating
        ? compute()
        : this.#placements.get(view, (at) => host.data(at), pass.screenKey, compute);
    }
    this.#applyStyles(pass, node, state, inherited, placement, zIndex);
    if (state.needsDisplay) await paintNode(host, this.store, node, view, state, content);
  }

  #applyStyles(
    pass: Pass,
    node: HTMLCanvasElement,
    state: ImageViewData,
    inherited: Inherited,
    placement: Placement,
    zIndex: number,
  ): void {
    const [, , w, h] = pass.screen;
    const [, , vw, vh] = state.bounds;
    const style = (name: Parameters<StyleCache["apply"]>[1], value: string) =>
      this.#styles.apply(node, name, value);
    style("clipPath", placement.clipPath);
    style("transition", transitionStyle(inherited));
    style("left", percent(placement.x, w));
    style("top", percent(placement.y, h));
    style("width", percent(vw, w));
    style("height", percent(vh, h));
    style("transform", placement.matrix);
    style("opacity", String(inherited.alpha * (state.imageAdjustment?.opacity ?? 1)));
    style("filter", state.imageAdjustment ? `brightness(${state.imageAdjustment.brightness})` : "");
    style("zIndex", String(zIndex));
  }
}
