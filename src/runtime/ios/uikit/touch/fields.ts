import { installIndexPaths } from "../../foundation/index-paths";
import { installScrollViews } from "../scroll/bindings";
import { installTables } from "../table/bindings";
import { installTextFields } from "../text-field/bindings";
import { WebViews } from "../web-view";
import { callImplementation } from "../../objc/registrars";
import type { TouchControlHost, TouchUiHost } from "./ui-host";
import type { UiContext } from "./context";
import { classPointer, NO_ARGUMENTS } from "./context";
import { createFieldLayout } from "./field-layout";

const VIEW_CLASS = "UIView";
const SCROLL_CLASS = "UIScrollView";
const CONTROL_SELECTOR = "sendActionsForControlEvents:";

function installScrollers(ctx: UiContext, uiHost: TouchUiHost) {
  const { services, helpers, kit, geo, state, lookup, read } = ctx;
  const scrollers = installScrollViews({
    ...uiHost,
    parent: (pointer) => kit.data(pointer).parent,
    now: helpers.now,
    isControl: (pointer) => !!lookup(read(pointer), CONTROL_SELECTOR),
    local: (self, point) => {
      const value = geo.convertPoint(point, state.window, self);
      const [bx, by] = kit.data(self).bounds;
      return [value[0] - bx, value[1] - by];
    },
    boundsChanged: (self) => {
      const view = kit.data(self);
      if (!view.layer) return;
      kit.setFrame(view.layer, [...view.bounds]);
      kit.data(view.layer).bounds = [...view.bounds];
    },
  });
  services.scrollers.set(scrollers);
  return scrollers;
}

function installTableWidgets(
  ctx: UiContext,
  host: TouchControlHost,
  scrollers: ReturnType<typeof installScrollers>,
): void {
  const { services, helpers, kit, collections, lookup, names } = ctx;
  const images = services.imageViews.get();
  const indexPaths = installIndexPaths({
    hostClass: ctx.hostClass,
    method: ctx.method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    release: ctx.releaseFromHost,
    autorelease: ctx.autorelease,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
  });
  services.tables.set(
    installTables(
      {
        ...host,
        responds: helpers.responds,
        parent: (pointer) => kit.data(pointer).parent,
        children: (pointer) => kit.data(pointer).children,
        hasBackground: (pointer) => !!kit.data(pointer).backgroundColor,
        touchPoint: helpers.touchPoint,
        rgba: (color) => services.uiColors.peek()?.rgba(color),
        imageSize: (image) => images.size(image),
        viewImage: (pointer) => kit.data(pointer).image ?? 0,
        array: collections.array,
        screenSize: () => [ctx.phoneScreen.width, ctx.phoneScreen.height],
        decodeView: async (self, coder) => {
          const result = await callImplementation(
            lookup(classPointer(names, VIEW_CLASS), "initWithCoder:"),
            self,
            (index) => (index === 0 ? coder : 0),
          );
          return Number(result);
        },
      },
      indexPaths,
      scrollers.views,
    ),
  );
}

export function installFieldWidgets(
  ctx: UiContext,
  uiHost: TouchUiHost,
  host: TouchControlHost,
): void {
  const { services, mediaHost, lookup, names } = ctx;
  const layout = createFieldLayout(ctx);
  const labels = services.textViews.get();
  const controls = services.controls.get();
  services.webViews.set(
    new WebViews({
      hostClass: ctx.hostClass,
      method: ctx.method,
      ...(mediaHost ? { document: mediaHost.ownerDocument, mount: mediaHost } : {}),
      layout,
    }),
  );
  services.textFields.set(
    installTextFields({
      ...host,
      selector: ctx.selector,
      ...(mediaHost ? { mount: mediaHost } : {}),
      font: (pointer) => labels.font(pointer),
      layout,
      enabled: (pointer) => controls.get(pointer).enabled,
      dispatch: (pointer, events) => controls.dispatch(pointer, events),
    }),
  );
  const scrollers = installScrollers(ctx, uiHost);
  labels.installTextViews((self) =>
    callImplementation(lookup(classPointer(names, SCROLL_CLASS), "dealloc"), self, NO_ARGUMENTS),
  );
  installTableWidgets(ctx, host, scrollers);
}
