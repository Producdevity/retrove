import type { Diagnostic } from "../../web/ipa.mjs";
import { graphicsContextInfo } from "../runtime/graphics/context-info";
import { isLandscape, TALL_SCREEN, type ScreenSize } from "../runtime/ios/uikit/screen";
import { appProfile } from "../runtime/ios/profiles/app-manifest";
import { element } from "../ui/dom";
export class PlayerDisplay {
  readonly host = element("display", HTMLDivElement);
  private context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
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
  graphics = (): WebGLRenderingContext | WebGL2RenderingContext => {
    if (this.context) return this.context;
    const canvas = document.createElement("canvas");
    const { width, height, scale } = this.screen;
    canvas.width = (this.landscape ? height : width) * scale;
    canvas.height = (this.landscape ? width : height) * scale;
    const attributes = { alpha: false, antialias: false, preserveDrawingBuffer: true };
    const context =
      canvas.getContext("webgl2", attributes) ?? canvas.getContext("webgl", attributes);
    if (
      !(context instanceof WebGLRenderingContext) &&
      !(typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext)
    )
      throw new Error("WebGL is unavailable on this device.");
    canvas.addEventListener("webglcontextlost", () =>
      this.fault(new Error("The graphics context was lost.")),
    );
    canvas.dataset["graphics"] = "";
    this.host.prepend(canvas);
    this.context = context;
    this.diagnostic("info", "graphics", "Graphics context created", graphicsContextInfo(context));
    return context;
  };
  close(): void {
    this.observer.disconnect();
  }
}
