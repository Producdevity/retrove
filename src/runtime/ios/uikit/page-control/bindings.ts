import { Argument } from "../../objc/host";
import { GeometryField, WORD_BYTES, floatBits } from "../../abi/scalars";
import { CONTROL_CLASS, type ControlHost, type Controls } from "../control-host";
import { ControlEvent } from "../control-actions";
import { structureMethod } from "../host";
import {
  PageIndicator,
  indicatorsVisible,
  indicatorsWidth,
  pageControlState,
  setCurrentPage,
  setPages,
  tapPage,
  type PageControlState,
} from "./model";

const PAGE_CONTROL_CLASS = "UIPageControl";
const INDICATOR_COLOR = "#ffffff";
const FULL_TURN = Math.PI + Math.PI;
export interface PageControlHost extends ControlHost {
  touchPoint(touches: number, view: number): readonly [number, number] | undefined;
}
export interface PageControls {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): void;
}
function draw(
  state: PageControlState,
  bounds: readonly number[],
  context: CanvasRenderingContext2D,
): void {
  if (!indicatorsVisible(state)) return;
  const [x = 0, y = 0, width = 0, height = 0] = bounds,
    radius = PageIndicator.Diameter * PageIndicator.Half,
    centerY = y + height * PageIndicator.Half;
  let centerX = x + (width - indicatorsWidth(state.pages)) * PageIndicator.Half + radius;
  context.save();
  try {
    context.fillStyle = INDICATOR_COLOR;
    for (let page = 0; page < state.pages; page++) {
      context.globalAlpha = page === state.displayed ? 1 : PageIndicator.InactiveOpacity;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, FULL_TURN);
      context.fill();
      centerX += PageIndicator.Diameter + PageIndicator.Gap;
    }
  } finally {
    context.restore();
  }
}
function properties(
  host: PageControlHost,
  get: (self: number) => PageControlState,
  changed: (self: number) => void,
): void {
  host.method(PAGE_CONTROL_CLASS, false, "numberOfPages", (self) => get(self).pages);
  host.method(PAGE_CONTROL_CLASS, false, "setNumberOfPages:", (self, args) => {
    setPages(get(self), args(Argument.First));
    changed(self);
  });
  host.method(PAGE_CONTROL_CLASS, false, "currentPage", (self) => get(self).current);
  host.method(PAGE_CONTROL_CLASS, false, "setCurrentPage:", (self, args) => {
    setCurrentPage(get(self), args(Argument.First));
    changed(self);
  });
  for (const [getter, setter, field] of [
    ["hidesForSinglePage", "setHidesForSinglePage:", "hidesForSinglePage"],
    ["defersCurrentPageDisplay", "setDefersCurrentPageDisplay:", "defersDisplay"],
  ] as const) {
    host.method(PAGE_CONTROL_CLASS, false, getter, (self) => Number(get(self)[field]));
    host.method(PAGE_CONTROL_CLASS, false, setter, (self, args) => {
      get(self)[field] = Boolean(args(Argument.First));
      changed(self);
    });
  }
  host.method(PAGE_CONTROL_CLASS, false, "updateCurrentPageDisplay", (self) => {
    const state = get(self);
    state.displayed = state.current;
    changed(self);
  });
  host.structure(
    PAGE_CONTROL_CLASS,
    false,
    "sizeForNumberOfPages:",
    structureMethod((_self, args, destination) => {
      host.write(destination, floatBits(indicatorsWidth(Math.max(0, args(Argument.First)))));
      host.write(destination + WORD_BYTES, floatBits(PageIndicator.Height));
    }),
  );
}
export function installPageControls(host: PageControlHost, controls: Controls): PageControls {
  host.hostClass(PAGE_CONTROL_CLASS, CONTROL_CLASS);
  const states = new Map<number, PageControlState>();
  const get = (self: number): PageControlState => {
    let state = states.get(self);
    if (!state) {
      state = pageControlState();
      states.set(self, state);
    }
    return state;
  };
  const changed = (self: number): void => {
    controls.changed(self);
  };
  properties(host, get, changed);
  host.method(PAGE_CONTROL_CLASS, false, "touchesEnded:withEvent:", async (self, args) => {
    const touches = args(Argument.First),
      point = host.touchPoint(touches, self),
      control = controls.get(self),
      tracking = control.tracking;
    await controls.touch(self, "end", touches, args(Argument.Second));
    const bounds = host.view(self).bounds;
    if (!tracking || !point || !control.inside) return;
    if (!tapPage(get(self), point[0] - bounds[GeometryField.X], bounds[GeometryField.Width]))
      return;
    changed(self);
    await controls.dispatch(self, ControlEvent.ValueChanged, args(Argument.Second));
  });
  host.method(PAGE_CONTROL_CLASS, false, "dealloc", async (self) => {
    states.delete(self);
    controls.remove(self);
    await host.deallocateView(self);
  });
  return {
    has: (pointer) => states.has(pointer),
    draw: (pointer, context) => {
      const state = states.get(pointer);
      if (state) draw(state, host.view(pointer).bounds, context);
    },
  };
}
