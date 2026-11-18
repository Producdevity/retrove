import { Argument } from "../../objc/host";
import { WORD_BYTES, floatBits } from "../../abi/scalars";
import { objectResult, structureMethod } from "../host";
import { installBarItems } from "./bar-items";
import { BarStyle, ToolbarMetric, type BarItemState } from "./model";
import { ToolbarViews, type ToolbarHost } from "./toolbar-views";

export type { ToolbarHost } from "./toolbar-views";
const TOOLBAR_CLASS = "UIToolbar";
const MAX_ACTION_ARGUMENTS = 1;
export interface Toolbars {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): void;
  /** Gives another bar class the toolbar's style, layout, touches and drawing. */
  adopt(className: string, release?: (self: number) => Promise<void>): void;
  /** Replaces a bar's UIBarButtonItems from host code. */
  setItems(self: number, array: number): Promise<void>;
}

/** Sends the item's action to its target, or up the toolbar's responder chain. */
async function sendAction(
  host: ToolbarHost,
  toolbar: number,
  item: number,
  state: BarItemState,
): Promise<void> {
  const name = host.selectorName(state.action),
    count = Math.min(MAX_ACTION_ARGUMENTS, name.split(":").length - 1),
    visited = new Set<number>();
  let receiver = state.target;
  for (
    let current = toolbar;
    !receiver && current && !visited.has(current);
    current = objectResult(await host.send(current, "nextResponder", [], true))
  ) {
    visited.add(current);
    if (await host.send(current, "respondsToSelector:", [state.action])) receiver = current;
  }
  if (receiver) await host.send(receiver, name, [item].slice(0, count));
}
async function setItems(
  host: ToolbarHost,
  views: ToolbarViews,
  self: number,
  array: number,
): Promise<void> {
  const state = views.get(self),
    old = state.items,
    previous = views.elements(self),
    next = array ? host.elements(array) : [];
  for (const pointer of previous) {
    const custom = views.item(pointer)?.customView;
    if (custom && !next.includes(pointer)) await host.send(custom, "removeFromSuperview");
  }
  state.items = array ? host.retain(array) : 0;
  for (const pointer of next) {
    const custom = views.item(pointer)?.customView;
    if (custom) await host.send(self, "addSubview:", [custom]);
  }
  if (old) await host.release(old);
  views.layout(self);
  views.changed(self);
}
function properties(host: ToolbarHost, views: ToolbarViews, className: string): void {
  host.method(className, false, "barStyle", (self) => views.get(self).style);
  host.method(className, false, "setBarStyle:", (self, args) => {
    views.get(self).style = args(Argument.First);
    views.changed(self);
  });
  host.method(className, false, "tintColor", (self) => views.get(self).tint);
  host.method(className, false, "setTintColor:", async (self, args) => {
    const state = views.get(self),
      old = state.tint,
      color = args(Argument.First);
    state.tint = color ? host.retain(color) : 0;
    if (old) await host.release(old);
    views.changed(self);
  });
  host.method(className, false, "isTranslucent", (self) =>
    Number(views.get(self).style === BarStyle.BlackTranslucent),
  );
  host.method(className, false, "layoutSubviews", (self) => views.layout(self));
  host.method(className, false, "sizeToFit", (self) => {
    const [x, y, width] = host.view(self).frame;
    host.setFrame(self, [x, y, width, ToolbarMetric.Height]);
    views.layout(self);
    views.changed(self);
  });
  host.structure(
    className,
    false,
    "sizeThatFits:",
    structureMethod((_self, args, destination) => {
      host.write(destination, args(Argument.First));
      host.write(destination + WORD_BYTES, floatBits(ToolbarMetric.Height));
    }),
  );
}
function touches(host: ToolbarHost, views: ToolbarViews, className: string): void {
  host.method(className, false, "touchesBegan:withEvent:", (self, args) => {
    views.get(self).pressed = views.hit(self, args(Argument.First));
    views.changed(self);
  });
  host.method(className, false, "touchesMoved:withEvent:", (self, args) => {
    const state = views.get(self),
      over = views.hit(self, args(Argument.First));
    if (over !== state.pressed) {
      state.pressed = 0;
      views.changed(self);
    }
  });
  host.method(className, false, "touchesCancelled:withEvent:", (self) => {
    views.get(self).pressed = 0;
    views.changed(self);
  });
  host.method(className, false, "touchesEnded:withEvent:", async (self, args) => {
    const state = views.get(self),
      pressed = state.pressed,
      released = views.hit(self, args(Argument.First)),
      item = views.item(released);
    state.pressed = 0;
    views.changed(self);
    if (pressed && released === pressed && item?.action)
      await sendAction(host, self, released, item);
  });
}
/** UIToolbar with UIBarButtonItems: drawn bar and buttons, custom views as subviews. */
export function installToolbars(host: ToolbarHost): Toolbars {
  host.hostClass(TOOLBAR_CLASS, "UIView");
  let views: ToolbarViews | undefined;
  const items = installBarItems(host, (item) => views?.itemChanged(item));
  const toolbars = new ToolbarViews(host, items);
  views = toolbars;
  host.method(TOOLBAR_CLASS, false, "items", (self) => toolbars.get(self).items);
  for (const selector of ["setItems:", "setItems:animated:"])
    host.method(TOOLBAR_CLASS, false, selector, (self, args) =>
      setItems(host, toolbars, self, args(Argument.First)),
    );
  const adopt = (className: string, release?: (self: number) => Promise<void>) => {
    properties(host, toolbars, className);
    touches(host, toolbars, className);
    host.method(className, false, "dealloc", async (self) => {
      await release?.(self);
      const state = toolbars.states.get(self);
      toolbars.states.delete(self);
      if (state?.items) await host.release(state.items);
      if (state?.tint) await host.release(state.tint);
      await host.deallocateView(self);
    });
  };
  adopt(TOOLBAR_CLASS);
  return {
    has: (pointer) => toolbars.states.has(pointer),
    draw: (pointer, context) => toolbars.draw(pointer, context),
    adopt,
    setItems: (self, array) => setItems(host, toolbars, self, array),
  };
}
