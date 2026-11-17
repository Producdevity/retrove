import { floatBits, floatFromBits } from "../../abi/scalars";
import { Argument, type HostMethod } from "../../objc/host";
import type { UIKitHost } from "../host";
import { barItemState, type BarItemState } from "./model";

export const BAR_ITEM_CLASS = "UIBarItem";
export const BAR_BUTTON_ITEM_CLASS = "UIBarButtonItem";
const ItemArgument = { Fourth: 3 } as const;

export interface BarItems {
  get(pointer: number): BarItemState | undefined;
}
type Retained = "title" | "image" | "customView";

function properties(
  get: (self: number) => BarItemState,
  replace: (self: number, field: Retained, value: number) => Promise<void>,
  method: (selector: string, implementation: HostMethod) => void,
  changed: (item: number) => void,
): void {
  for (const [getter, setter, field] of [
    ["title", "setTitle:", "title"],
    ["image", "setImage:", "image"],
    ["customView", "setCustomView:", "customView"],
  ] as const) {
    method(getter, (self) => get(self)[field]);
    method(setter, (self, args) => replace(self, field, args(Argument.First)));
  }
  for (const [getter, setter, field] of [
    ["style", "setStyle:", "style"],
    ["target", "setTarget:", "target"],
    ["action", "setAction:", "action"],
    ["tag", "setTag:", "tag"],
  ] as const) {
    method(getter, (self) => get(self)[field]);
    method(setter, (self, args) => {
      get(self)[field] = args(Argument.First);
      changed(self);
    });
  }
  method("isEnabled", (self) => Number(get(self).enabled));
  method("setEnabled:", (self, args) => {
    get(self).enabled = Boolean(args(Argument.First));
    changed(self);
  });
  method("width", (self) => floatBits(get(self).width));
  method("setWidth:", (self, args) => {
    get(self).width = Math.max(0, floatFromBits(args(Argument.First)) || 0);
    changed(self);
  });
}
/** UIBarButtonItem state; `changed` redraws the toolbars that show the item. */
export function installBarItems(host: UIKitHost, changed: (item: number) => void): BarItems {
  host.hostClass(BAR_ITEM_CLASS, "NSObject");
  host.hostClass(BAR_BUTTON_ITEM_CLASS, BAR_ITEM_CLASS);
  const states = new Map<number, BarItemState>();
  const get = (self: number): BarItemState => {
    let state = states.get(self);
    if (!state) {
      state = barItemState();
      states.set(self, state);
    }
    return state;
  };
  const replace = async (self: number, field: Retained, value: number): Promise<void> => {
    const state = get(self),
      old = state[field];
    state[field] = value ? host.retain(value) : 0;
    if (old) await host.release(old);
    changed(self);
  };
  const method = (selector: string, implementation: HostMethod): void =>
    host.method(BAR_BUTTON_ITEM_CLASS, false, selector, implementation);
  method("init", (self) => {
    get(self);
    return self;
  });
  method("initWithBarButtonSystemItem:target:action:", (self, args) => {
    Object.assign(get(self), {
      system: args(Argument.First),
      target: args(Argument.Second),
      action: args(Argument.Third),
    });
    return self;
  });
  for (const [selector, field] of [
    ["initWithTitle:style:target:action:", "title"],
    ["initWithImage:style:target:action:", "image"],
  ] as const) {
    method(selector, async (self, args) => {
      await replace(self, field, args(Argument.First));
      Object.assign(get(self), {
        style: args(Argument.Second),
        target: args(Argument.Third),
        action: args(ItemArgument.Fourth),
      });
      return self;
    });
  }
  method("initWithCustomView:", async (self, args) => {
    await replace(self, "customView", args(Argument.First));
    return self;
  });
  properties(get, replace, method, changed);
  method("dealloc", async (self) => {
    const state = states.get(self);
    states.delete(self);
    for (const owned of [state?.title, state?.image, state?.customView])
      if (owned) await host.release(owned);
    host.destroy(self);
  });
  return { get: (pointer) => states.get(pointer) };
}
