import { installExceptions } from "../foundation/exceptions";
import { installCookieStorage } from "../foundation/http-cookies";
import { installNumberFormatter } from "../foundation/number-formatter";
import { installOfflineGameKit } from "../gamekit/offline";
import { moviePlayers } from "../media/movie";
import { installMovieViewControllers } from "../media/movie-view-controller";
import { installAdBanners } from "../services/iad";
import { installLocationManager } from "../services/core-location";
import type { ServiceHost } from "../services/host";
import { installMessageComposers } from "../services/message-ui";
import { installStoreRequests } from "../services/store-kit";
import type { Diagnostic } from "../package/ipa";
import { installBackgroundTasks } from "../uikit/application/background-tasks";
import type { Application } from "./application";
import { installApplicationServices } from "./application";
import type { ObjcCore } from "./core";
import { standardHost } from "./core";
import type { FoundationFrameworks } from "./foundation-frameworks";
import type { HostResult } from "./host";
import type { MoviePlayers } from "./late-bindings";
import { callWithReceiver } from "./object-ownership";
import { pointerResult } from "./runtime-types";
import type { RunLoopServices } from "./run-loop-services";

const DIAGNOSTIC_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];
function isDiagnosticLevel(level: string): level is DiagnosticLevel {
  return DIAGNOSTIC_LEVELS.includes(level);
}
/** Blocks keep their invoke function after the isa, flags and reserved words. */
const BLOCK_INVOKE = 12;
const CALL_CENTER = "CTCallCenter";
const AUDIO_SESSION = "AVAudioSession";
type DiagnosticLevel = Parameters<Diagnostic>[0];
export type Exceptions = ReturnType<typeof installExceptions>;
export interface AppServices {
  readonly exceptions: Exceptions;
  readonly movies: MoviePlayers;
  /** AVAudioSession's shared instance, created on first use. */
  readonly audioSession: () => number;
}
/** HTTP cookies, background tasks, Game Center and the StoreKit, MessageUI, location and iAd stubs. */
function installNetworkServices(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  application: Application,
  service: ServiceHost,
): void {
  const { memory, registry, ownership, strings, messenger, guest, late } = core;
  const { input } = frameworks;
  installCookieStorage({
    ...standardHost(core),
    array: (values) => ownership.autorelease(input.array([...values])),
    items: input.items,
    urlHost: async (url) => {
      const value = url ? pointerResult(await messenger.send(url, "host")) : 0;
      return value ? strings.text(value).toLowerCase() : "";
    },
  });
  installBackgroundTasks({
    method: registry.method,
    state: () => application.lifecycle.state,
    copyBlock: (block) => late.dispatch().copy(block),
    releaseBlock: (block) => late.dispatch().release(block),
  });
  installOfflineGameKit({
    ...standardHost(core),
    callBlock: (block, args) =>
      guest.callGuest(memory.read(block + BLOCK_INVOKE), [block, ...args]),
    copyBlock: (block) => late.dispatch().copy(block),
    releaseBlock: (block) => late.dispatch().release(block),
    later: (task) => service.later(task),
    error: (code, domain) => service.error(code, domain),
  });
  for (const install of [
    installStoreRequests,
    installMessageComposers,
    installLocationManager,
    installAdBanners,
  ])
    install(service);
}
/** NSException, NSNumberFormatter and CoreTelephony. */
function installFoundationServices(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  throwException: (exception: number) => HostResult | Promise<HostResult>,
): Exceptions {
  const { registry, ownership } = core;
  const { foundation: objects, input } = frameworks;
  const exceptions = installExceptions({
    ...standardHost(core),
    formatted: (format, argument) => objects.formatted(format, argument),
    throwException,
    emptyArray: () => ownership.autorelease(input.array([])),
  });
  installNumberFormatter({
    ...standardHost(core),
    numberValue: (pointer) => {
      if (!pointer) return undefined;
      const value = objects.unbox(pointer);
      return typeof value === "number"
        ? value
        : typeof value === "boolean"
          ? Number(value)
          : undefined;
    },
    number: (value) => objects.number(value),
  });
  // CoreTelephony: no call is ever in progress, so the event handler never fires.
  registry.hostClass(CALL_CENTER, "NSObject");
  registry.method(CALL_CENTER, false, "init", (self) => self);
  for (const name of ["currentCalls", "callEventHandler"])
    registry.method(CALL_CENTER, false, name, () => 0);
  registry.method(CALL_CENTER, false, "setCallEventHandler:", () => undefined);
  return exceptions;
}
/** MPMoviePlayerController, its view controller and AVAudioSession. */
function installMovies(core: ObjcCore, service: ServiceHost): AppServices["audioSession"] {
  const { registry, ownership, strings, messenger, late, ipa, options } = core;
  late.bindings.movies = moviePlayers({
    hostClass: registry.hostClass,
    method: registry.method,
    names: registry.names,
    alloc: ownership.alloc,
    destroy: ownership.destroy,
    retain: ownership.retain,
    release: ownership.releaseFromHost,
    string: strings.string,
    text: strings.text,
    send: messenger.send,
    ipa,
    mediaHost: options.mediaHost,
    needsMovieResume: options.needsMovieResume,
    diagnostic: (level, area, message, details) => {
      if (isDiagnosticLevel(level)) options.diagnostic(level, area, message, details);
    },
  });
  installMovieViewControllers({
    ...service,
    selector: registry.selector,
    classNamed: (name) => {
      const pointer = registry.names.get(name);
      if (!pointer) throw new Error(`Unknown class ${name}`);
      return pointer;
    },
    deallocController: async (self) => {
      const dealloc = registry.lookup(registry.names.get("UIViewController") ?? 0, "dealloc");
      if (!dealloc || typeof dealloc === "number")
        throw new TypeError("UIViewController dealloc is not a host method");
      await callWithReceiver(dealloc, self);
    },
  });
  registry.hostClass(AUDIO_SESSION, "NSObject");
  let session = 0;
  const audioSession = () => (session ||= ownership.alloc(registry.names.get(AUDIO_SESSION) ?? 0));
  registry.method(AUDIO_SESSION, true, "sharedInstance", audioSession);
  registry.method(AUDIO_SESSION, false, "setActive:error:", (_, args) =>
    Number(options.audio?.setSessionActive(!!args(0)) === 0),
  );
  return audioSession;
}
/** The services apps reach through UIKit and Foundation, after the run loop exists. */
export function installAppServices(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  application: Application,
  runLoop: RunLoopServices,
  throwException: (exception: number) => HostResult | Promise<HostResult>,
): AppServices {
  const service: ServiceHost = {
    ...standardHost(core),
    later: (task) => runLoop.scheduler.later(task),
    error: (code, domain) => frameworks.files.error(code, domain),
  };
  installNetworkServices(core, frameworks, application, service);
  const exceptions = installFoundationServices(core, frameworks, throwException);
  installApplicationServices(core, application, {
    later: (task) => runLoop.scheduler.later(task),
    error: (code, domain) => frameworks.files.error(code, domain),
  });
  const audioSession = installMovies(core, service);
  return { exceptions, movies: core.late.movies(), audioSession };
}
