import { GeometryField } from "../../abi/scalars";
import { installControllerNibs } from "../nib/controllers";
import type { UiContext } from "./context";
import { classPointer } from "./context";
import { POINTER_PHASES } from "./phases";

const VIEW_CLASS = "UIView";
const WINDOW_CLASS = "UIWindow";
const APPLICATION_CLASS = "UIApplication";
const CONTROLLER_CLASS = "UIViewController";
const RESPONDER_CLASS = "UIResponder";

export function installApplicationMethods(ctx: UiContext): void {
  const { method, state, kit, collections, autorelease } = ctx;
  method(WINDOW_CLASS, false, "makeKeyAndVisible", (self) => {
    kit.key(self);
  });
  method(WINDOW_CLASS, false, "makeKeyWindow", (self) => {
    kit.key(self);
  });
  method(APPLICATION_CLASS, false, "beginIgnoringInteractionEvents", () => {
    state.ignoring++;
  });
  method(APPLICATION_CLASS, false, "endIgnoringInteractionEvents", () => {
    state.ignoring = Math.max(0, state.ignoring - 1);
  });
  method(APPLICATION_CLASS, false, "isIgnoringInteractionEvents", () => Number(state.ignoring > 0));
  method(APPLICATION_CLASS, false, "keyWindow", () => state.window);
  method(APPLICATION_CLASS, false, "windows", () =>
    autorelease(collections.collection("NSArray", state.window ? [state.window] : [])),
  );
}

export function installControllerViews(ctx: UiContext): void {
  const { method, state, kit, retain, releaseFromHost, send, alloc, names, autorelease } = ctx;
  const { data } = kit;
  const nibs = installControllerNibs({
    method,
    text: ctx.text,
    string: ctx.string,
    retain,
    send,
    release: releaseFromHost,
    load: (name, owner, bundle) => ctx.loadNib(name, owner, bundle),
  });
  ctx.services.controllerNibs.set(nibs);
  method(CONTROLLER_CLASS, false, "setView:", async (self, args) => {
    const view = args(0);
    const old = state.controllerViews.get(self);
    if (old === view) return;
    state.controllerViews.set(self, retain(view));
    if (view) data(view).controller = self;
    if (old) {
      data(old).controller = 0;
      await releaseFromHost(old);
    }
  });
  method(CONTROLLER_CLASS, false, "loadView", async (self) => {
    if (await nibs.load(self)) return;
    const view = kit.setFrame(alloc(classPointer(names, VIEW_CLASS)), kit.bounds());
    await send(self, "setView:", [autorelease(view)]);
  });
  method(CONTROLLER_CLASS, false, "viewDidLoad", () => undefined);
  method(CONTROLLER_CLASS, false, "dealloc", async (self) => {
    const view = state.controllerViews.get(self);
    state.controllerViews.delete(self);
    if (view) {
      data(view).controller = 0;
      await releaseFromHost(view);
    }
    await nibs.dispose(self);
    return ctx.deallocObject(self);
  });
  method(CONTROLLER_CLASS, false, "view", async (self) => {
    if (!state.controllerViews.get(self)) {
      await send(self, "loadView");
      await send(self, "viewDidLoad", [], true);
    } else if (nibs.owesViewDidLoad(self)) await send(self, "viewDidLoad", [], true);
    return state.controllerViews.get(self) ?? 0;
  });
}

export function installWindowControllers(ctx: UiContext): void {
  const { method, state, kit, retain, releaseFromHost, send } = ctx;
  const { data } = kit;
  method(WINDOW_CLASS, false, "setRootViewController:", async (self, args) => {
    const view = data(self);
    const controller = args(0);
    const previous = view.rootController;
    if (previous === controller) return;
    if (previous) {
      const old = state.controllerViews.get(previous);
      if (old && data(old).parent === self) {
        kit.detach(old);
        await releaseFromHost(old);
      }
      await releaseFromHost(previous);
    }
    view.rootController = retain(controller);
    if (!controller) return;
    const root = Number(await send(controller, "view"));
    if (!root) throw new Error("UIWindow root controller returned nil view");
    if (!data(root).bounds[GeometryField.Width]) {
      kit.setFrame(root, view.bounds[GeometryField.Width] ? view.bounds : kit.bounds());
    }
    kit.attach(self, root);
  });
  method(WINDOW_CLASS, false, "rootViewController", (self) => data(self).rootController ?? 0);
}

export function installResponders(ctx: UiContext): void {
  const { method, state, kit, send } = ctx;
  const { data } = kit;
  method(VIEW_CLASS, false, "nextResponder", (self) => data(self).controller || data(self).parent);
  method(CONTROLLER_CLASS, false, "nextResponder", (self) => {
    const view = state.controllerViews.get(self);
    return view === undefined ? 0 : data(view).parent;
  });
  for (const [, selector] of Object.values(POINTER_PHASES)) {
    method(RESPONDER_CLASS, false, selector, async (self, args) => {
      const next = await send(self, "nextResponder", [], true);
      if (next) await send(Number(next), selector, [args(0), args(1)], true);
    });
  }
}
