import type { Diagnostic } from "../../web/ipa.mjs";
import { GRAPHICS_CONTEXT_ATTRIBUTES, graphicsContextInfo } from "../runtime/graphics/context-info";
import { isLandscape, TALL_SCREEN, type ScreenSize } from "../runtime/ios/uikit/screen";
import { appProfile } from "../runtime/ios/profiles/app-manifest";
import { element } from "../ui/dom";

/** A display canvas whose WebGL context another thread creates. */
export interface OffscreenDisplay {
  readonly canvas: HTMLCanvasElement;
  readonly offscreen: OffscreenCanvas;
  /** Reports that the other thread lost the context. */
  lost(): void;
}

export class PlayerDisplay {
  readonly host = element("display", HTMLDivElement);
  private context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private transferred: OffscreenDisplay | null = null;
  private landscape = false;
  private screen: ScreenSize = TALL_SCREEN;
  private readonly observer: MutationObserver;
  constructor(
    private readonly fault: (error: Error) => void,
    onImage: () => void,
    private readonly diagnostic: Diagnostic,
  ) {
    this.observer = new MutationObserver(() => {
      if (this.host.querySelector('canvas[style*="position"]')) onImage();
    });
    this.observer.observe(this.host, { childList: true });
  }
  configure(info: Record<string, unknown>): void {
    const profile = appProfile(info);
    this.screen = profile.screen;
    this.landscape = isLandscape(profile.orientation);
    this.host.style.setProperty(
      "--aspect",
      String(
        this.landscape
          ? this.screen.height / this.screen.width
          : this.screen.width / this.screen.height,
      ),
    );
  }
  #canvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const { width, height, scale } = this.screen;
    canvas.width = (this.landscape ? height : width) * scale;
    canvas.height = (this.landscape ? width : height) * scale;
    canvas.dataset["graphics"] = "";
    return canvas;
  }
  graphics = (): WebGLRenderingContext | WebGL2RenderingContext => {
    if (this.context) return this.context;
    if (this.transferred) throw new Error("The graphics context belongs to a worker.");
    const canvas = this.#canvas();
    const context =
      canvas.getContext("webgl2", GRAPHICS_CONTEXT_ATTRIBUTES) ??
      canvas.getContext("webgl", GRAPHICS_CONTEXT_ATTRIBUTES);
    if (
      !(context instanceof WebGLRenderingContext) &&
      !(typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext)
    )
      throw new Error("WebGL is unavailable on this device.");
    canvas.addEventListener("webglcontextlost", () =>
      this.fault(new Error("The graphics context was lost.")),
    );
    this.host.prepend(canvas);
    this.context = context;
    this.diagnostic("info", "graphics", "Graphics context created", graphicsContextInfo(context));
    return context;
  };
  /** The display canvas handed to another thread, which creates its WebGL context there. */
  offscreen = (): OffscreenDisplay => {
    if (this.transferred) return this.transferred;
    if (this.context) throw new Error("The graphics context already exists on the page.");
    const canvas = this.#canvas();
    this.host.prepend(canvas);
    this.transferred = {
      canvas,
      offscreen: canvas.transferControlToOffscreen(),
      lost: () => this.fault(new Error("The graphics context was lost.")),
    };
    return this.transferred;
  };
  close(): void {
    this.observer.disconnect();
  }
}
