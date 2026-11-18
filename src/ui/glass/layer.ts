import {
  LiquidGlassWebGLV2,
  type LiquidGlassV2Element,
  type LiquidGlassV2Material,
} from "apple-liquid-glass-webgl/v2";
import type { BackdropPainter } from "./backdrop";
import { type Region } from "./backdrop";

export type GlassLook = Pick<
  LiquidGlassV2Element,
  "shape" | "tint" | "frost" | "layer" | "pressure" | "pressureAxes" | "opacity"
>;
export interface GlassTarget {
  readonly element: HTMLElement;
  readonly look: GlassLook;
  /** Rendered geometry when it differs from the element's box, in viewport pixels. */
  readonly rect?: Region;
}
const BLEED = 28;
const MAX_SCALE = 2;
const SCROLL_FRAMES_MS = 220;
/** One WebGL context that draws every glass control in one screen area. */
export class GlassLayer {
  readonly canvas = document.createElement("canvas");
  private readonly backdrop = document.createElement("canvas");
  private readonly renderer: LiquidGlassWebGLV2;
  private readonly targets = new Map<string, GlassTarget>();
  private awakeUntil = 0;
  private frame = 0;
  private region: Region = { x: 0, y: 0, width: 0, height: 0 };
  private placement = "";
  private readonly listeners = new AbortController();
  constructor(
    private readonly painter: BackdropPainter,
    material: Partial<LiquidGlassV2Material>,
    above: boolean,
    lost: () => void,
    private readonly host?: HTMLElement,
  ) {
    this.canvas.className = ["glass-layer", above ? "above" : "", host ? "hosted" : ""]
      .filter(Boolean)
      .join(" ");
    this.canvas.setAttribute("aria-hidden", "true");
    (host ?? document.body).append(this.canvas);
    this.renderer = new LiquidGlassWebGLV2(this.canvas, {
      compositeMode: "overlay",
      material,
      autoResize: false,
      onContextLost: lost,
    });
    const signal = this.listeners.signal;
    addEventListener("scroll", () => this.wake(SCROLL_FRAMES_MS), { passive: true, signal });
    addEventListener("resize", () => this.invalidate(), { signal });
  }
  /** Releases the WebGL context and every listener; the controls fall back to CSS glass. */
  destroy(): void {
    this.listeners.abort();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const [id, target] of this.targets) {
      this.targets.delete(id);
      delete target.element.dataset["glass"];
    }
    this.renderer.destroy();
    // The renderer frees its resources but keeps the context; Safari limits live contexts.
    this.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
    this.backdrop.width = this.backdrop.height = 0;
  }
  set(id: string, target: GlassTarget): void {
    if (!this.targets.has(id)) target.element.dataset["glass"] = "webgl";
    this.targets.set(id, target);
    this.wake();
  }
  remove(id: string): void {
    const target = this.targets.get(id);
    if (!target) return;
    this.targets.delete(id);
    if (![...this.targets.values()].some((other) => other.element === target.element))
      delete target.element.dataset["glass"];
    this.wake();
  }
  /** Content under the glass changed shape, so the backdrop copy must be rebuilt. */
  invalidate(): void {
    this.painter.invalidate();
    this.wake();
  }
  /** Keep rendering for a while, for example during a transition. */
  wake(milliseconds = 0): void {
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + milliseconds);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  private readonly tick = (now: number): void => {
    this.frame = 0;
    this.draw();
    if (now < this.awakeUntil || this.animating()) this.frame = requestAnimationFrame(this.tick);
  };
  /** A control in a CSS transition moves without any event, so follow it until it settles. */
  private animating(): boolean {
    for (const { element } of this.targets.values())
      if (element.getAnimations().some((animation) => animation.playState === "running"))
        return true;
    return false;
  }
  private measure(): { region: Region; boxes: Map<string, Region> } {
    const boxes = new Map<string, Region>();
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const [id, target] of this.targets) {
      const box = target.rect ?? target.element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      boxes.set(id, box);
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.width);
      bottom = Math.max(bottom, box.y + box.height);
    }
    if (!boxes.size) return { region: { x: 0, y: 0, width: 0, height: 0 }, boxes };
    // No clamp to innerWidth/innerHeight: iOS home-screen apps report an innerHeight that
    // excludes the status bar while fixed controls are laid out against the full screen.
    const x = Math.floor(Math.max(0, left - BLEED)),
      y = Math.floor(Math.max(0, top - BLEED));
    const width = Math.ceil(right + BLEED) - x,
      height = Math.ceil(bottom + BLEED) - y;
    return { region: { x, y, width, height }, boxes };
  }
  /** Hosted canvases sit inside the controls' own fixed container and move with it. */
  private place(region: Region, scale: number): void {
    const origin = this.host?.getBoundingClientRect() ?? { x: 0, y: 0 },
      placement = [region.x - origin.x, region.y - origin.y, region.width, region.height].join();
    if (placement !== this.placement)
      Object.assign(this.canvas.style, {
        left: `${region.x - origin.x}px`,
        top: `${region.y - origin.y}px`,
        width: `${region.width}px`,
        height: `${region.height}px`,
      });
    this.placement = placement;
    const resized = region.width !== this.region.width || region.height !== this.region.height;
    this.region = region;
    if (!resized) return;
    this.backdrop.width = Math.round(region.width * scale);
    this.backdrop.height = Math.round(region.height * scale);
    this.renderer.setBackdrop(this.backdrop, { update: "static", shouldRender: false });
  }
  /** Draw now, so a controller that moved a target this frame is not a frame behind. */
  draw(): void {
    const { region, boxes } = this.measure();
    this.canvas.hidden = !boxes.size;
    if (!boxes.size) return;
    const scale = Math.min(devicePixelRatio, MAX_SCALE);
    this.place(region, scale);
    const context = this.backdrop.getContext("2d");
    if (!context) return;
    this.painter.paint(context, region, scale);
    this.renderer.updateBackdrop(false);
    this.renderer.setElements(this.elements(region, boxes), false);
    this.renderer.render({ force: true, dpr: scale });
  }
  private elements(region: Region, boxes: Map<string, Region>): LiquidGlassV2Element[] {
    const tone = this.painter.dark ? "dark" : "light";
    const elements: LiquidGlassV2Element[] = [];
    for (const [id, box] of boxes) {
      const target = this.targets.get(id);
      if (!target) continue;
      elements.push({
        ...target.look,
        id,
        x: box.x - region.x,
        y: box.y - region.y,
        width: box.width,
        height: box.height,
        tintTone: tone,
      });
    }
    return elements;
  }
}
