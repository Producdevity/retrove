import { floatBits, floatFromBits, GeometryField } from "../../abi/scalars";
import { installViewOrdering } from "../view/hierarchy";
import { installTouchViewProperties } from "./view-policy";
import type { TouchContext, UiContext } from "./context";
import { classPointer } from "./context";
import { readRectangle } from "./geometry";
import { rectangleMethod } from "./helpers";
import { installCenter, installScalarProperties, installTransformMethods } from "./view-properties";
import { applyAnimation, type Rect, type ViewData } from "./view-data";

const VIEW_CLASS = "UIView";
const WINDOW_CLASS = "UIWindow";
const LAYER_CLASS = "CALayer";
const SCREEN_CLASS = "UIScreen";
const NEEDS_DISPLAY_SELECTORS = ["setNeedsDisplay", "setNeedsDisplayInRect:"];
const ADJUSTMENT_CENTER = 2;

export function createLayout(ctx: UiContext): (view: number) => Promise<void> {
  const { kit, send } = ctx;
  const layout = async (view: number): Promise<void> => {
    const data = kit.data(view);
    if (data.needsLayout) {
      data.needsLayout = false;
      if (data.controller) await send(data.controller, "viewWillLayoutSubviews", [], true);
      await send(view, "layoutSubviews");
      if (data.controller) await send(data.controller, "viewDidLayoutSubviews", [], true);
    }
    for (const child of [...data.children]) {
      if (kit.data(child).parent === view) await layout(child);
    }
  };
  return layout;
}

function withLayoutAnimation(ctx: UiContext, view: ViewData): void {
  applyAnimation(
    view,
    "layoutAnimation",
    ctx.state.animation ?? ctx.services.animationGroups.get().context(),
  );
}

export function installScreens(ctx: UiContext): void {
  const { method, state, alloc, names, autorelease, phoneScreen, collections } = ctx;
  const screenObject = (): number => {
    state.screen ||= alloc(classPointer(names, SCREEN_CLASS));
    return state.screen;
  };
  method(SCREEN_CLASS, true, "mainScreen", screenObject);
  method(SCREEN_CLASS, true, "screens", () =>
    autorelease(collections.collection("NSArray", [screenObject()])),
  );
  const portraitBounds = (): Rect => [0, 0, phoneScreen.width, phoneScreen.height];
  rectangleMethod(ctx, SCREEN_CLASS, "bounds", portraitBounds);
  rectangleMethod(ctx, SCREEN_CLASS, "applicationFrame", portraitBounds);
  method(SCREEN_CLASS, false, "scale", () => floatBits(phoneScreen.scale));
  method(WINDOW_CLASS, false, "setScreen:", (self, args) => {
    ctx.kit.data(self).screen = args(0);
  });
  method(WINDOW_CLASS, false, "screen", (self) => ctx.kit.data(self).screen ?? screenObject());
}

