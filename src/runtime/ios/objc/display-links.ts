import { doubleBits } from "../abi/scalars";
import { DISPLAY_INTERVAL_MS } from "../uikit/application/display-refresh";
import type { ObjcCore } from "./core";
import { MAIN_THREAD } from "./object-ownership";

const DISPLAY_LINK = "CADisplayLink";
const MILLISECONDS_PER_SECOND = 1000;
/** A CADisplayLink: its target and action, and when it next fires in milliseconds. */
export interface DisplayLink {
  readonly target: number;
  readonly action: string;
  interval: number;
  next: number;
  timestamp: number;
  paused: boolean;
  scheduled: boolean;
}
export interface DisplayLinks {
  readonly displays: Map<number, DisplayLink>;
  readonly getRunLoop: (thread?: number) => number;
}
/** NSRunLoop instances per thread and CADisplayLink on the main run loop at 60 Hz. */
export function installDisplayLinks(core: ObjcCore): DisplayLinks {
  const { registry, ownership, memory } = core;
  const { method } = registry;
  const runLoops = new Map<number, number>(),
    displays = new Map<number, DisplayLink>();
  function getRunLoop(thread = ownership.threadId()): number {
    let loop = runLoops.get(thread);
    if (loop === undefined)
      runLoops.set(thread, (loop = ownership.alloc(registry.names.get("NSRunLoop") ?? 0)));
    return loop;
  }
  const display = (self: number): DisplayLink => {
    const link = displays.get(self);
    if (!link) throw new TypeError("Unknown CADisplayLink");
    return link;
  };
  const seconds = (milliseconds: number) => doubleBits(milliseconds / MILLISECONDS_PER_SECOND);
  method("NSRunLoop", true, "mainRunLoop", () => getRunLoop(MAIN_THREAD));
  method("NSRunLoop", true, "currentRunLoop", () => getRunLoop());
  method(DISPLAY_LINK, true, "displayLinkWithTarget:selector:", (_, args) => {
    const target = args(0),
      action = args(1);
    if (!target || !action) return 0;
    const self = ownership.alloc(registry.names.get(DISPLAY_LINK) ?? 0);
    displays.set(self, {
      target: ownership.retain(target),
      action: memory.cString(action),
      interval: 1,
      next: 0,
      timestamp: 0,
      paused: false,
      scheduled: false,
    });
    return ownership.autorelease(self);
  });
  method(DISPLAY_LINK, false, "addToRunLoop:forMode:", (self, args) => {
    if (args(0) !== getRunLoop(MAIN_THREAD)) throw new Error("Unsupported display link run loop");
    const link = display(self);
    if (!link.scheduled) {
      ownership.retain(self);
      link.next = performance.now() + DISPLAY_INTERVAL_MS * link.interval;
      link.scheduled = true;
    }
  });
  method(DISPLAY_LINK, false, "removeFromRunLoop:forMode:", (self, args) => {
    if (args(0) !== getRunLoop(MAIN_THREAD)) return;
    const link = display(self);
    if (!link.scheduled) return;
    link.scheduled = false;
    void ownership.release(self);
  });
  method(DISPLAY_LINK, false, "invalidate", (self) => {
    const link = displays.get(self);
    if (!link) return;
    displays.delete(self);
    void ownership.release(link.target);
    if (link.scheduled) void ownership.release(self);
  });
  method(DISPLAY_LINK, false, "setFrameInterval:", (self, args) => {
    const link = display(self);
    link.interval = Math.max(1, args(0) | 0);
    link.next = performance.now() + DISPLAY_INTERVAL_MS * link.interval;
  });
  method(DISPLAY_LINK, false, "timestamp", (self) => seconds(display(self).timestamp));
  method(DISPLAY_LINK, false, "duration", () => seconds(DISPLAY_INTERVAL_MS));
  method(DISPLAY_LINK, false, "frameInterval", (self) => display(self).interval);
  method(DISPLAY_LINK, false, "setPaused:", (self, args) => {
    display(self).paused = Boolean(args(0));
  });
  method(DISPLAY_LINK, false, "isPaused", (self) => Number(display(self).paused));
  return { displays, getRunLoop };
}
