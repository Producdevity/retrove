import { installBasicAnimations } from "../animation/basic";
import { installTransactions } from "../animation/transactions";
import { installTransitions } from "../animation/transitions";
import { installLayerColors } from "../layer-colors";
import { installLayerProperties } from "../layer-properties";
import { installLayerFactory, installLayerTree } from "../layer";
import type { TouchUiHost } from "./ui-host";
import type { UiContext } from "./context";
import { requireCoreGraphics } from "./helpers";
import { applyAnimation } from "./view-data";

const LAYER_CLASS = "CALayer";

export function installLayers(ctx: UiContext, uiHost: TouchUiHost): void {
  const { services, helpers, kit, collections, getCoreGraphics } = ctx;
  const { data } = kit;
  const transactions = installTransactions({ ...uiHost, thread: helpers.thread, now: helpers.now });
  services.transactions.set(transactions);
  const layerGeometry = (self: number) => data(data(self).backingView || self);
  installLayerProperties({
    ...uiHost,
    geometry: layerGeometry,
    changed: (self, opacity) => {
      applyAnimation(
        layerGeometry(self),
        opacity ? "opacityAnimation" : "layoutAnimation",
        transactions.context(),
      );
    },
    pixels: (pointer) => getCoreGraphics()?.pixels(pointer),
    retainImage: (pointer) => {
      requireCoreGraphics(ctx).retain(pointer);
    },
    releaseImage: async (pointer) => {
      await requireCoreGraphics(ctx).release(pointer);
    },
  });
  services.basicAnimations.set(
    installBasicAnimations({
      ...uiHost,
      send: async (receiver, selector, args) => Number(await ctx.send(receiver, selector, args)),
      responds: helpers.responds,
      layer: layerGeometry,
      now: helpers.now,
    }),
  );
  installTransitions(uiHost);
  installLayerColors({
    ...uiHost,
    rgba: (pointer) => getCoreGraphics()?.colors.rgba(pointer),
    retainColor: (pointer) => requireCoreGraphics(ctx).retain(pointer),
    releaseColor: async (pointer) => {
      await requireCoreGraphics(ctx).release(pointer);
    },
  });
  installLayerFactory({
    ...uiHost,
    view: layerGeometry,
    setFrame: (self, rect) => {
      kit.setFrame(data(self).backingView || self, rect);
      applyAnimation(layerGeometry(self), "layoutAnimation", transactions.context());
      return self;
    },
  });
  installLayerTree({
    ...uiHost,
    children: (pointer) => data(pointer).children,
    parent: (pointer) => data(pointer).parent,
    attach: kit.attach,
    detach: kit.detach,
    array: collections.array,
  });
  installLayerDealloc(ctx);
}

function installLayerDealloc(ctx: UiContext): void {
  const { state, kit, releaseFromHost, getCoreGraphics } = ctx;
  ctx.method(LAYER_CLASS, false, "dealloc", async (self) => {
    const view = state.views.get(self);
    if (view) {
      if (view.parent) kit.detach(self);
      for (const child of view.children) {
        kit.data(child).parent = 0;
        await releaseFromHost(child);
      }
      if (view.contents) await getCoreGraphics()?.release(view.contents);
      if (view.borderColor) await requireCoreGraphics(ctx).release(view.borderColor);
      if (view.layerBackgroundColor) {
        await requireCoreGraphics(ctx).release(view.layerBackgroundColor);
      }
      if (view.drawableProperties) await releaseFromHost(view.drawableProperties);
      state.views.delete(self);
    }
    await ctx.deallocObject(self);
  });
}
