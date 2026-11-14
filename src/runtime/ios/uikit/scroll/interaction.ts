import { GeometryField } from "../../abi/scalars";
import { Axis, ScrollTiming, type Point, type ScrollViews } from "./state";
const RUBBER_BAND = 0.35;
const VELOCITY_PROJECTION_MS = 180;
const MILLISECONDS_PER_SECOND = 1000;
const VELOCITY_STALE_SECONDS = 0.1;
interface Gesture {
  readonly view: number;
  readonly origin: Point;
  readonly offset: Point;
  last: Point;
  time: number;
  velocity: Point;
  intercepted: boolean;
  axis?: "x" | "y";
}
export class ScrollInteraction {
  private readonly gestures = new Map<number, Gesture>();
  constructor(private readonly views: ScrollViews) {}
  async begin(id: number, target: number, point: Point, time: number): Promise<boolean> {
    const view = this.views.nearest(target);
    if (!view || [...this.gestures.values()].some((item) => item.view === view)) return false;
    const state = this.views.get(view);
    if (!state.cancelTouches && this.views.host.isControl(target)) return false;
    this.views.host.retain(view);
    delete state.animation;
    delete state.velocity;
    if (state.decelerating) await this.views.notify(view, "scrollViewDidEndDecelerating:");
    state.decelerating = false;
    const local = this.views.host.local(view, point);
    this.gestures.set(id, {
      view,
      origin: local,
      offset: this.views.offset(view),
      last: local,
      time,
      velocity: [0, 0],
      intercepted: false,
    });
    return state.delayTouches && target !== view;
  }
  async move(id: number, point: Point, time: number): Promise<{ view: number; cancel: boolean }> {
    const gesture = this.gestures.get(id);
    if (!gesture) return { view: 0, cancel: false };
    const state = this.views.get(gesture.view),
      local = this.views.host.local(gesture.view, point);
    const [minimum, maximum] = this.views.range(gesture.view);
    const horizontal = maximum[Axis.X] > minimum[Axis.X] || state.horizontalBounce,
      vertical = maximum[Axis.Y] > minimum[Axis.Y] || state.verticalBounce;
    const dx = horizontal ? gesture.origin[Axis.X] - local[Axis.X] : 0,
      dy = vertical ? gesture.origin[Axis.Y] - local[Axis.Y] : 0;
    let cancel = false;
    if (!gesture.intercepted) {
      if (Math.hypot(dx, dy) < ScrollTiming.Threshold) return { view: 0, cancel: false };
      gesture.intercepted = true;
      state.dragging = true;
      cancel = true;
      if (state.directional) gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      await this.views.notify(gesture.view, "scrollViewWillBeginDragging:");
    }
    const wanted: Point = [
        gesture.offset[Axis.X] + (gesture.axis === "y" ? 0 : dx),
        gesture.offset[Axis.Y] + (gesture.axis === "x" ? 0 : dy),
      ],
      clamped = this.views.clamp(gesture.view, wanted);
    const target: Point = state.bounces
      ? [
          clamped[Axis.X] + (wanted[Axis.X] - clamped[Axis.X]) * RUBBER_BAND,
          clamped[Axis.Y] + (wanted[Axis.Y] - clamped[Axis.Y]) * RUBBER_BAND,
        ]
      : clamped;
    const elapsed = (time - gesture.time) * MILLISECONDS_PER_SECOND;
    if (elapsed > 0)
      gesture.velocity = [
        horizontal && gesture.axis !== "y" ? (gesture.last[Axis.X] - local[Axis.X]) / elapsed : 0,
        vertical && gesture.axis !== "x" ? (gesture.last[Axis.Y] - local[Axis.Y]) / elapsed : 0,
      ];
    gesture.last = local;
    gesture.time = time;
    await this.views.move(gesture.view, target);
    return { view: gesture.view, cancel };
  }
  async end(id: number, cancelled: boolean, time?: number): Promise<number> {
    const gesture = this.gestures.get(id);
    this.gestures.delete(id);
    if (!gesture) return 0;
    if (!gesture.intercepted) {
      await this.views.host.release(gesture.view);
      return 0;
    }
    if (time !== undefined && time - gesture.time > VELOCITY_STALE_SECONDS)
      gesture.velocity = [0, 0];
    const self = gesture.view,
      state = this.views.get(self),
      offset = this.views.offset(self);
    state.dragging = false;
    const [minimum, maximum] = this.views.range(self),
      bounds = this.views.host.view(self).bounds;
    let target = this.views.clamp(self, offset);
    if (state.paging && !cancelled)
      target = this.views.clamp(self, [
        Math.round(
          (offset[Axis.X] + gesture.velocity[Axis.X] * VELOCITY_PROJECTION_MS) /
            bounds[GeometryField.Width],
        ) * bounds[GeometryField.Width],
        Math.round(
          (offset[Axis.Y] + gesture.velocity[Axis.Y] * VELOCITY_PROJECTION_MS) /
            bounds[GeometryField.Height],
        ) * bounds[GeometryField.Height],
      ]);
    const settles = target[Axis.X] !== offset[Axis.X] || target[Axis.Y] !== offset[Axis.Y];
    const canCoast =
      !cancelled &&
      !state.paging &&
      !settles &&
      Math.hypot(...gesture.velocity) > ScrollTiming.MinimumVelocity &&
      (maximum[Axis.X] > minimum[Axis.X] || maximum[Axis.Y] > minimum[Axis.Y]);
    state.decelerating = settles || canCoast;
    await this.views.notify(self, "scrollViewDidEndDragging:willDecelerate:", [
      Number(state.decelerating),
    ]);
    if (settles)
      state.animation = {
        from: offset,
        to: target,
        start: this.views.host.now(),
        programmatic: false,
      };
    else if (canCoast) {
      state.velocity = [...gesture.velocity];
      await this.views.notify(self, "scrollViewWillBeginDecelerating:");
    }
    await this.views.host.release(self);
    return self;
  }
  active(id: number): boolean {
    return this.gestures.get(id)?.intercepted ?? false;
  }
  close(): void {
    this.gestures.clear();
  }
}
