import type { GlassLayer } from "../../ui/glass/layer";
import { refractionAllowed } from "../../ui/glass/support";
import type { DockControls, DockLayers } from "./glass-dock";

/**
 * Real refraction for the floating controls on phones, loaded only where it runs. Without
 * WebGL2, with reduced motion or transparency, or after the context is lost, the controls
 * keep their CSS material.
 */
const RETRY_MS = 1_000;
const MAX_RESTARTS = 3;

export class Dock {
  private layers: DockLayers | undefined;
  private active = false;
  private restarts = 0;
  constructor(private readonly controls: DockControls) {
    if (!refractionAllowed()) return;
    this.start();
    // A running app must be the only WebGL user, also while this page sits in the back-forward cache.
    addEventListener("pagehide", () => this.release());
    addEventListener("pageshow", (event) => {
      if (event.persisted) this.start();
    });
    // A context lost in the background comes back with the app instead of leaving CSS glass for good.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.restarts > 0) this.start();
    });
  }
  /** Renders above the tab bar, for the selection lens. */
  get lens(): GlassLayer | undefined {
    return this.layers?.lens;
  }
  /** Keep the glass rendering while a control animates. */
  wake(milliseconds: number): void {
    this.layers?.dock.wake(milliseconds);
  }
  /** Releases both WebGL contexts and removes their canvases. */
  release(): void {
    this.active = false;
    this.layers?.stop();
    this.layers?.dock.destroy();
    this.layers?.lens.destroy();
    this.layers = undefined;
  }
  private lost(): void {
    this.release();
    if (++this.restarts > MAX_RESTARTS) return;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") this.start();
    }, RETRY_MS);
  }
  private start(): void {
    if (this.active || this.restarts > MAX_RESTARTS) return;
    this.active = true;
    import("./glass-dock").then(
      ({ mountGlass }) => {
        if (this.active && !this.layers) this.layers = mountGlass(this.controls, () => this.lost());
      },
      () => {
        this.active = false;
      },
    );
  }
}
