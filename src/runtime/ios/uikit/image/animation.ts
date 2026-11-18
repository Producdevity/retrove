import { doubleBits, doubleFromBits } from "../../abi/scalars";
import type { FoundationHost } from "../../objc/host";

const CLASS = "UIImageView";
/** UIKit plays animationImages at 30 frames per second unless a duration is set. */
const DEFAULT_FRAMES_PER_SECOND = 30;
const DEFAULT_FRAME_SECONDS = 1 / DEFAULT_FRAMES_PER_SECOND;
const MILLISECONDS_PER_SECOND = 1000;
interface Animation {
  array: number;
  frames: readonly number[];
  duration: number;
  repeatCount: number;
  started: number | undefined;
  shown: number;
}
interface AnimationHost extends Pick<FoundationHost, "method" | "retain" | "release"> {
  elements(array: number): readonly number[];
  now(): number;
  changed(view: number): void;
}

/** Frame index at `elapsed` seconds, or undefined once a finite repeat count has run out. */
export function animationFrame(
  count: number,
  duration: number,
  repeatCount: number,
  elapsed: number,
): number | undefined {
  if (!count || duration <= 0) return undefined;
  const cycles = elapsed / duration;
  if (repeatCount > 0 && cycles >= repeatCount) return undefined;
  return Math.min(count - 1, Math.floor((cycles % 1) * count));
}

/** UIImageView animationImages; the renderer asks `frame` which image to show. */
export class ImageViewAnimations {
  private readonly animations = new Map<number, Animation>();
  constructor(private readonly host: AnimationHost) {}
  private get(view: number): Animation {
    let animation = this.animations.get(view);
    if (!animation) {
      animation = {
        array: 0,
        frames: [],
        duration: 0,
        repeatCount: 0,
        started: undefined,
        shown: -1,
      };
      this.animations.set(view, animation);
    }
    return animation;
  }
  private duration(animation: Animation): number {
    return animation.duration || animation.frames.length * DEFAULT_FRAME_SECONDS;
  }
  /** The animation image to draw now, or 0 to draw the view's own image. */
  frame(view: number): number {
    const animation = this.animations.get(view);
    if (animation?.started === undefined) return 0;
    const elapsed = (this.host.now() - animation.started) / MILLISECONDS_PER_SECOND;
    const index = animationFrame(
      animation.frames.length,
      this.duration(animation),
      animation.repeatCount,
      elapsed,
    );
    if (index === undefined) animation.started = undefined;
    if ((index ?? -1) !== animation.shown) {
      animation.shown = index ?? -1;
      this.host.changed(view);
    }
    return index === undefined ? 0 : (animation.frames[index] ?? 0);
  }
  animating(): boolean {
    return [...this.animations.values()].some((animation) => animation.started !== undefined);
  }
  install(): void {
    const host = this.host;
    host.method(CLASS, false, "animationImages", (self) => this.animations.get(self)?.array ?? 0);
    host.method(CLASS, false, "setAnimationImages:", async (self, args) => {
      const animation = this.get(self),
        previous = animation.array,
        array = args(0);
      animation.array = array ? host.retain(array) : 0;
      animation.frames = array ? host.elements(array) : [];
      if (!array) animation.started = undefined;
      await host.release(previous);
      host.changed(self);
    });
    host.method(CLASS, false, "animationDuration", (self) =>
      doubleBits(this.animations.get(self)?.duration ?? 0),
    );
    host.method(CLASS, false, "setAnimationDuration:", (self, args) => {
      const value = doubleFromBits(args(0), args(1));
      this.get(self).duration = Number.isFinite(value) && value > 0 ? value : 0;
    });
    host.method(
      CLASS,
      false,
      "animationRepeatCount",
      (self) => this.animations.get(self)?.repeatCount ?? 0,
    );
    host.method(CLASS, false, "setAnimationRepeatCount:", (self, args) => {
      this.get(self).repeatCount = Math.max(0, args(0) | 0);
    });
    host.method(CLASS, false, "startAnimating", (self) => {
      const animation = this.get(self);
      if (animation.frames.length) animation.started = host.now();
    });
    host.method(CLASS, false, "stopAnimating", (self) => {
      const animation = this.animations.get(self);
      if (!animation) return;
      animation.started = undefined;
      animation.shown = -1;
      host.changed(self);
    });
    host.method(CLASS, false, "isAnimating", (self) =>
      Number(this.animations.get(self)?.started !== undefined),
    );
  }
}
