import { appProfile, type AppProfile } from "../profiles/app-manifest";
import { ApplicationLifecycle, LifecycleEvent } from "../uikit/application/lifecycle";
import { installRemoteNotifications } from "../uikit/application/remote-notifications";
import { installStatusBar, type StatusBarState } from "../uikit/application/status-bar";
import { installURLOpening, openInBrowser } from "../uikit/application/url-opening";
import type { ObjcCore } from "./core";
import { responds } from "./core";
import { MISSING_DESTINATION } from "./guest-access";
import type { GuestArguments, HostResult } from "./host";
import { pointerResult } from "./runtime-types";

const APPLICATION = "UIApplication";
/** UIApplication's shared instance, its delegate and the switches apps toggle. */
export interface ApplicationState {
  application: number;
  delegate: number;
  idleDisabled: boolean;
  networkActivity: boolean;
  shakeToEdit: boolean;
  badge: number;
}
export interface Application {
  readonly state: ApplicationState;
  readonly lifecycle: ApplicationLifecycle;
  readonly profile: AppProfile;
  readonly statusBar: StatusBarState;
}
function applicationLifecycle(core: ObjcCore, state: ApplicationState): ApplicationLifecycle {
  const { messenger, registry, strings, late } = core;
  return new ApplicationLifecycle({
    async delegate(selector) {
      if (selector === LifecycleEvent.Inactive.selector) await late.input().cancelTouches();
      await messenger.send(state.delegate, selector, [state.application], true);
    },
    async notify(notification) {
      const center = pointerResult(
        await messenger.send(registry.names.get("NSNotificationCenter") ?? 0, "defaultCenter"),
      );
      await messenger.send(center, "postNotificationName:object:", [
        strings.string(notification),
        state.application,
      ]);
    },
  });
}
/** The UIApplication accessors, URL opening and the app profile's status bar. */
export function installApplication(core: ObjcCore): Application {
  const { registry, strings, messenger, ipa } = core;
  const { method } = registry;
  const state: ApplicationState = {
    application: 0,
    delegate: 0,
    idleDisabled: false,
    networkActivity: false,
    shakeToEdit: true,
    badge: 0,
  };
  const lifecycle = applicationLifecycle(core, state);
  method(APPLICATION, true, "sharedApplication", () => state.application);
  method(APPLICATION, false, "applicationState", () => lifecycle.state);
  method(APPLICATION, false, "delegate", () => state.delegate);
  method(APPLICATION, false, "setDelegate:", (_, args) => {
    state.delegate = args(0);
  });
  method(APPLICATION, false, "isIdleTimerDisabled", () => Number(state.idleDisabled));
  method(APPLICATION, false, "setIdleTimerDisabled:", (_, args) => {
    state.idleDisabled = Boolean(args(0));
  });
  method(APPLICATION, false, "isNetworkActivityIndicatorVisible", () =>
    Number(state.networkActivity),
  );
  method(APPLICATION, false, "setNetworkActivityIndicatorVisible:", (_, args) => {
    state.networkActivity = Boolean(args(0));
  });
  installURLOpening({
    method,
    text: strings.text,
    send: async (receiver, selector) => pointerResult(await messenger.send(receiver, selector)),
    open: openInBrowser,
  });
  const profile = appProfile(ipa.info);
  if (profile.entry)
    core.options.diagnostic("info", "profile", "Applied app manifest entry", {
      bundleId: profile.bundleId,
      ...profile.entry,
    });
  const statusBar: StatusBarState = {
    hidden: !!ipa.info["UIStatusBarHidden"],
    orientation: profile.orientation,
    style: 0,
  };
  return { state, lifecycle, profile, statusBar };
}
export interface ApplicationServices {
  readonly later: (task: () => Promise<void>) => void;
  readonly error: (code: number, domain: string) => number;
}
/** Status bar methods take a destination; only its frame getter returns a structure. */
type StatusBarMethod = ((self: number, args: GuestArguments, destination: number) => HostResult) & {
  stret?: true;
};
function statusBarMethod(core: ObjcCore) {
  return (
    className: string,
    meta: boolean,
    name: string,
    implementation: StatusBarMethod,
  ): void => {
    if (implementation.stret)
      core.registry.method(
        className,
        meta,
        name,
        Object.assign(
          (self: number, args: GuestArguments, destination: number) => {
            implementation(self, args, destination);
          },
          { stret: true as const },
        ),
      );
    else
      core.registry.method(className, meta, name, (self, args) =>
        implementation(self, args, MISSING_DESTINATION),
      );
  };
}
/** Remote notifications, the status bar and the remaining UIApplication switches. */
export function installApplicationServices(
  core: ObjcCore,
  application: Application,
  services: ApplicationServices,
): void {
  const { registry, messenger, memory } = core;
  const { method } = registry;
  const { state } = application;
  installRemoteNotifications({
    method,
    send: messenger.send,
    responds: (pointer, name) => !!pointer && responds(core, pointer, name),
    delegate: () => state.delegate,
    error: services.error,
    later: services.later,
  });
  installStatusBar(
    { method: statusBarMethod(core), write: memory.write },
    application.statusBar,
    application.profile,
  );
  method(APPLICATION, false, "setApplicationSupportsShakeToEdit:", (_, args) => {
    state.shakeToEdit = !!args(0);
  });
  method(APPLICATION, false, "applicationSupportsShakeToEdit", () => Number(state.shakeToEdit));
  method(APPLICATION, false, "setApplicationIconBadgeNumber:", (_, args) => {
    state.badge = args(0) | 0;
  });
  method(APPLICATION, false, "applicationIconBadgeNumber", () => state.badge);
}
