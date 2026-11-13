import { Argument } from "../objc/host";
import { objectResult, type UIKitHost } from "./host";
import { ControlActions, ControlEvent, ControlState } from "./control-actions";

export const CONTROL_CLASS = "UIControl";
const MAX_ACTION_ARGUMENTS = 2;
export interface ControlHost extends UIKitHost {
  classNamed(name: string): number;
  selectorName(pointer: number): string;
  touchInside(touchSet: number, view: number): boolean;
}
interface State {
  readonly actions: ControlActions;
  enabled: boolean;
  highlighted: boolean;
  selected: boolean;
  tracking: boolean;
  inside: boolean;
  verticalAlignment: number;
  horizontalAlignment: number;
}
export class Controls {
  private readonly states = new Map<number, State>();
  constructor(private readonly host: ControlHost) {}
  get(self: number): State {
    let state = this.states.get(self);
    if (!state) {
      state = {
        actions: new ControlActions(),
        enabled: true,
        highlighted: false,
        selected: false,
        tracking: false,
        inside: false,
        verticalAlignment: 0,
        horizontalAlignment: 0,
      };
      this.states.set(self, state);
    }
    return state;
  }
  flags(self: number): number {
    const state = this.get(self);
    return (
      (state.highlighted ? ControlState.Highlighted : ControlState.Normal) |
      (!state.enabled ? ControlState.Disabled : ControlState.Normal) |
      (state.selected ? ControlState.Selected : ControlState.Normal)
    );
  }
  changed(self: number): void {
    const view = this.host.view(self);
    view.needsDisplay = true;
    view.needsLayout = true;
  }
  remove(self: number): void {
    this.states.delete(self);
  }
  private async receiver(self: number, selector: number): Promise<number> {
    const visited = new Set<number>();
    for (
      let current = self;
      current && !visited.has(current);
      current = objectResult(await this.host.send(current, "nextResponder", [], true))
    ) {
      visited.add(current);
      if (await this.host.send(current, "respondsToSelector:", [selector])) return current;
    }
    const application = objectResult(
      await this.host.send(this.host.classNamed("UIApplication"), "sharedApplication"),
    );
    if (application && (await this.host.send(application, "respondsToSelector:", [selector])))
      return application;
    const delegate = objectResult(await this.host.send(application, "delegate"));
    return delegate && (await this.host.send(delegate, "respondsToSelector:", [selector]))
      ? delegate
      : 0;
  }
  async action(self: number, selector: number, target: number, event: number): Promise<void> {
    const name = this.host.selectorName(selector);
    const count = name.split(":").length - 1;
    if (count > MAX_ACTION_ARGUMENTS) throw new Error("Invalid control action signature.");
    const receiver = target || (await this.receiver(self, selector));
    if (receiver) await this.host.send(receiver, name, [self, event].slice(0, count));
  }
  async dispatch(self: number, events: number, event = 0): Promise<void> {
    this.host.retain(self);
    try {
      await this.get(self).actions.dispatch(events, async (target, selector) => {
        await this.host.send(self, "sendAction:to:forEvent:", [selector, target, event]);
      });
    } finally {
      await this.host.release(self);
    }
  }
  async touch(
    self: number,
    kind: "begin" | "move" | "end" | "cancel",
    touches: number,
    event: number,
  ): Promise<void> {
    const state = this.get(self);
    if (!state.enabled || (kind !== "begin" && !state.tracking)) return;
    const inside = this.host.touchInside(touches, self),
      previous = state.inside;
    let events: number;
    switch (kind) {
      case "begin":
        state.tracking = true;
        events = ControlEvent.Down;
        break;
      case "move":
        events = inside ? ControlEvent.DragInside : ControlEvent.DragOutside;
        if (inside !== previous) events |= inside ? ControlEvent.DragEnter : ControlEvent.DragExit;
        break;
      case "end":
        state.tracking = false;
        events = inside ? ControlEvent.UpInside : ControlEvent.UpOutside;
        break;
      case "cancel":
        state.tracking = false;
        events = ControlEvent.Cancel;
        break;
    }
    state.inside = inside;
    state.highlighted = state.tracking && inside;
    this.changed(self);
    await this.dispatch(self, events, event);
  }
}
function properties(host: ControlHost, controls: Controls): void {
  for (const [getter, setter, field] of [
    ["isEnabled", "setEnabled:", "enabled"],
    ["isSelected", "setSelected:", "selected"],
    ["isHighlighted", "setHighlighted:", "highlighted"],
  ] as const) {
    host.method(CONTROL_CLASS, false, getter, (self) => Number(controls.get(self)[field]));
    host.method(CONTROL_CLASS, false, setter, (self, args) => {
      const state = controls.get(self);
      state[field] = Boolean(args(Argument.First));
      if (!state.enabled) {
        state.tracking = false;
        state.highlighted = false;
      }
      controls.changed(self);
    });
  }
  for (const [getter, setter, field] of [
    ["contentVerticalAlignment", "setContentVerticalAlignment:", "verticalAlignment"],
    ["contentHorizontalAlignment", "setContentHorizontalAlignment:", "horizontalAlignment"],
  ] as const) {
    host.method(CONTROL_CLASS, false, getter, (self) => controls.get(self)[field]);
    host.method(CONTROL_CLASS, false, setter, (self, args) => {
      controls.get(self)[field] = args(Argument.First);
      controls.changed(self);
    });
  }
}
export function installControls(host: ControlHost): Controls {
  host.hostClass(CONTROL_CLASS, "UIView");
  const controls = new Controls(host);
  properties(host, controls);
  host.method(CONTROL_CLASS, false, "state", (self) => controls.flags(self));
  host.method(CONTROL_CLASS, false, "isTracking", (self) => Number(controls.get(self).tracking));
  host.method(CONTROL_CLASS, false, "isTouchInside", (self) => Number(controls.get(self).inside));
  host.method(CONTROL_CLASS, false, "addTarget:action:forControlEvents:", (self, args) =>
    controls
      .get(self)
      .actions.add(args(Argument.First), args(Argument.Second), args(Argument.Third)),
  );
  host.method(CONTROL_CLASS, false, "removeTarget:action:forControlEvents:", (self, args) =>
    controls
      .get(self)
      .actions.remove(args(Argument.First), args(Argument.Second), args(Argument.Third)),
  );
  host.method(
    CONTROL_CLASS,
    false,
    "allControlEvents",
    (self) => controls.get(self).actions.events,
  );
  host.method(CONTROL_CLASS, false, "sendActionsForControlEvents:", (self, args) =>
    controls.dispatch(self, args(Argument.First)),
  );
  host.method(CONTROL_CLASS, false, "sendAction:to:forEvent:", (self, args) =>
    controls.action(self, args(Argument.First), args(Argument.Second), args(Argument.Third)),
  );
  host.method(CONTROL_CLASS, false, "dealloc", async (self) => {
    controls.remove(self);
    await host.deallocateView(self);
  });
  for (const [selector, kind] of [
    ["touchesBegan:withEvent:", "begin"],
    ["touchesMoved:withEvent:", "move"],
    ["touchesEnded:withEvent:", "end"],
    ["touchesCancelled:withEvent:", "cancel"],
  ] as const) {
    host.method(CONTROL_CLASS, false, selector, (self, args) =>
      controls.touch(self, kind, args(Argument.First), args(Argument.Second)),
    );
  }
  return controls;
}
