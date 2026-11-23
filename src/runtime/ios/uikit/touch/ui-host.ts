import type { UIKitHost } from "../host";
import type { ViewData } from "./view-data";
import type { UiContext } from "./context";
import { classPointer } from "./context";
import type { ControlHost } from "../control-host";

export interface TouchUiHost extends UIKitHost {
  view: (pointer: number) => ViewData;
}

export function createUiHost(ctx: UiContext): TouchUiHost {
  const { mediaHost } = ctx;
  return {
    hostClass: ctx.hostClass,
    method: ctx.method,
    structure: ctx.method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain: ctx.retain,
    release: ctx.releaseFromHost,
    send: ctx.send,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    read: ctx.read,
    ipa: ctx.ipa,
    view: ctx.kit.data,
    setFrame: ctx.kit.setFrame,
    deallocateView: ctx.deallocateView,
    ...(mediaHost ? { document: mediaHost.ownerDocument } : {}),
  };
}

export type TouchControlHost = ControlHost & TouchUiHost;

export function createControlHost(ctx: UiContext, uiHost: TouchUiHost): TouchControlHost {
  return {
    ...uiHost,
    classNamed: (name) => classPointer(ctx.names, name),
    selectorName: ctx.selectorName,
    touchInside: ctx.helpers.touchInside,
  };
}
