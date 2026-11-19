import { BackdropPainter } from "../../ui/glass/backdrop";
import { GlassLayer } from "../../ui/glass/layer";

const COMPACT = "(max-width: 699px)";
const BAR = { shape: "pill", tint: 0.62, frost: 0.32 } as const;
const MATERIAL = { refraction: 34, dispersion: 1.2, edgeReach: 0.1, reflection: 0.16, echo: 0.12 };
const LENS_MATERIAL = { refraction: 92, dispersion: 2.2, highlight: 0.42 };
const WATCHED = ["hidden", "class", "aria-current", "open"];

export interface DockControls {
  readonly sidebar: HTMLElement;
  readonly nav: HTMLElement;
}
export interface DockLayers {
  readonly dock: GlassLayer;
  readonly lens: GlassLayer;
  readonly stop: () => void;
}

/** Creates the two glass layers of the phone dock; loaded only where refraction runs. */
export function mountGlass(controls: DockControls, lost: () => void): DockLayers {
  const { sidebar, nav } = controls;
  const chrome = (element: Element): boolean =>
    element instanceof HTMLCanvasElement ||
    element instanceof HTMLDialogElement ||
    element.classList.contains("top-edge");
  const dock = new GlassLayer(
    new BackdropPainter(document.body, (element) => chrome(element) || element === sidebar),
    MATERIAL,
    false,
    lost,
    sidebar,
  );
  // The lens magnifies the bar and its labels, not the page the bar floats over.
  const lens = new GlassLayer(
    new BackdropPainter(
      document.body,
      (element) => chrome(element) || element.classList.contains("selection"),
      (element) => element === nav,
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
  // Content that animates or resizes into place moves after the mutation that announced it.
  for (const type of ["transitionend", "animationend"])
    document.addEventListener(type, changed, { capture: true, signal });
  const resized = new ResizeObserver(changed);
  resized.observe(document.querySelector("main") ?? document.body);
  // iOS can blank a WebGL canvas while the app is in the background without losing its context.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") changed();
    },
    { signal },
  );
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
      resized.disconnect();
    },
  };
}
