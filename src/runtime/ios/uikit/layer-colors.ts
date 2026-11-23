import type { UIKitHost, ViewState } from "./host";
import type { RGBA } from "../../graphics/core-graphics/colors/model";
import { floatFromBits } from "../abi/scalars";
const COLOR_MAXIMUM = 255;
const STROKE_CENTER = 0.5;
interface LayerColors extends ViewState {
  layerBackgroundColor?: number | undefined;
  borderColor?: number | undefined;
  borderWidth?: number | undefined;
}
interface LayerColorHost extends Pick<UIKitHost, "method"> {
  view(pointer: number): LayerColors;
  rgba(pointer: number): RGBA | undefined;
  retainColor(pointer: number): number;
  releaseColor(pointer: number): Promise<void>;
}
export function installLayerColors(host: LayerColorHost): void {
  for (const [getter, setter, field] of [
    ["backgroundColor", "setBackgroundColor:", "layerBackgroundColor"],
    ["borderColor", "setBorderColor:", "borderColor"],
  ] as const) {
    host.method("CALayer", false, getter, (self) => host.view(self)[field] ?? 0);
    host.method("CALayer", false, setter, async (self, args) => {
      const pointer = args(0);
      if (pointer && !host.rgba(pointer)) throw new Error("Invalid CALayer color.");
      const state = host.view(self),
        previous = state[field];
      state[field] = host.retainColor(pointer);
      state.needsDisplay = true;
      if (previous) await host.releaseColor(previous);
    });
  }
}
export function cssColor([red, green, blue, alpha]: RGBA): string {
  return `rgba(${red * COLOR_MAXIMUM},${green * COLOR_MAXIMUM},${blue * COLOR_MAXIMUM},${alpha})`;
}
export function drawLayerBackground(
  context: CanvasRenderingContext2D,
  state: LayerColors,
  rgba: (pointer: number) => RGBA | undefined,
  background?: RGBA,
): void {
  const fill = state.layerBackgroundColor ? rgba(state.layerBackgroundColor) : background;
  const [x, y, width, height] = state.bounds;
  if (fill) {
    context.save();
    try {
      context.fillStyle = cssColor(fill);
      context.fillRect(x, y, width, height);
    } finally {
      context.restore();
    }
  }
}
export function drawLayerBorder(
  context: CanvasRenderingContext2D,
  state: LayerColors,
  rgba: (pointer: number) => RGBA | undefined,
): void {
  const [x, y, width, height] = state.bounds;
  const border = state.borderColor ? rgba(state.borderColor) : undefined,
    line = state.borderWidth ? floatFromBits(state.borderWidth) : 0;
  if (border && line > 0) {
    context.save();
    try {
      context.strokeStyle = cssColor(border);
      context.lineWidth = line;
      context.strokeRect(
        x + line * STROKE_CENTER,
        y + line * STROKE_CENTER,
        Math.max(0, width - line),
        Math.max(0, height - line),
      );
    } finally {
      context.restore();
    }
  }
}
