import { expect, test } from "vite-plus/test";
import { ScrollViews, type ScrollHost, type ScrollViewState, ScrollTiming } from "./state";
import { ScrollInteraction } from "./interaction";
const SELF = 100;
function fixture() {
  let now = 0;
  const view: ScrollViewState = {
    frame: [0, 0, 100, 200],
    bounds: [0, 0, 100, 200],
    interactive: true,
    needsDisplay: false,
    needsLayout: false,
    clipsToBounds: 0,
  };
  const calls: { self: number; selector: string; args: number[] }[] = [],
    retained: number[] = [],
    released: number[] = [];
  const host: ScrollHost = {
    hostClass: () => 0,
    method: () => {},
    structure: () => {},
    alloc: () => 0,
    destroy: () => {},
    retain: (value) => {
      retained.push(value);
      return value;
    },
    release: async (value) => {
      released.push(value);
    },
    autorelease: (value) => value,
    text: String,
    string: Number,
    write: () => {},
    read: () => 0,
    view: () => view,
    setFrame: (_self, frame) => {
      view.frame = frame;
      return SELF;
    },
    deallocateView: async () => {},
    ipa: {
      info: {},
      bundlePath: "Payload/Test.app",
      has: () => false,
      read: async () => new Uint8Array(),
    },
    send: async (self, selector, args = []) => {
      calls.push({ self, selector, args });
      return 0;
    },
    parent: () => 0,
    local: (_self, point) => point,
    now: () => now,
    boundsChanged: () => {},
    isControl: () => false,
  };
  const views = new ScrollViews(host),
    interaction = new ScrollInteraction(views),
    state = views.get(SELF);
  state.delegate = 101;
  return {
    views,
    interaction,
    state,
    view,
    calls,
    retained,
    released,
    clock: (time: number) => {
      now = time;
    },
  };
}
test("content offsets change the visible bounds while preserving the scroll view frame", async () => {
  const x = fixture();
  x.state.size = [400, 600];
  x.state.inset = [10, 20, 30, 40];
  await x.views.setOffset(SELF, [50, 100]);
  expect(x.view.frame).toEqual([0, 0, 100, 200]);
  expect(x.view.bounds).toEqual([50, 100, 100, 200]);
  expect(x.views.range(SELF)).toEqual([
    [-20, -10],
    [340, 430],
  ]);
  expect(x.views.visible(SELF, [0, 0, 20, 20])).toEqual([0, 0]);
  expect(x.views.visible(SELF, [350, 550, 20, 20])).toEqual([270, 370]);
  expect(x.calls.map((call) => call.selector)).toEqual(["scrollViewDidScroll:"]);
});
test("vertical panning ignores horizontal jitter and decelerates inside content bounds", async () => {
  const x = fixture();
  x.state.size = [100, 600];
  x.state.bounces = false;
  expect(await x.interaction.begin(1, SELF, [50, 160], 0)).toBe(false);
  expect(await x.interaction.move(1, [49, 158], 0.01)).toEqual({ view: 0, cancel: false });
  expect(await x.interaction.move(1, [40, 120], 0.1)).toEqual({ view: SELF, cancel: true });
  expect(x.views.offset(SELF)).toEqual([0, 40]);
  expect(x.state.dragging).toBe(true);
  await x.interaction.end(1, false, 0.11);
  expect(x.state.dragging).toBe(false);
  expect(x.state.decelerating).toBe(true);
  await x.views.pump(100);
  expect(x.views.offset(SELF)[1]).toBeGreaterThan(40);
  expect(x.views.offset(SELF)[1]).toBeLessThanOrEqual(400);
  await x.views.pump(10_000);
  expect(x.state.decelerating).toBe(false);
  expect(x.retained).toEqual([SELF]);
  expect(x.released).toEqual([SELF]);
  expect(
    x.calls.some(
      (call) => call.selector === "scrollViewDidEndDragging:willDecelerate:" && call.args[1] === 1,
    ),
  ).toBe(true);
});
test("paging settles to a page boundary and does not fling after a paused finger", async () => {
  const x = fixture();
  x.view.frame = [0, 0, 100, 100];
  x.view.bounds = [0, 0, 100, 100];
  x.state.size = [300, 100];
  x.state.paging = true;
  x.state.bounces = false;
  await x.interaction.begin(1, SELF, [80, 50], 0);
  await x.interaction.move(1, [20, 50], 0.1);
  await x.interaction.end(1, false, 0.5);
  expect(x.views.offset(SELF)).toEqual([60, 0]);
  x.clock(ScrollTiming.Duration);
  await x.views.pump(ScrollTiming.Duration);
  expect(x.views.offset(SELF)).toEqual([100, 0]);
  expect(x.state.decelerating).toBe(false);
  expect(x.calls.some((call) => call.selector === "scrollViewDidEndDecelerating:")).toBe(true);
});
test("a tap releases its scroll lease without entering dragging or changing the offset", async () => {
  const x = fixture();
  x.state.size = [100, 600];
  await x.interaction.begin(1, SELF, [50, 100], 0);
  expect(await x.interaction.end(1, false, 0.05)).toBe(0);
  expect(x.views.offset(SELF)).toEqual([0, 0]);
  expect(x.calls).toEqual([]);
  expect(x.released).toEqual([SELF]);
});
