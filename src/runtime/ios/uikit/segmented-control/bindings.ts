import { Argument } from "../../objc/host";
import { GeometryField, floatBits, floatFromBits } from "../../abi/scalars";
import { CONTROL_CLASS, type Controls } from "../control-host";
import { ControlEvent } from "../control-actions";
import {
  NO_SEGMENT,
  controlHeight,
  insertSegment,
  removeSegment,
  segmentAt,
  tapSegment,
  validIndex,
} from "./model";
import { Segments, type SegmentedHost } from "./segments";

export type { SegmentedHost } from "./segments";
const SEGMENTED_CLASS = "UISegmentedControl";
export interface SegmentedControls {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): void;
}

async function setItems(host: SegmentedHost, segments: Segments, self: number, array: number) {
  const state = segments.get(self);
  for (const item of state.segments.splice(0)) await segments.release(item);
  state.selected = NO_SEGMENT;
  for (const item of array ? host.elements(array) : []) state.segments.push(segments.content(item));
  segments.changed(self);
}
function initializers(host: SegmentedHost, segments: Segments): void {
  host.method(SEGMENTED_CLASS, false, "initWithItems:", async (self, args) => {
    await setItems(host, segments, self, args(Argument.First));
    return host.setFrame(self, [0, 0, ...segments.fittedSize(self)]);
  });
  host.method(SEGMENTED_CLASS, false, "initWithFrame:", (self, args) => {
    segments.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
}
function properties(host: SegmentedHost, segments: Segments): void {
  host.method(SEGMENTED_CLASS, false, "segmentedControlStyle", (self) => segments.get(self).style);
  host.method(SEGMENTED_CLASS, false, "setSegmentedControlStyle:", (self, args) => {
    const state = segments.get(self),
      frame = host.view(self).frame,
      previous = controlHeight(state.style);
    state.style = args(Argument.First);
    if (frame[GeometryField.Height] === previous) {
      const [x, y, width] = frame;
      host.setFrame(self, [x, y, width, controlHeight(state.style)]);
    }
    segments.changed(self);
  });
  host.method(
    SEGMENTED_CLASS,
    false,
    "selectedSegmentIndex",
    (self) => segments.get(self).selected,
  );
  host.method(SEGMENTED_CLASS, false, "setSelectedSegmentIndex:", (self, args) => {
    const state = segments.get(self),
      index = args(Argument.First) | 0;
    if (index !== NO_SEGMENT && !validIndex(state, index))
      throw new Error(`UISegmentedControl segment ${index} is out of bounds.`);
    state.selected = index;
    segments.changed(self);
  });
  host.method(SEGMENTED_CLASS, false, "isMomentary", (self) =>
    Number(segments.get(self).momentary),
  );
  host.method(SEGMENTED_CLASS, false, "setMomentary:", (self, args) => {
    segments.get(self).momentary = Boolean(args(Argument.First));
    segments.changed(self);
  });
  host.method(SEGMENTED_CLASS, false, "tintColor", (self) => segments.get(self).tint);
  host.method(SEGMENTED_CLASS, false, "setTintColor:", async (self, args) => {
    const state = segments.get(self),
      old = state.tint,
      color = args(Argument.First);
    state.tint = color ? host.retain(color) : 0;
    if (old) await host.release(old);
    segments.changed(self);
  });
  host.method(
    SEGMENTED_CLASS,
    false,
    "numberOfSegments",
    (self) => segments.get(self).segments.length,
  );
}
function contents(host: SegmentedHost, segments: Segments): void {
  for (const [field, getter, setter] of [
    ["title", "titleForSegmentAtIndex:", "setTitle:forSegmentAtIndex:"],
    ["image", "imageForSegmentAtIndex:", "setImage:forSegmentAtIndex:"],
  ] as const) {
    host.method(
      SEGMENTED_CLASS,
      false,
      getter,
      (self, args) => segments.at(self, args(Argument.First))[field],
    );
    host.method(SEGMENTED_CLASS, false, setter, async (self, args) => {
      const item = segments.at(self, args(Argument.Second)),
        value = args(Argument.First);
      await segments.release(item);
      item.title = 0;
      item.image = 0;
      item[field] = value ? host.retain(value) : 0;
      segments.changed(self);
    });
  }
  for (const name of [
    "insertSegmentWithTitle:atIndex:animated:",
    "insertSegmentWithImage:atIndex:animated:",
  ])
    host.method(SEGMENTED_CLASS, false, name, (self, args) => {
      insertSegment(
        segments.get(self),
        segments.content(args(Argument.First)),
        args(Argument.Second),
      );
      segments.changed(self);
    });
  host.method(SEGMENTED_CLASS, false, "removeSegmentAtIndex:animated:", async (self, args) => {
    const removed = removeSegment(segments.get(self), args(Argument.First));
    if (removed) await segments.release(removed);
    segments.changed(self);
  });
  host.method(SEGMENTED_CLASS, false, "removeAllSegments", (self) =>
    setItems(host, segments, self, 0),
  );
}
function segmentMetrics(host: SegmentedHost, segments: Segments): void {
  host.method(SEGMENTED_CLASS, false, "setEnabled:forSegmentAtIndex:", (self, args) => {
    segments.at(self, args(Argument.Second)).enabled = Boolean(args(Argument.First));
    segments.changed(self);
  });
  host.method(SEGMENTED_CLASS, false, "isEnabledForSegmentAtIndex:", (self, args) =>
    Number(segments.at(self, args(Argument.First)).enabled),
  );
  host.method(SEGMENTED_CLASS, false, "setWidth:forSegmentAtIndex:", (self, args) => {
    segments.at(self, args(Argument.Second)).width = Math.max(
      0,
      floatFromBits(args(Argument.First)),
    );
    segments.changed(self);
  });
  host.method(SEGMENTED_CLASS, false, "widthForSegmentAtIndex:", (self, args) =>
    floatBits(segments.at(self, args(Argument.First)).width),
  );
  host.method(SEGMENTED_CLASS, false, "sizeToFit", (self) => {
    const [x, y] = host.view(self).frame;
    host.setFrame(self, [x, y, ...segments.fittedSize(self)]);
  });
}
function pressedSegment(host: SegmentedHost, segments: Segments, self: number, touches: number) {
  const point = host.touchPoint(touches, self),
    state = segments.get(self);
  if (!point) return NO_SEGMENT;
  const index = segmentAt(
    state.segments,
    segments.width(self),
    point[0] - (host.view(self).bounds[0] ?? 0),
  );
  return validIndex(state, index) && state.segments[index]?.enabled ? index : NO_SEGMENT;
}
function touches(host: SegmentedHost, segments: Segments, controls: Controls): void {
  host.method(SEGMENTED_CLASS, false, "touchesBegan:withEvent:", async (self, args) => {
    segments.get(self).pressed = pressedSegment(host, segments, self, args(Argument.First));
    segments.changed(self);
    await controls.touch(self, "begin", args(Argument.First), args(Argument.Second));
  });
  host.method(SEGMENTED_CLASS, false, "touchesCancelled:withEvent:", async (self, args) => {
    segments.get(self).pressed = NO_SEGMENT;
    segments.changed(self);
    await controls.touch(self, "cancel", args(Argument.First), args(Argument.Second));
  });
  host.method(SEGMENTED_CLASS, false, "touchesEnded:withEvent:", async (self, args) => {
    const state = segments.get(self),
      pressed = state.pressed,
      tracking = controls.get(self).tracking;
    state.pressed = NO_SEGMENT;
    segments.changed(self);
    const released = pressedSegment(host, segments, self, args(Argument.First));
    await controls.touch(self, "end", args(Argument.First), args(Argument.Second));
    if (!tracking || released !== pressed || !tapSegment(state, released)) return;
    await controls.dispatch(self, ControlEvent.ValueChanged, args(Argument.Second));
  });
}
export function installSegmentedControls(
  host: SegmentedHost,
  controls: Controls,
): SegmentedControls {
  host.hostClass(SEGMENTED_CLASS, CONTROL_CLASS);
  const segments = new Segments(host);
  initializers(host, segments);
  properties(host, segments);
  contents(host, segments);
  segmentMetrics(host, segments);
  touches(host, segments, controls);
  host.method(SEGMENTED_CLASS, false, "dealloc", async (self) => {
    await segments.destroy(self);
    controls.remove(self);
    await host.deallocateView(self);
  });
  return {
    has: (pointer) => segments.states.has(pointer),
    draw: (pointer, context) => {
      segments.draw(pointer, context);
    },
  };
}
