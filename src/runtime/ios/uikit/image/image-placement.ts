import { MOVIE_OFFSCREEN_EVENT, MOVIE_ONSCREEN_EVENT } from "../../media/movie-playback";
import type { Rectangle } from "../host";
import type { DisplayPoint, ImageViewData, ViewTiming } from "./image-types";

const PERCENT = 100;
const MILLISECONDS_PER_SECOND = 1000;
type StyleName =
  | "clipPath"
  | "transition"
  | "left"
  | "top"
  | "width"
  | "height"
  | "transform"
  | "opacity"
  | "filter"
  | "zIndex";
type AppliedStyles = Partial<Record<StyleName, string>>;

/** Where a view's node sits on the display, in display points. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly matrix: string;
  readonly clipPath: string;
}
/** What one compositor pass shares between the views it visits. */
export interface Pass {
  readonly window: number;
  readonly screen: Rectangle;
  readonly aspect: number;
  readonly toDisplay: DisplayPoint | undefined;
  readonly screenKey: number[];
  readonly now: number;
  readonly shown: Set<number>;
  readonly placed: Set<HTMLElement>;
  order: number;
  glOrder: number;
}
export interface Inherited {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly opacityTiming: ViewTiming | undefined;
  readonly layoutTiming: ViewTiming | undefined;
}

export const percent = (value: number, total: number): string => `${(PERCENT * value) / total}%`;

/** The running animation, or undefined once it ended. */
export function active(now: number, timing: ViewTiming | undefined): ViewTiming | undefined {
  return timing && now < timing.start + (timing.duration + timing.delay) * MILLISECONDS_PER_SECOND
    ? timing
    : undefined;
}
function transitions(properties: readonly string[], timing: ViewTiming | undefined): string[] {
  return timing
    ? properties.map((name) => `${name} ${timing.duration}s ${timing.curve} ${timing.delay}s`)
    : [];
}
export function transitionStyle(inherited: Inherited): string {
  if (!inherited.opacityTiming && !inherited.layoutTiming) return "";
  return [
    ...transitions(["opacity"], inherited.opacityTiming),
    ...transitions(["transform", "width", "height", "left", "top"], inherited.layoutTiming),
  ].join(",");
}

/** Placement of `view`'s bounds origin, with the CSS matrix for its transform. */
export function displayPlacement(
  pass: Pass,
  toDisplay: DisplayPoint,
  view: number,
  origin: readonly [number, number],
  clip: string,
): Placement {
  const [bx, by] = origin;
  const p = toDisplay([bx, by], view, pass.window);
  const qx = toDisplay([bx + 1, by], view, pass.window);
  const qy = toDisplay([bx, by + 1], view, pass.window);
  const matrix = [
    qx[0] - p[0],
    (qx[1] - p[1]) * pass.aspect,
    (qy[0] - p[0]) / pass.aspect,
    qy[1] - p[1],
    0,
    0,
  ];
  return {
    x: p[0] - pass.screen[0],
    y: p[1] - pass.screen[1],
    matrix: `matrix(${matrix.join(",")})`,
    clipPath: clip,
  };
}

/** Writing an unchanged style still invalidates it; the compositor runs every event-loop turn. */
export class StyleCache {
  readonly #applied = new WeakMap<HTMLElement, AppliedStyles>();
  apply(node: HTMLElement, name: StyleName, value: string): void {
    let applied = this.#applied.get(node);
    if (!applied) this.#applied.set(node, (applied = {}));
    if (applied[name] === value) return;
    applied[name] = value;
    node.style[name] = value;
  }
}

/** A movie player's video draws as its view's content, above the view and below its subviews. */
export function placeVideo(
  pass: Pass,
  video: HTMLElement,
  view: number,
  state: ImageViewData,
  inherited: Inherited,
  clip: string,
): void {
  const [bx, by, vw, vh] = state.bounds;
  const [, , w, h] = pass.screen;
  const placement = pass.toDisplay
    ? displayPlacement(pass, pass.toDisplay, view, [bx, by], clip)
    : { x: inherited.x, y: inherited.y, matrix: "", clipPath: clip };
  const appeared = !("placed" in video.dataset) || video.style.display === "none";
  pass.placed.add(video);
  video.dataset["placed"] = "";
  Object.assign(video.style, {
    display: "",
    position: "absolute",
    pointerEvents: "none",
    transformOrigin: "0 0",
    clipPath: clip,
    left: percent(placement.x, w),
    top: percent(placement.y, h),
    width: percent(vw, w),
    height: percent(vh, h),
    transform: placement.matrix,
    opacity: String(inherited.alpha),
    zIndex: String(pass.order++),
  });
  if (appeared) video.dispatchEvent(new Event(MOVIE_ONSCREEN_EVENT));
}

/** A movie whose view left the window, or was hidden, must not stay on screen with its controls. */
export function hideStaleMovies(media: HTMLElement, placed: ReadonlySet<HTMLElement>): void {
  for (const video of media.querySelectorAll<HTMLElement>("video[data-placed]")) {
    if (placed.has(video) || video.style.display === "none") continue;
    video.style.display = "none";
    video.dispatchEvent(new Event(MOVIE_OFFSCREEN_EVENT));
  }
}
