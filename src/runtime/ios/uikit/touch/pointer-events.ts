import { isLandscape, Orientation } from "../screen";
import type { UiContext } from "./context";
import { PointerPhase } from "./pointer-queue";
import type { Point } from "./view-data";
import { GeometryField } from "../../abi/scalars";

const MILLISECONDS_PER_SECOND = 1000;
const PRIMARY_BUTTON = 0;
const ALPHA_CUTOFF = 0.01;
const LANDSCAPE_RIGHT = Orientation.UIInterfaceOrientationLandscapeRight;
const LANDSCAPE_LEFT = Orientation.UIInterfaceOrientationLandscapeLeft;
const TURN_RIGHT = "90";
const TURN_LEFT = "-90";

export function createHitTest(ctx: UiContext): (self: number, x: number, y: number) => number {
  const { kit, geo } = ctx;
  const { data } = kit;
  const hit = (self: number, x: number, y: number): number => {
    const view = data(self);
    const [bx, by, width, height] = view.bounds;
    if (
      view.hidden ||
      !view.interactive ||
      view.alpha <= ALPHA_CUTOFF ||
      x < bx ||
      y < by ||
      x >= bx + width ||
      y >= by + height
    ) {
      return 0;
    }
    for (let index = view.children.length - 1; index >= 0; index--) {
      const pointer = view.children[index];
      if (pointer === undefined) continue;
      const [cx, cy] = geo.fromParent(data(pointer), [x, y]);
      const found = hit(pointer, cx, cy);
      if (found) return found;
    }
    return self;
  };
  return hit;
}

/** Maps a client position on the canvas to window coordinates, undoing stage and interface turns. */
function windowPoint(
  ctx: UiContext,
  canvas: HTMLCanvasElement,
  event: PointerEvent,
): Point | undefined {
  const rect = canvas.getBoundingClientRect();
  const bounds = ctx.kit.data(ctx.state.window).bounds;
  if (!rect.width || !rect.height) return undefined;
  let x = (event.clientX - rect.left) / rect.width;
  let y = (event.clientY - rect.top) / rect.height;
  // The player can turn the whole stage a quarter turn; undo it to get display coordinates.
  const turn = canvas.ownerDocument?.body?.dataset?.["turn"];
  if (turn === TURN_RIGHT) [x, y] = [y, 1 - x];
  else if (turn === TURN_LEFT) [x, y] = [1 - y, x];
  const orientation = ctx.getOrientation();
  const [bx, by, width, height] = bounds;
  if (bounds[GeometryField.Width] < bounds[GeometryField.Height] && isLandscape(orientation)) {
    if (orientation === LANDSCAPE_RIGHT) [x, y] = [1 - y, x];
    if (orientation === LANDSCAPE_LEFT) [x, y] = [y, 1 - x];
  }
  return [bx + x * width, by + y * height];
}

function capturePointer(canvas: HTMLCanvasElement, event: PointerEvent): void {
  if (event.type === PointerPhase.Down && canvas.hasPointerCapture?.(event.pointerId) === false) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events have no active pointer. */
    }
  }
}

export function createPointerEvents(ctx: UiContext) {
  const { state, signal } = ctx;
  const disconnect = (): void => {
    state.events?.abort();
    signal?.removeEventListener("abort", disconnect);
    state.canvas = null;
  };
  const enqueue = (canvas: HTMLCanvasElement, event: PointerEvent, type: PointerPhase): void => {
    if (
      event.pointerType === "mouse" &&
      type === PointerPhase.Down &&
      event.button !== PRIMARY_BUTTON
    ) {
      return;
    }
    const point = windowPoint(ctx, canvas, event);
    if (!point) return;
    capturePointer(canvas, event);
    if (type === PointerPhase.Move && !event.buttons && event.pointerType === "mouse") return;
    if (state.ignoring && type === PointerPhase.Down) state.ignoredPointers.add(event.pointerId);
    if (state.ignoredPointers.has(event.pointerId)) {
      if (type !== PointerPhase.Move) state.ignoredPointers.delete(event.pointerId);
      event.preventDefault();
      return;
    }
    state.inputMetrics.receive();
    state.queue.push({
      id: event.pointerId,
      type,
      point,
      time: event.timeStamp / MILLISECONDS_PER_SECOND,
    });
    event.preventDefault();
  };
  const connect = (): void => {
    if (!state.window || state.canvas) return;
    const canvas = ctx.graphics().canvas;
    if (!("style" in canvas)) return;
    state.canvas = canvas;
    const events = new AbortController();
    state.events = events;
    canvas.style.touchAction = "none";
    for (const type of Object.values(PointerPhase)) {
      canvas.addEventListener(type, (event) => enqueue(canvas, event, type), {
        passive: false,
        signal: events.signal,
      });
    }
    signal?.addEventListener("abort", disconnect, { once: true });
  };
  return { connect, disconnect };
}
