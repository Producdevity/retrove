import { initialOrientation, phoneScreen } from "../../web/screen.mjs";
import { element } from "../ui/dom";
const LAST_PORTRAIT_ORIENTATION = 2;
export class PlayerDisplay {
  readonly host = element("display", HTMLDivElement);
  private context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private landscape = false;
  private readonly observer: MutationObserver;
  constructor(
    private readonly fault: (error: Error) => void,
    onImage: () => void,
  ) {
    this.observer = new MutationObserver(() => {
      if (this.host.querySelector('canvas[style*="position"]')) onImage();
    });
    this.observer.observe(this.host, { childList: true });
  }
  configure(info: Record<string, unknown>): void {
    this.landscape = initialOrientation(info) > LAST_PORTRAIT_ORIENTATION;
    this.host.style.setProperty(
      "--aspect",
      String(
        this.landscape
          ? phoneScreen.height / phoneScreen.width
          : phoneScreen.width / phoneScreen.height,
      ),
    );
  }
  graphics = (): WebGLRenderingContext | WebGL2RenderingContext => {
    if (this.context) return this.context;
    const canvas = document.createElement("canvas");
    canvas.width = (this.landscape ? phoneScreen.height : phoneScreen.width) * phoneScreen.scale;
    canvas.height = (this.landscape ? phoneScreen.width : phoneScreen.height) * phoneScreen.scale;
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
    this.host.prepend(canvas);
    this.context = context;
    return context;
  };
  close(): void {
    this.observer.disconnect();
  }
}
