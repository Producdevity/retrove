import type { CoreGraphics } from "../../graphics/core-graphics/coregraphics";
import { isKind } from "./core";
import type { GuestFunctions } from "./runtime-functions";
import type { ImageLoader } from "./image-loader";
import type { Runtime } from "./objc";
import type { DispatchService } from "./runtime-types";
import { pointerResult } from "./runtime-types";

const NO_THREAD = 0;
export interface RuntimeExports {
  readonly funcs: GuestFunctions;
  readonly resolveData: (name: string) => number | null;
  readonly install: ImageLoader["install"];
  readonly start: ImageLoader["start"];
}
/** What the host page and the other guest runtimes call on the Objective-C runtime. */
export function runtimeApi(runtime: Runtime, exports: RuntimeExports) {
  const { core, graphics, frameworks, runLoop, services, application } = runtime;
  const { registry, ownership, strings, messenger, late } = core;
  const { input, foundation: objects } = frameworks;
  const send = async (receiver: number, selector: string, args?: number[]) =>
    pointerResult(await messenger.send(receiver, selector, args));
  return {
    ...exports,
    coverage: registry.coverage,
    stringText: strings.text,
    graphicsAPI: graphics.contexts.graphicsAPI,
    graphicsContext: graphics.contexts.currentContext,
    isKindOf: (object: number, name: string) => isKind(core, object, name),
    attachCoreGraphics: (cg: CoreGraphics) => {
      ownership.coreGraphics = cg;
    },
    currentThreadId: () => core.guest.threads?.funcs._pthread_self() ?? NO_THREAD,
    setDispatch: (dispatch: DispatchService) => {
      late.bindings.dispatch = dispatch;
    },
    blockClasses: core.root.blockClasses,
    retainObject: ownership.retain,
    releaseObject: ownership.releaseFromHost,
    pumpMovies: () => services.movies.pump(),
    pumpAlerts: input.pumpAlerts,
    pumpAudioPlayers: () => runLoop.audioPlayers.pump(),
    audioPlayerSnapshot: () => runLoop.audioPlayers.snapshot(),
    audioReasonDictionary(key: string, value: number): number {
      return ownership.autorelease(
        objects.dictionary(registry.names.get("NSDictionary") ?? 0, [
          [strings.string(key), objects.number(value)],
        ]),
      );
    },
    async audioSessionNotification(notification: string, key: string, value: number) {
      const info = this.audioReasonDictionary(key, value);
      const center = await send(registry.names.get("NSNotificationCenter") ?? 0, "defaultCenter");
      await messenger.send(center, "postNotificationName:object:userInfo:", [
        strings.string(notification),
        services.audioSession(),
        info,
      ]);
    },
    async fileURLPath(url: number) {
      return (await messenger.send(url, "isFileURL"))
        ? strings.text(await send(url, "path"))
        : null;
    },
    close() {
      graphics.pacing.close();
      application.lifecycle.close();
      runLoop.accelerometer.close();
      services.movies.close();
      runLoop.audioPlayers.close();
      input.close();
    },
    inputSnapshot: () => input.snapshot(),
    get lastSelector() {
      return messenger.lastSelector(ownership.threadId());
    },
  };
}
export type ObjcRuntime = ReturnType<typeof runtimeApi>;
