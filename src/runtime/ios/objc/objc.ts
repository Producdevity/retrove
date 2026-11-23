import type { GuestCPU } from "../../cpu/cpu";
import { geometry } from "../../graphics/core-graphics/geometry";
import { eaglDrawable } from "../../graphics/drawable";
import { PresentPacing } from "../../graphics/present-pacing";
import { installAppServices, type AppServices } from "./app-services";
import { installApplication, type Application } from "./application";
import { applicationMain, nestedUIPump } from "./application-main";
import { installArchives } from "./archives";
import { installBundleMethods } from "./bundle-methods";
import { classRegistry } from "./class-registry";
import type { ObjcBundle, ObjcCore } from "./core";
import { installDataObjects } from "./data-objects";
import { installDisplayLinks, type DisplayLinks } from "./display-links";
import { installEAGLContexts, type EAGLContexts } from "./eagl-contexts";
import { dataResolver } from "./exported-data";
import { installFoundationFrameworks, type FoundationFrameworks } from "./foundation-frameworks";
import { guestAccess } from "./guest-access";
import { imageLoader } from "./image-loader";
import { installInvocationRuntime } from "./invocation-calls";
import { lateServices } from "./late-bindings";
import { messenger } from "./messaging";
import { objectOwnership } from "./object-ownership";
import { installRootObject } from "./root-object";
import { installRunLoopServices, type RunLoopServices } from "./run-loop-services";
import { exceptionThrowing, runtimeFunctions, type ExceptionThrowing } from "./runtime-functions";
import { runtimeApi } from "./runtime-api";
import { pageContext } from "./runtime-types";
import type {
  GuestCall,
  ObjcGuest,
  ObjcHeap,
  ObjcOptions,
  ObjcPlatform,
  PageGraphics,
  ResolvedOptions,
  ServiceSlice,
} from "./runtime-types";
import { installStringMethods } from "./string-methods";
import { stringObjects } from "./string-objects";

const EMPTY_CACHE_BYTES = 16;
function resolveOptions(options: ObjcOptions): ResolvedOptions {
  return {
    ...options,
    onPresent: options.onPresent ?? (() => {}),
    onLifecycle: options.onLifecycle ?? (() => {}),
    diagnostic: options.diagnostic ?? (() => {}),
    audioOutput: options.audioOutput ?? (() => null),
  };
}
/** The class registry, messaging, ownership and the root, string and data classes. */
function assembleCore(
  guest: ObjcGuest,
  ipa: ObjcBundle,
  options: ResolvedOptions,
  platform: ObjcPlatform,
): { core: ObjcCore; emptyCache: number } {
  const memory = guestAccess(guest);
  const emptyCache = memory.zero(EMPTY_CACHE_BYTES);
  const registry = classRegistry(memory, guest.heap);
  const ownership = objectOwnership(guest, memory, registry);
  const messages = messenger(guest, memory, registry, ownership.threadId);
  const root = installRootObject({
    guest,
    memory,
    registry,
    ownership,
    messenger: messages,
    hostGate: options.hostGate,
  });
  const late = lateServices();
  const strings = stringObjects(memory, guest.heap, registry, ownership);
  installStringMethods({
    memory,
    heap: guest.heap,
    registry,
    ownership,
    strings,
    foundation: late.foundation,
  });
  const data = installDataObjects({
    memory,
    heap: guest.heap,
    registry,
    ownership,
    strings,
    messenger: messages,
  });
  const core: ObjcCore = {
    ...{ guest, memory, registry, ownership, messenger: messages, strings, data, root, late },
    ...{ ipa, options, platform },
  };
  installBundleMethods(core);
  return { core, emptyCache };
}
export interface Graphics {
  readonly contexts: EAGLContexts;
  readonly pacing: PresentPacing;
}
/** CAEAGLLayer drawables and EAGLContext, then the UIKit classes the display links hang off. */
function installGraphics(core: ObjcCore, drawableFactory: ObjcOptions["drawable"]): Graphics {
  const { registry, options, platform, late } = core;
  registry.hostClass("CALayer", "NSObject");
  registry.hostClass("CAEAGLLayer", "CALayer");
  const makeDrawable =
    drawableFactory ??
    ((geometry) =>
      eaglDrawable(() => pageContext(platform.graphics()), geometry, options.diagnostic));
  const drawable = makeDrawable((layer) => late.input().drawableGeometry(layer));
  const pacing = new PresentPacing();
  const contexts = installEAGLContexts(core, {
    drawable,
    pacing,
    graphics: platform.graphics,
    onPresent: options.onPresent,
  });
  registry.hostClass("UIResponder", "NSObject");
  registry.hostClass("UIApplication", "UIResponder");
  registry.hostClass("CADisplayLink", "NSObject");
  registry.hostClass("NSRunLoop", "NSObject");
  return { contexts, pacing };
}
export interface Runtime {
  readonly core: ObjcCore;
  readonly emptyCache: number;
  readonly graphics: Graphics;
  readonly displays: DisplayLinks;
  readonly application: Application;
  readonly frameworks: FoundationFrameworks;
  readonly runLoop: RunLoopServices;
  readonly services: AppServices;
  readonly throwing: ExceptionThrowing;
}
/** Every framework class, in the order the untyped runtime registered them. */
function installRuntime(
  assembled: { core: ObjcCore; emptyCache: number },
  drawableFactory: ObjcOptions["drawable"],
): Runtime {
  const { core } = assembled;
  const graphics = installGraphics(core, drawableFactory);
  const displays = installDisplayLinks(core);
  const application = installApplication(core);
  const frameworks = installFoundationFrameworks(core, application, displays);
  installArchives(core, frameworks);
  const runLoop = installRunLoopServices(
    core,
    frameworks,
    displays,
    nestedUIPump(core, application),
  );
  const throwing = exceptionThrowing(core, () => services.exceptions);
  const services = installAppServices(
    core,
    frameworks,
    application,
    runLoop,
    throwing.throwException,
  );
  return {
    ...assembled,
    ...{ graphics, displays, application, frameworks, runLoop, services, throwing },
  };
}
/** The Objective-C runtime and the iOS frameworks over guest memory, as the guest imports them. */
export function objcImports(
  cpu: GuestCPU,
  heap: ObjcHeap,
  ipa: ObjcBundle,
  graphics: () => PageGraphics,
  callGuest: GuestCall,
  signal: AbortSignal | undefined,
  service: ServiceSlice = async () => {},
  options: ObjcOptions = {},
) {
  const resolved = resolveOptions(options);
  const guest: ObjcGuest = { cpu, heap, callGuest, threads: options.threads };
  const assembled = assembleCore(guest, ipa, resolved, { graphics, signal, service });
  const runtime = installRuntime(assembled, options.drawable);
  const { core, frameworks, displays, application, runLoop } = runtime;
  const invocation = installInvocationRuntime(core);
  const loader = imageLoader(core, invocation.protocols);
  const cg = geometry(cpu, heap);
  const resolveData = dataResolver(core, {
    cf: frameworks.cf,
    foundation: frameworks.foundation,
    networkData: runLoop.networkData,
    blockClasses: core.root.blockClasses,
    geometryConstants: cg.constants,
    emptyCache: assembled.emptyCache,
  });
  const funcs = runtimeFunctions({
    core,
    frameworks,
    invocation,
    cg,
    exceptions: runtime.throwing,
    applicationMain: applicationMain({ core, application, frameworks, displays, runLoop }),
  });
  return runtimeApi(runtime, { funcs, resolveData, install: loader.install, start: loader.start });
}
