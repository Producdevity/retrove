import { BackdropPainter } from "../../ui/glass/backdrop";
import { GlassLayer } from "../../ui/glass/layer";

const COMPACT = "(max-width: 699px)";
const BAR = { shape: "pill", tint: 0.56, frost: 0.1 } as const;
const BUTTON = { shape: "circle", tint: 0.12, frost: 0 } as const;
const CAPSULE = { shape: "pill", tint: 0.55, frost: 0.18 } as const;
const MATERIAL = { refraction: 34, dispersion: 1.2, edgeReach: 0.1, reflection: 0.16, echo: 0.12 };
const LENS_MATERIAL = { refraction: 92, dispersion: 2.2, highlight: 0.42 };
const WATCHED = ["hidden", "class", "aria-current", "open"];

export interface DockControls {
  readonly sidebar: HTMLElement;
  readonly nav: HTMLElement;
  readonly add: HTMLElement;
  readonly importer: HTMLElement;
}
export interface DockLayers {
  readonly dock: GlassLayer;
  readonly lens: GlassLayer;
  readonly stop: () => void;
}

/** Creates the two glass layers of the phone dock; loaded only where refraction runs. */
export function mountGlass(controls: DockControls, lost: () => void): DockLayers {
  const { sidebar, nav, add, importer } = controls;
  const chrome = (element: Element): boolean =>
    element instanceof HTMLCanvasElement ||
    element instanceof HTMLDialogElement ||
    element.classList.contains("top-edge") ||
    element === add ||
    element === importer;
  const dock = new GlassLayer(
    new BackdropPainter(document.body, (element) => chrome(element) || element === sidebar),
    MATERIAL,
    false,
    lost,
    sidebar,
  );
  const lens = new GlassLayer(
    new BackdropPainter(
      document.body,
      (element) => chrome(element) || element.classList.contains("selection"),
    ),
    LENS_MATERIAL,
    true,
    lost,
    sidebar,
  );
  const compact = matchMedia(COMPACT);
  const sync = (): void => {
    const shown = compact.matches;
    if (shown) dock.set("bar", { element: nav, look: BAR });
    else dock.remove("bar");
    if (shown && !add.classList.contains("morphed"))
      dock.set("add", { element: add, look: BUTTON });
    else dock.remove("add");
    if (shown && !importer.hidden) dock.set("importer", { element: importer, look: CAPSULE });
    else dock.remove("importer");
  };
  const listeners = new AbortController();
  const signal = listeners.signal;
  const changed = (): void => {
    if (signal.aborted) return;
    dock.invalidate();
    lens.invalidate();
    sync();
  };
  compact.addEventListener("change", changed, { signal });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", changed, { signal });
  document.addEventListener("load", changed, { capture: true, signal });
  const observer = new MutationObserver(changed);
  observer.observe(document.querySelector("main") ?? document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributeFilter: WATCHED,
  });
  observer.observe(nav, { subtree: true, attributeFilter: WATCHED });
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  void document.fonts.ready.then(changed);
  sync();
  return {
    dock,
    lens,
    stop: () => {
      listeners.abort();
      observer.disconnect();
    },
  };
}
