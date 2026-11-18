import type { FoundationHost } from "../../objc/host";

export const TransitionSymbols = {
  _kCATransitionFade: "fade",
  _kCATransitionMoveIn: "moveIn",
  _kCATransitionPush: "push",
  _kCATransitionReveal: "reveal",
  _kCATransitionFromRight: "fromRight",
  _kCATransitionFromLeft: "fromLeft",
  _kCATransitionFromTop: "fromTop",
  _kCATransitionFromBottom: "fromBottom",
  _kCAMediaTimingFunctionLinear: "linear",
  _kCAMediaTimingFunctionEaseIn: "easeIn",
  _kCAMediaTimingFunctionEaseOut: "easeOut",
  _kCAMediaTimingFunctionEaseInEaseOut: "easeInEaseOut",
  _kCAMediaTimingFunctionDefault: "default",
} as const;
const TRANSITION_CLASS = "CATransition";
const TIMING_CLASS = "CAMediaTimingFunction";
type TransitionHost = Pick<
  FoundationHost,
  | "hostClass"
  | "method"
  | "alloc"
  | "destroy"
  | "retain"
  | "release"
  | "autorelease"
  | "string"
  | "text"
>;

/**
 * CATransition and CAMediaTimingFunction objects. A transition added to a layer keeps
 * CAAnimation's timing and delegate callbacks; the visual effect is not drawn.
 */
export function installTransitions(host: TransitionHost): void {
  host.hostClass(TRANSITION_CLASS, "CAAnimation");
  host.hostClass(TIMING_CLASS, "NSObject");
  const fields = new Map<number, Map<string, string>>();
  const field = (self: number) => {
    let value = fields.get(self);
    if (!value) fields.set(self, (value = new Map<string, string>()));
    return value;
  };
  for (const [getter, setter, initial] of [
    ["type", "setType:", TransitionSymbols._kCATransitionFade],
    ["subtype", "setSubtype:", ""],
  ] as const) {
    host.method(TRANSITION_CLASS, false, getter, (self) => {
      const value = fields.get(self)?.get(getter) ?? initial;
      return value ? host.string(value) : 0;
    });
    host.method(TRANSITION_CLASS, false, setter, (self, args) => {
      if (args(0)) field(self).set(getter, host.text(args(0)));
      else field(self).delete(getter);
    });
  }
  const names = new Map<number, string>();
  host.method(TIMING_CLASS, true, "functionWithName:", (self, args) => {
    const pointer = host.alloc(self);
    names.set(
      pointer,
      args(0) ? host.text(args(0)) : TransitionSymbols._kCAMediaTimingFunctionDefault,
    );
    return host.autorelease(pointer);
  });
  host.method(TIMING_CLASS, false, "dealloc", (self) => {
    names.delete(self);
    host.destroy(self);
  });
}
