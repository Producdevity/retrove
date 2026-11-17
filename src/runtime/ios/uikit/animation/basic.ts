import { doubleBits, doubleFromBits, floatFromBits } from "../../abi/scalars";
import type { FoundationHost } from "../../objc/host";

const AnimationClass = {
  Base: "CAAnimation",
  Property: "CAPropertyAnimation",
  Basic: "CABasicAnimation",
} as const;
const LAYER_CLASS = "CALayer";
export const AnimationSymbols = {
  _kCAFillModeForwards: "forwards",
  _kCAFillModeBackwards: "backwards",
  _kCAFillModeBoth: "both",
  _kCAFillModeRemoved: "removed",
} as const;
const FILLS_FORWARD = new Set<string>([
  AnimationSymbols._kCAFillModeForwards,
  AnimationSymbols._kCAFillModeBoth,
]);
const DEFAULT_DURATION = 0.25;
const MILLISECONDS_PER_SECOND = 1000;
const AUTOREVERSE_FACTOR = 2;
const OPACITY_KEY_PATH = "opacity";
const DEFAULT_CURVE = "linear";
const ObjectValue = ["fromValue", "toValue", "byValue", "delegate"] as const;
type ObjectValue = (typeof ObjectValue)[number];
interface AnimationState {
  keyPath: string;
  duration: number;
  repeatCount: number;
  autoreverses: boolean;
  removedOnCompletion: boolean;
  fillMode: string;
  fromValue: number;
  toValue: number;
  byValue: number;
  delegate: number;
}
interface Running {
  readonly layer: number;
  readonly key: string;
  readonly animation: number;
  readonly deadline: number;
}
export interface LayerOpacity {
  alpha: number;
  opacityAnimation?: { duration: number; delay: number; curve: string; start: number };
}
interface BasicAnimationHost extends Pick<
  FoundationHost,
  | "hostClass"
  | "method"
  | "alloc"
  | "destroy"
  | "retain"
  | "release"
  | "autorelease"
  | "text"
  | "string"
> {
  send(receiver: number, selector: string, args?: number[]): Promise<number>;
  responds(receiver: number, selector: string): boolean;
  layer(pointer: number): LayerOpacity;
  now(): number;
}

const initial = (): AnimationState => ({
  keyPath: "",
  duration: DEFAULT_DURATION,
  repeatCount: 0,
  autoreverses: false,
  removedOnCompletion: true,
  fillMode: AnimationSymbols._kCAFillModeRemoved,
  fromValue: 0,
  toValue: 0,
  byValue: 0,
  delegate: 0,
});

export class BasicAnimations {
  readonly #states = new Map<number, AnimationState>();
  readonly #running: Running[] = [];
  constructor(readonly host: BasicAnimationHost) {}

  state(pointer: number): AnimationState {
    let state = this.#states.get(pointer);
    if (!state) this.#states.set(pointer, (state = initial()));
    return state;
  }

  async setObject(pointer: number, key: ObjectValue, value: number): Promise<void> {
    const state = this.state(pointer),
      old = state[key];
    state[key] = this.host.retain(value);
    await this.host.release(old);
  }

  async destroy(pointer: number): Promise<void> {
    const state = this.#states.get(pointer);
    this.#states.delete(pointer);
    if (state) for (const key of ObjectValue) await this.host.release(state[key]);
    this.host.destroy(pointer);
  }

