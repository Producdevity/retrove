import { GeometryField } from "../../abi/scalars";
import type { UIKitHost, Rectangle, ViewState } from "../host";
export const SCROLL_CLASS = "UIScrollView";
export type Point = [number, number];
export type Insets = [number, number, number, number];
export const Axis = { X: 0, Y: 1 } as const;
export const Inset = { Top: 0, Left: 1, Bottom: 2, Right: 3 } as const;
const CUBIC_EASE = 3;
export const ScrollTiming = {
  Duration: 250,
  Delay: 150,
  Threshold: 5,
  MinimumVelocity: 0.02,
  NormalRate: 0.998,
} as const;
export interface ScrollState {
  size: Point;
  inset: Insets;
  delegate: number;
  enabled: boolean;
  scrollsToTop: boolean;
  paging: boolean;
  bounces: boolean;
  horizontalBounce: boolean;
  verticalBounce: boolean;
  directional: boolean;
  cancelTouches: boolean;
  delayTouches: boolean;
  horizontalIndicator: boolean;
  verticalIndicator: boolean;
  indicatorStyle: number;
  indicatorVisible: boolean;
  indicatorInsets: Insets;
  dragging: boolean;
  decelerating: boolean;
  rate: number;
  flashUntil: number;
  animation?: { from: Point; to: Point; start: number; programmatic: boolean };
  velocity?: Point;
}
export interface ScrollHost extends UIKitHost {
  view(pointer: number): ScrollViewState;
  isControl(pointer: number): boolean;
  parent(pointer: number): number;
  local(pointer: number, point: Point): Point;
  now(): number;
  boundsChanged(pointer: number): void;
}
export class ScrollViews {
  readonly states = new Map<number, ScrollState>();
  constructor(readonly host: ScrollHost) {}
  get(self: number): ScrollState {
    let value = this.states.get(self);
    if (!value) {
      value = {
        size: [0, 0],
        inset: [0, 0, 0, 0],
        delegate: 0,
        enabled: true,
        scrollsToTop: true,
        paging: false,
        bounces: true,
        horizontalBounce: false,
        verticalBounce: false,
        directional: false,
        cancelTouches: true,
        delayTouches: true,
        horizontalIndicator: true,
        verticalIndicator: true,
        indicatorStyle: 0,
        indicatorVisible: false,
        indicatorInsets: [0, 0, 0, 0],
        dragging: false,
        decelerating: false,
        rate: ScrollTiming.NormalRate,
        flashUntil: 0,
      };
      this.states.set(self, value);
      this.host.view(self).clipsToBounds = 1;
    }
    return value;
  }
  offset(self: number): Point {
    const value = this.host.view(self).bounds;
    return [value[Axis.X], value[Axis.Y]];
  }
  range(self: number): readonly [Point, Point] {
    const value = this.get(self),
      bounds = this.host.view(self).bounds;
    const minimum: Point = [-value.inset[Inset.Left], -value.inset[Inset.Top]];
    return [
      minimum,
      [
        Math.max(
          minimum[Axis.X],
          value.size[Axis.X] - bounds[GeometryField.Width] + value.inset[Inset.Right],
        ),
        Math.max(
          minimum[Axis.Y],
          value.size[Axis.Y] - bounds[GeometryField.Height] + value.inset[Inset.Bottom],
        ),
      ],
    ];
  }
  clamp(self: number, point: Point): Point {
    const [min, max] = this.range(self);
    return [
      Math.max(min[Axis.X], Math.min(max[Axis.X], point[Axis.X])),
      Math.max(min[Axis.Y], Math.min(max[Axis.Y], point[Axis.Y])),
    ];
  }
  async setOffset(self: number, point: Point, animated = false): Promise<void> {
    if (!point.every(Number.isFinite)) throw new Error("Invalid UIScrollView offset.");
    const state = this.get(self);
    delete state.velocity;
    if (animated) {
      state.animation = {
        from: this.offset(self),
        to: [...point],
        start: this.host.now(),
        programmatic: true,
      };
      return;
    }
    delete state.animation;
    await this.move(self, point);
  }
  async move(self: number, point: Point): Promise<void> {
    const view = this.host.view(self),
      bounds = view.bounds;
    if (bounds[Axis.X] === point[Axis.X] && bounds[Axis.Y] === point[Axis.Y]) return;
    bounds[Axis.X] = point[Axis.X];
    bounds[Axis.Y] = point[Axis.Y];
    view.needsLayout = view.needsDisplay = true;
    this.host.boundsChanged(self);
    await this.notify(self, "scrollViewDidScroll:");
  }
  async notify(self: number, selector: string, args: number[] = []): Promise<void> {
    const delegate = this.get(self).delegate;
    if (delegate) await this.host.send(delegate, selector, [self, ...args], true);
  }
  nearest(target: number): number {
    for (let current = target; current; current = this.host.parent(current)) {
      const state = this.states.get(current);
      if (!state?.enabled) continue;
      const [min, max] = this.range(current);
      if (
        max[Axis.X] > min[Axis.X] ||
        max[Axis.Y] > min[Axis.Y] ||
        state.horizontalBounce ||
        state.verticalBounce
      )
        return current;
    }
    return 0;
  }
  async pump(elapsed: number): Promise<void> {
    for (const [self, state] of this.states) {
      const visible = Boolean(
        state.dragging ||
        state.decelerating ||
        state.animation ||
        this.host.now() < state.flashUntil,
      );
      if (visible !== state.indicatorVisible) {
        state.indicatorVisible = visible;
        this.host.view(self).needsDisplay = true;
      }
      const animation = state.animation;
      if (animation) {
        const progress = Math.min(1, (this.host.now() - animation.start) / ScrollTiming.Duration),
          ease = 1 - Math.pow(1 - progress, CUBIC_EASE);
        await this.move(self, [
          animation.from[Axis.X] + (animation.to[Axis.X] - animation.from[Axis.X]) * ease,
          animation.from[Axis.Y] + (animation.to[Axis.Y] - animation.from[Axis.Y]) * ease,
        ]);
        if (progress === 1) {
          delete state.animation;
          if (animation.programmatic)
            await this.notify(self, "scrollViewDidEndScrollingAnimation:");
          else {
            state.decelerating = false;
            await this.notify(self, "scrollViewDidEndDecelerating:");
          }
        }
      } else if (state.velocity) {
        const factor = Math.pow(state.rate, elapsed),
          distance = (1 - factor) / -Math.log(state.rate),
          offset = this.offset(self);
        const next: Point = [
            offset[Axis.X] + state.velocity[Axis.X] * distance,
            offset[Axis.Y] + state.velocity[Axis.Y] * distance,
          ],
          clamped = this.clamp(self, next);
        await this.move(self, clamped);
        state.velocity = [state.velocity[Axis.X] * factor, state.velocity[Axis.Y] * factor];
        if (
          Math.hypot(...state.velocity) < ScrollTiming.MinimumVelocity ||
          next[Axis.X] !== clamped[Axis.X] ||
          next[Axis.Y] !== clamped[Axis.Y]
        ) {
          delete state.velocity;
          state.decelerating = false;
          await this.notify(self, "scrollViewDidEndDecelerating:");
        }
      }
    }
  }
  visible(self: number, rect: Rectangle): Point {
    const offset = this.offset(self),
      bounds = this.host.view(self).bounds;
    const axis = (start: number, length: number, position: number, viewport: number) =>
      start < position
        ? start
        : start + length > position + viewport
          ? start + length - viewport
          : position;
    return this.clamp(self, [
      axis(rect[0], rect[GeometryField.Width], offset[0], bounds[GeometryField.Width]),
      axis(rect[1], rect[GeometryField.Height], offset[1], bounds[GeometryField.Height]),
    ]);
  }
}
export interface ScrollViewState extends ViewState {
  clipsToBounds: number;
}