export function installFrameMethods(ctx: UiContext, layout: (view: number) => Promise<void>): void {
  const { method, kit, geo } = ctx;
  const { data, setFrame } = kit;
  method(VIEW_CLASS, false, "initWithFrame:", (self, args) => setFrame(self, readRectangle(args)));
  method(VIEW_CLASS, false, "setFrame:", (self, args) => {
    setFrame(self, readRectangle(args));
  });
  method(VIEW_CLASS, false, "setBounds:", (self, args) => {
    const view = data(self);
    const bounds = readRectangle(args);
    const [x, y, width, height] = view.frame;
    withLayoutAnimation(ctx, view);
    view.bounds = bounds;
    view.needsDisplay = true;
    view.needsLayout = true;
    view.frame = [
      x + (width - bounds[GeometryField.Width]) / ADJUSTMENT_CENTER,
      y + (height - bounds[GeometryField.Height]) / ADJUSTMENT_CENTER,
      bounds[GeometryField.Width],
      bounds[GeometryField.Height],
    ];
  });
  method(VIEW_CLASS, false, "layoutSubviews", () => undefined);
  method(VIEW_CLASS, false, "setNeedsLayout", (self) => {
    data(self).needsLayout = true;
  });
  method(VIEW_CLASS, false, "layoutIfNeeded", (self) => layout(self));
  for (const selector of NEEDS_DISPLAY_SELECTORS) {
    method(VIEW_CLASS, false, selector, (self) => {
      data(self).needsDisplay = true;
    });
  }
  rectangleMethod(ctx, VIEW_CLASS, "frame", (self) => {
    const view = data(self);
    const [x, y, width, height] = view.bounds;
    const corners = [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x + width, y + height],
    ] as const;
    const mapped = corners.map((corner) => geo.toParent(view, [...corner]));
    const xs = mapped.map((point) => point[0]);
    const ys = mapped.map((point) => point[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
  });
  rectangleMethod(ctx, VIEW_CLASS, "bounds", (self) => data(self).bounds);
}

export function installHierarchyMethods(ctx: UiContext): void {
  const { method, kit, state, releaseFromHost, collections, autorelease } = ctx;
  const { data } = kit;
  method(VIEW_CLASS, false, "addSubview:", (self, args) => {
    kit.attach(self, args(0));
  });
  method(VIEW_CLASS, false, "removeFromSuperview", async (self) => {
    if (data(self).parent) {
      kit.detach(self);
      await releaseFromHost(self);
    }
  });
  method(VIEW_CLASS, false, "superview", (self) => data(self).parent);
  method(VIEW_CLASS, false, "window", (self) => {
    let view = self;
    while (data(view).parent) view = data(view).parent;
    return view === state.window ? view : 0;
  });
  method(VIEW_CLASS, false, "subviews", (self) =>
    autorelease(collections.collection("NSArray", data(self).children)),
  );
  installViewOrdering({ method, children: (pointer) => data(pointer).children });
  method(VIEW_CLASS, false, "viewWithTag:", (self, args) => {
    const target = args(0);
    const walk = (pointer: number): number => {
      if (data(pointer).tag === target) return pointer;
      for (const child of data(pointer).children) {
        const found = walk(child);
        if (found) return found;
      }
      return 0;
    };
    return walk(self);
  });
}

export function installVisibilityMethods(ctx: UiContext): void {
  const { method, kit } = ctx;
  const { data } = kit;
  method(VIEW_CLASS, false, "setHidden:", (self, args) => {
    data(self).hidden = !!args(0);
  });
  method(VIEW_CLASS, false, "isHidden", (self) => Number(data(self).hidden));
  method(VIEW_CLASS, false, "setAlpha:", (self, args) => {
    const view = data(self);
    view.alpha = floatFromBits(args(0));
    applyAnimation(
      view,
      "opacityAnimation",
      ctx.state.animation ?? ctx.services.animationGroups.get().context(),
    );
  });
  method(VIEW_CLASS, false, "alpha", (self) => floatBits(data(self).alpha));
  installTouchViewProperties({ method, state: data });
  method(VIEW_CLASS, true, "layerClass", () => classPointer(ctx.names, LAYER_CLASS));
  method(VIEW_CLASS, false, "layer", async (self) => {
    const view = data(self);
    if (!view.layer) {
      const { send, read } = ctx;
      const layerClass = Number(await send(read(self), "layerClass"));
      const allocated = Number(await send(layerClass, "alloc"));
      view.layer = Number(await send(allocated, "init"));
      kit.setFrame(view.layer, [...view.bounds]);
      data(view.layer).parent = self;
      data(view.layer).backingView = self;
    }
    return view.layer;
  });
}

export function installViewMethods(ctx: UiContext, layout: (view: number) => Promise<void>): void {
  installScreens(ctx);
  installFrameMethods(ctx, layout);
  installHierarchyMethods(ctx);
  installVisibilityMethods(ctx);
  installScalarProperties(ctx);
  installCenter(ctx);
  installTransformMethods(ctx);
}

export function createViewDeallocation(
  ctx: TouchContext,
  deallocObject: (self: number) => Promise<void>,
): (self: number) => Promise<void> {
  const { state, kit, services, releaseFromHost } = ctx;
  return async (self) => {
    const view = state.views.get(self);
    if (view) {
      if (state.window === self) state.window = 0;
      if (view.parent) kit.detach(self);
      for (const child of view.children) kit.data(child).parent = 0;
      const owned = [
        ...view.children,
        view.image,
        view.highlightedImage,
        view.backgroundColor,
        view.layer,
        view.rootController,
      ];
      for (const pointer of owned) {
        if (pointer) await releaseFromHost(pointer);
      }
      state.views.delete(self);
    }
    services.imageViews.get().removeView(self);
    services.webViews.get().remove(self);
    await deallocObject(self);
  };
}