  async add(layer: number, animation: number, key: string): Promise<void> {
    await this.remove(layer, key, false);
    const state = this.state(animation);
    const cycles = Math.max(1, state.repeatCount) * (state.autoreverses ? AUTOREVERSE_FACTOR : 1);
    const duration = state.duration * cycles;
    this.#running.push({
      layer: this.host.retain(layer),
      key,
      animation: this.host.retain(animation),
      deadline: this.host.now() + duration * MILLISECONDS_PER_SECOND,
    });
    if (state.keyPath === OPACITY_KEY_PATH) await this.#fade(layer, state, duration);
    if (state.delegate && this.host.responds(state.delegate, "animationDidStart:"))
      await this.host.send(state.delegate, "animationDidStart:", [animation]);
  }

  // The renderer only knows model values, so only an end state that stays visible is applied.
  async #fade(layer: number, state: AnimationState, duration: number): Promise<void> {
    if (state.removedOnCompletion || !FILLS_FORWARD.has(state.fillMode) || !state.toValue) return;
    const target = this.host.layer(layer);
    target.alpha = floatFromBits(await this.host.send(state.toValue, "floatValue"));
    target.opacityAnimation = { duration, delay: 0, curve: DEFAULT_CURVE, start: this.host.now() };
  }

  async remove(layer: number, key: string | undefined, finished: boolean): Promise<void> {
    for (const item of [...this.#running])
      if (item.layer === layer && (key === undefined || item.key === key))
        await this.#finish(item, finished);
  }

  find(layer: number, key: string): number {
    return this.#running.find((item) => item.layer === layer && item.key === key)?.animation ?? 0;
  }

  async pump(): Promise<void> {
    const now = this.host.now();
    for (const item of this.#running.filter((value) => value.deadline <= now))
      await this.#finish(item, true);
  }

  pending(): boolean {
    return this.#running.length > 0;
  }

  async #finish(item: Running, finished: boolean): Promise<void> {
    const index = this.#running.indexOf(item);
    if (index < 0) return;
    this.#running.splice(index, 1);
    try {
      const delegate = this.state(item.animation).delegate;
      if (delegate && this.host.responds(delegate, "animationDidStop:finished:"))
        await this.host.send(delegate, "animationDidStop:finished:", [
          item.animation,
          Number(finished),
        ]);
    } finally {
      await this.host.release(item.animation);
      await this.host.release(item.layer);
    }
  }
}

export function installBasicAnimations(host: BasicAnimationHost): BasicAnimations {
  host.hostClass(AnimationClass.Base, "NSObject");
  host.hostClass(AnimationClass.Property, AnimationClass.Base);
  host.hostClass(AnimationClass.Basic, AnimationClass.Property);
  const animations = new BasicAnimations(host);
  installFactories(host, animations);
  installTiming(host, animations);
  installValues(host, animations);
  installLayerAnimations(host, animations);
  return animations;
}

function installFactories(host: BasicAnimationHost, animations: BasicAnimations): void {
  host.method(AnimationClass.Base, true, "animation", (self) => host.autorelease(host.alloc(self)));
  host.method(AnimationClass.Property, true, "animationWithKeyPath:", (self, args) => {
    const pointer = host.alloc(self);
    animations.state(pointer).keyPath = args(0) ? host.text(args(0)) : "";
    return host.autorelease(pointer);
  });
  host.method(AnimationClass.Base, false, "dealloc", (self) => animations.destroy(self));
}

function installTiming(host: BasicAnimationHost, animations: BasicAnimations): void {
  host.method(AnimationClass.Base, false, "duration", (self) =>
    doubleBits(animations.state(self).duration),
  );
  host.method(AnimationClass.Base, false, "setDuration:", (self, args) => {
    const value = doubleFromBits(args(0), args(1));
    animations.state(self).duration =
      Number.isFinite(value) && value > 0 ? value : DEFAULT_DURATION;
  });
  host.method(AnimationClass.Base, false, "setRepeatCount:", (self, args) => {
    const value = floatFromBits(args(0));
    animations.state(self).repeatCount = Number.isFinite(value) && value > 0 ? value : 0;
  });
  host.method(AnimationClass.Base, false, "setAutoreverses:", (self, args) => {
    animations.state(self).autoreverses = Boolean(args(0));
  });
  host.method(AnimationClass.Base, false, "isRemovedOnCompletion", (self) =>
    Number(animations.state(self).removedOnCompletion),
  );
  host.method(AnimationClass.Base, false, "setRemovedOnCompletion:", (self, args) => {
    animations.state(self).removedOnCompletion = Boolean(args(0));
  });
  host.method(AnimationClass.Base, false, "setFillMode:", (self, args) => {
    animations.state(self).fillMode = args(0)
      ? host.text(args(0))
      : AnimationSymbols._kCAFillModeRemoved;
  });
  host.method(AnimationClass.Base, false, "setTimingFunction:", () => undefined);
}

function installValues(host: BasicAnimationHost, animations: BasicAnimations): void {
  host.method(AnimationClass.Property, false, "keyPath", (self) =>
    animations.state(self).keyPath ? host.string(animations.state(self).keyPath) : 0,
  );
  host.method(AnimationClass.Property, false, "setKeyPath:", (self, args) => {
    animations.state(self).keyPath = args(0) ? host.text(args(0)) : "";
  });
  for (const key of ObjectValue) {
    const name = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    host.method(AnimationClass.Base, false, key, (self) => animations.state(self)[key]);
    host.method(AnimationClass.Base, false, `set${name}:`, (self, args) =>
      animations.setObject(self, key, args(0)),
    );
  }
}

function installLayerAnimations(host: BasicAnimationHost, animations: BasicAnimations): void {
  host.method(LAYER_CLASS, false, "addAnimation:forKey:", (self, args) =>
    args(0) ? animations.add(self, args(0), args(1) ? host.text(args(1)) : "") : undefined,
  );
  host.method(LAYER_CLASS, false, "removeAnimationForKey:", (self, args) =>
    animations.remove(self, args(0) ? host.text(args(0)) : "", false),
  );
  host.method(LAYER_CLASS, false, "removeAllAnimations", (self) =>
    animations.remove(self, undefined, false),
  );
  host.method(LAYER_CLASS, false, "animationForKey:", (self, args) =>
    args(0) ? animations.find(self, host.text(args(0))) : 0,
  );
}
