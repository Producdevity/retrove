import { Argument } from "../objc/host";
import type { UIKitHost } from "./host";

const CLASS = "UIActivityIndicatorView";
/** UIActivityIndicatorViewStyle: WhiteLarge is 37 points, the others 20. */
const LARGE_STYLE = 0;
const Size = { Large: 37, Small: 20 } as const;
interface State {
  style: number;
  animating: boolean;
  hidesWhenStopped: boolean;
  color: number;
}

/** The activity indicator's state; it hides itself when stopped, as UIKit does by default. */
export function installActivityIndicators(host: UIKitHost): void {
  host.hostClass(CLASS, "UIView");
  const states = new Map<number, State>();
  const get = (self: number): State => {
    let state = states.get(self);
    if (!state) {
      state = { style: 2, animating: false, hidesWhenStopped: true, color: 0 };
      states.set(self, state);
    }
    return state;
  };
  const sync = async (self: number): Promise<void> => {
    const state = get(self);
    await host.send(self, "setHidden:", [Number(state.hidesWhenStopped && !state.animating)]);
  };
  host.method(CLASS, false, "initWithActivityIndicatorStyle:", async (self, args) => {
    const state = get(self);
    state.style = args(Argument.First);
    const side = state.style === LARGE_STYLE ? Size.Large : Size.Small;
    host.setFrame(self, [0, 0, side, side]);
    await sync(self);
    return self;
  });
  host.method(CLASS, false, "startAnimating", async (self) => {
    get(self).animating = true;
    await sync(self);
  });
  host.method(CLASS, false, "stopAnimating", async (self) => {
    get(self).animating = false;
    await sync(self);
  });
  host.method(CLASS, false, "isAnimating", (self) => Number(get(self).animating));
  host.method(CLASS, false, "hidesWhenStopped", (self) => Number(get(self).hidesWhenStopped));
  host.method(CLASS, false, "setHidesWhenStopped:", async (self, args) => {
    get(self).hidesWhenStopped = Boolean(args(Argument.First));
    await sync(self);
  });
  host.method(CLASS, false, "activityIndicatorViewStyle", (self) => get(self).style);
  host.method(CLASS, false, "setActivityIndicatorViewStyle:", (self, args) => {
    get(self).style = args(Argument.First);
  });
  host.method(CLASS, false, "color", (self) => get(self).color);
  host.method(CLASS, false, "setColor:", async (self, args) => {
    const state = get(self),
      old = state.color;
    state.color = args(Argument.First) ? host.retain(args(Argument.First)) : 0;
    if (old) await host.release(old);
  });
  host.method(CLASS, false, "dealloc", async (self) => {
    const color = states.get(self)?.color;
    states.delete(self);
    if (color) await host.release(color);
    await host.deallocateView(self);
  });
}
