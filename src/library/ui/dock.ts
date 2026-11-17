import type { GlassLayer } from "../../ui/glass/layer";
import { refractionAllowed } from "../../ui/glass/support";
import type { DockControls, DockLayers } from "./glass-dock";

/**
 * Real refraction for the floating controls on phones, loaded only where it runs. Without
 * WebGL2, with reduced motion or transparency, or after the context is lost, the controls
 * keep their CSS material.
 */
export class Dock {
  private layers: DockLayers | undefined;
  private active = false;
  constructor(private readonly controls: DockControls) {
    if (!refractionAllowed()) return;
    this.start();
    // A running app must be the only WebGL user, also while this page sits in the back-forward cache.
    addEventListener("pagehide", () => this.release());
    addEventListener("pageshow", (event) => {
      if (event.persisted) this.start();
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
  private start(): void {
    if (this.active) return;
    this.active = true;
    import("./glass-dock").then(
      ({ mountGlass }) => {
        if (this.active && !this.layers)
          this.layers = mountGlass(this.controls, () => this.release());
      },
      () => {
        this.active = false;
      },
    );
  }
}
