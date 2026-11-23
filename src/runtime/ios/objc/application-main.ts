import {
  DISPLAY_INTERVAL_MS,
  nextDisplayRefresh,
  workerSliceMs,
} from "../uikit/application/display-refresh";
import { launchApplication } from "../uikit/application/launch";
import type { Application } from "./application";
import type { ObjcCore } from "./core";
import { responds } from "./core";
import type { DisplayLinks } from "./display-links";
import type { VisibilitySource } from "../uikit/application/display-refresh";
import type { FoundationFrameworks } from "./foundation-frameworks";
import type { GuestArguments } from "./host";
import type { RunLoopServices } from "./run-loop-services";

/** Display links fire up to half a millisecond before their deadline. */
const FIRE_TOLERANCE_MS = 0.5;
const NESTED_UI_REFRESHES = 0.5;
const LOOP_TOKEN_BYTES = 4;
const MainArgument = { Principal: 2, Delegate: 3 } as const;
export interface MainLoopParts {
  readonly core: ObjcCore;
  readonly application: Application;
  readonly frameworks: FoundationFrameworks;
  readonly displays: DisplayLinks;
  readonly runLoop: RunLoopServices;
}
/**
 * Games that run their own loop with CFRunLoopRunInMode still get timers, delayed performs,
 * touches and UIKit drawing on the main thread: all are sources in the default and common modes.
 */
export function nestedUIPump(core: ObjcCore, application: Application): () => Promise<void> {
  let nestedUIAt = -Infinity,
    nestedUIBusy = false;
  return async () => {
    const now = performance.now();
    if (
      nestedUIBusy ||
      !application.lifecycle.active ||
      now - nestedUIAt < DISPLAY_INTERVAL_MS * NESTED_UI_REFRESHES
    )
      return;
    nestedUIAt = now;
    nestedUIBusy = true;
    try {
      await core.late.scheduler().pump();
      await core.late.input().pumpAlerts();
      await core.late.input().pump();
    } finally {
      nestedUIBusy = false;
    }
  };
}
function hasEventSource({ core, frameworks, displays, runLoop }: MainLoopParts): boolean {
  const { input, foundation: objects } = frameworks;
  return (
    input.hasWindow() ||
    input.hasAlerts() ||
    !!core.late.bindings.dispatch?.hasPendingMain?.() ||
    !!runLoop.scheduler.pending() ||
    !!objects.pending() ||
    runLoop.audioPlayers.pending() ||
    [...displays.displays.values()].some((display) => display.scheduled)
  );
}
/** One turn of the UIKit event loop at the display refresh `time`. */
async function loopTurn(parts: MainLoopParts, time: number): Promise<void> {
  const { core, application, frameworks, displays, runLoop } = parts;
  const { lifecycle } = application;
  const { input } = frameworks;
  await lifecycle.pump();
  await frameworks.foundation.pollMain();
  await runLoop.scheduler.pump();
  await runLoop.audioPlayers.pump();
  await input.pumpAlerts();
  if (lifecycle.active) await input.pump();
  await runLoop.accelerometer.pump(lifecycle.active);
  for (const [pointer, display] of [...displays.displays]) {
    if (
      !lifecycle.active ||
      !display.scheduled ||
      display.paused ||
      time + FIRE_TOLERANCE_MS < display.next
    )
      continue;
    const period = display.interval * DISPLAY_INTERVAL_MS;
    display.next += (Math.floor((time + FIRE_TOLERANCE_MS - display.next) / period) + 1) * period;
    display.timestamp = time;
    await core.messenger.send(display.target, display.action, [pointer]);
  }
  await core.platform.service(workerSliceMs(time, performance.now()), true);
}
async function launch(
  parts: MainLoopParts,
  visibility: VisibilitySource,
  principal: string | null,
  delegate: string | null,
): Promise<void> {
  const { core, application, frameworks } = parts;
  const { registry, ownership, messenger, late, options, memory } = core;
  await launchApplication(
    {
      resolveClass: (name) => registry.names.get(name),
      isApplicationClass: (cls) => registry.subclass(cls, registry.names.get("UIApplication") ?? 0),
      currentApplication: () => application.state.application,
      setApplication: (pointer) => {
        application.state.application = pointer;
      },
      responds: (pointer, name) => responds(core, pointer, name),
      send: messenger.send,
      pushPool: () => ownership.poolPush(),
      popPool: ownership.poolPop,
      loadMainNib: (app) => late.nibs().main(app),
      connectInput: () => frameworks.input.connect(),
      activate: () => application.lifecycle.start(visibility),
      phase: options.onLifecycle,
    },
    principal,
    delegate,
  );
  options.onLifecycle("UIKit event loop", {
    keyWindow: frameworks.input.hasWindow(),
    displayLinks: parts.displays.displays.size,
    scene: frameworks.input.scene(
      (pointer) => registry.classes.get(memory.read(pointer))?.name ?? "unknown",
    ),
  });
}
/** UIApplicationMain: launches the app, then runs the UIKit event loop while it has event sources. */
export function applicationMain(parts: MainLoopParts): (args: GuestArguments) => Promise<never> {
  const { core, application, frameworks } = parts;
  const { ownership, strings, memory, guest, platform, options } = core;
  const visibility = options.mediaHost?.ownerDocument ?? globalThis.document;
  return async (args) => {
    const principal = args(MainArgument.Principal)
        ? strings.text(args(MainArgument.Principal))
        : null,
      delegate = args(MainArgument.Delegate) ? strings.text(args(MainArgument.Delegate)) : null;
    let loopToken = 0;
    try {
      await launch(parts, visibility, principal, delegate);
      // The loop turns many times per frame; one guest token serves every turn's pool.
      loopToken = memory.zero(LOOP_TOKEN_BYTES);
      while (hasEventSource(parts)) {
        await application.lifecycle.pump();
        const refresh = nextDisplayRefresh(platform.signal, visibility),
          time = await (guest.threads?.remote ? guest.threads.idle(refresh) : refresh);
        ownership.poolPush(loopToken);
        try {
          await loopTurn(parts, time);
        } finally {
          await ownership.poolPop(loopToken, true);
        }
      }
    } finally {
      guest.heap.free(loopToken);
      application.lifecycle.close();
      frameworks.input.disconnect();
    }
    throw new Error(
      "UIApplication launched without a supported event source (key window or CADisplayLink)",
    );
  };
}
