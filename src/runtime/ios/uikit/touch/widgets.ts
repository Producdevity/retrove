import { installActivityIndicators } from "../activity-indicator";
import { installAnimationGroups } from "../animation/groups";
import { installAlerts } from "../alerts/bindings";
import { installButtons } from "../button-host";
import { installControls } from "../control-host";
import { installLabels } from "../label-host";
import { installNavigation } from "../navigation/controller";
import { installPageControls } from "../page-control/bindings";
import { installPickers } from "../picker/bindings";
import { installSegmentedControls } from "../segmented-control/bindings";
import { installSwitches } from "../switch";
import { installToolbars } from "../toolbar/bindings";
import type { TouchControlHost, TouchUiHost } from "./ui-host";
import type { UiContext } from "./context";
import { classPointer, NO_ARGUMENTS } from "./context";
import { callImplementation } from "../../objc/registrars";

const VIEW_CLASS = "UIViewController";

export function installPrimaryWidgets(ctx: UiContext, uiHost: TouchUiHost): void {
  const { services, helpers, getCoreGraphics, phoneScreen } = ctx;
  services.animationGroups.set(
    installAnimationGroups({
      ...uiHost,
      thread: helpers.thread,
      now: helpers.now,
      selectorName: ctx.selectorName,
    }),
  );
  services.alerts.set(installAlerts({ ...uiHost, responds: helpers.responds }));
  services.textViews.set(
    installLabels(uiHost, (draw) => getCoreGraphics()?.drawCurrent(draw) ?? false),
  );
  services.pickerViews.set(
    installPickers({
      ...uiHost,
      screenWidth: () => phoneScreen.width,
      responds: helpers.responds,
      touchPoint: helpers.touchPoint,
    }),
  );
}

export function installControlWidgets(
  ctx: UiContext,
  uiHost: TouchUiHost,
  host: TouchControlHost,
): void {
  const { services, helpers, kit, collections, state } = ctx;
  const images = services.imageViews.get();
  const labels = services.textViews.get();
  const rgba = (color: number) => services.uiColors.peek()?.rgba(color);
  const controls = installControls(host);
  services.controls.set(controls);
  installButtons(
    {
      ...host,
      adjustImage: (pointer, brightness, opacity) => {
        kit.data(pointer).imageAdjustment = { brightness, opacity };
      },
      imageSize: (image) => images.size(image),
      labelSize: (label) => labels.size(label),
    },
    controls,
  );
  const toolbars = installToolbars({
    ...host,
    elements: collections.items,
    rgba,
    imageSize: (image) => images.size(image),
    drawImage: (...args) => {
      images.drawImage(...args);
    },
    touchPoint: helpers.touchPoint,
  });
  services.toolbars.set(toolbars);
  installNavigation({
    ...host,
    selector: ctx.selector,
    elements: collections.items,
    bars: toolbars,
    keyWindow: () => state.window,
    array: collections.array,
    deallocController: async (self) => {
      await callImplementation(
        ctx.lookup(classPointer(ctx.names, VIEW_CLASS), "dealloc"),
        self,
        NO_ARGUMENTS,
      );
    },
  });
  services.pageControls.set(
    installPageControls({ ...host, touchPoint: helpers.touchPoint }, controls),
  );
  installActivityIndicators(uiHost);
  services.segmentedControls.set(
    installSegmentedControls(
      {
        ...host,
        elements: collections.items,
        isString: (pointer) => !!ctx.lookup(ctx.read(pointer), "UTF8String"),
        rgba,
        imageSize: (image) => images.size(image),
        drawImage: (...args) => {
          images.drawImage(...args);
        },
        touchPoint: helpers.touchPoint,
      },
      controls,
    ),
  );
  services.switches.set(installSwitches({ ...host, rgba }, controls));
}
