import { callImplementation } from "../../objc/registrars";
import { TALL_SCREEN } from "../screen";
import { installCollections, createCollections } from "./collections";
import { createViewKit } from "./kit";
import { createGeometry } from "./geometry";
import { createHelpers } from "./helpers";
import { installImages } from "./images";
import { describeScene } from "./scene";
import { createServices, createTouchState, classPointer, NO_ARGUMENTS } from "./context";
import type { TouchBase, TouchContext, TouchParams, UiContext } from "./context";
import { installConversions } from "./conversions";
import {
  installApplicationMethods,
  installControllerViews,
  installResponders,
  installWindowControllers,
} from "./controllers";
import { createDispatcher } from "./dispatch";
import { installFieldWidgets } from "./fields";
import { installLayers } from "./layers";
import { createPointerEvents, createHitTest } from "./pointer-events";
import { installUiColors } from "./ui-colors";
import { createControlHost, createUiHost } from "./ui-host";
import { createLayout, createViewDeallocation, installViewMethods } from "./views";
import { installControlWidgets, installPrimaryWidgets } from "./widgets";
import { withAnimation } from "./animation-scope";

const BASE_CLASSES = [
  ["UIScreen", "NSObject"],
  ["UIView", "UIResponder"],
  ["UIWindow", "UIView"],
  ["UIViewController", "UIResponder"],
  ["UITouch", "NSObject"],
  ["UIEvent", "NSObject"],
  ["NSSet", "NSObject"],
  ["NSArray", "NSObject"],
  ["NSMutableArray", "NSArray"],
  ["NSMutableSet", "NSSet"],
] as const;

function createBase(params: TouchParams): TouchBase {
  return {
    ...params,
    phoneScreen: params.screen ?? TALL_SCREEN,
    glPresented: params.glPresented ?? (() => true),
    state: createTouchState(),
    services: createServices(),
  };
}

function createContext(base: TouchBase): TouchContext {
  const kit = createViewKit(base);
  const geo = createGeometry(base, kit);
  return { ...base, kit, geo, collections: createCollections(base) };
}

function createUiContext(ctx: TouchContext): UiContext {
  const helpers = createHelpers(ctx);
  const dealloc = ctx.lookup(classPointer(ctx.names, "NSObject"), "dealloc");
  const deallocObject = async (self: number): Promise<void> => {
    await callImplementation(dealloc, self, NO_ARGUMENTS);
  };
  const deallocateView = createViewDeallocation(ctx, deallocObject);
  return { ...ctx, helpers, deallocObject, deallocateView };
}

export interface TouchUIKit {
  readonly webViews: ReturnType<UiContext["services"]["webViews"]["get"]>;
  readonly drawableGeometry: TouchContext["geo"]["drawableGeometry"];
  readonly snapshot: () => unknown;
  readonly scene: (className: (pointer: number) => string) => ReturnType<typeof describeScene>;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly withAnimation: <T>(
    seconds: number,
    delay: number,
    options: number,
    changes: () => Promise<T>,
  ) => Promise<T>;
  readonly close: () => void;
  readonly pumpAlerts: () => Promise<void>;
  readonly hasAlerts: () => boolean;
  readonly pump: () => Promise<void>;
  readonly cancelTouches: () => Promise<void>;
  readonly hasWindow: () => boolean;
  readonly items: (pointer: number) => number[];
  readonly array: (items: number[], mutable?: boolean) => number;
}

export function touchUIKit(params: TouchParams): TouchUIKit {
  const base = createBase(params);
  for (const [name, parent] of BASE_CLASSES) base.hostClass(name, parent);
  const touch = createContext(base);
  installImages(touch);
  const ctx = createUiContext(touch);
  const { method, state, services, collections } = ctx;
  method("UIView", false, "dealloc", ctx.deallocateView);
  const uiHost = createUiHost(ctx);
  installPrimaryWidgets(ctx, uiHost);
  const controlHost = createControlHost(ctx, uiHost);
  installControlWidgets(ctx, uiHost, controlHost);
  installFieldWidgets(ctx, uiHost, controlHost);
  installLayers(ctx, uiHost);
  const layout = createLayout(ctx);
  installViewMethods(ctx, layout);
  installUiColors(ctx, uiHost);
  installApplicationMethods(ctx);
  installControllerViews(ctx);
  installWindowControllers(ctx);
  installResponders(ctx);
  installConversions(ctx);
  installCollections(ctx, collections);
  const { connect, disconnect } = createPointerEvents(ctx);
  const { pump, cancelTouches } = createDispatcher(ctx, createHitTest(ctx), layout);
  const scene = (className: (pointer: number) => string) => describeScene(ctx, className);
  return {
    webViews: services.webViews.get(),
    drawableGeometry: ctx.geo.drawableGeometry,
    snapshot: () => ({
      ...state.inputMetrics.snapshot(),
      queued: state.queue.length,
      coalesced: state.queue.coalesced,
      scene: scene(ctx.className),
    }),
    scene,
    connect,
    disconnect,
    withAnimation: (seconds, delay, options, changes) =>
      withAnimation(state, seconds, delay, options, changes),
    close: () => {
      disconnect();
      services.imageViews.get().close();
      services.textViews.get().close();
      services.pickerViews.get().close();
      services.scrollers.get().close();
      services.textFields.get().close();
      services.webViews.get().close();
      services.alerts.get().close();
    },
    pumpAlerts: () => services.alerts.get().pump(),
    hasAlerts: () => services.alerts.get().pending(),
    pump,
    cancelTouches,
    hasWindow: () => !!state.window,
    items: collections.items,
    array: (items, mutable) =>
      collections.collection(mutable ? "NSMutableArray" : "NSArray", items),
  };
}
