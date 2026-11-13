import { GeometryField, WORD_BYTES, floatFromBits } from "../abi/scalars";
import { canvasFont, fontLineHeight, type Font, type Fonts } from "./fonts";
import type { Labels, LabelState } from "./label-state";
import { layoutText, TextAlignment } from "./text-layout";
import type { UIKitHost } from "./host";

const FIT_ITERATIONS = 16;
const HALF = 2;
const COLOR_CHANNEL_MAX = 255;
const ColorField = { Red: 1, Green: 2, Blue: 3, Alpha: 4 } as const;
export const MAX_TEXT_EXTENT = 8192;
export class LabelDrawing {
  private context: CanvasRenderingContext2D | undefined;
  constructor(
    private readonly host: UIKitHost,
    private readonly labels: Labels,
    private readonly fonts: Fonts,
  ) {}
  measure(
    text: string,
    font: Font,
    width: number,
    height: number,
    state: Pick<LabelState, "mode" | "lines">,
  ): [number, number] {
    const context = this.measurementContext();
    context.font = canvasFont(font);
    const measure = (value: string): number => context.measureText(value).width;
    const lines = layoutText(text, width, state.mode, state.lines, measure);
    return [
      Math.min(width, Math.max(0, ...lines.map(measure))),
      Math.min(height, lines.length * fontLineHeight(font)),
    ];
  }
  private measurementContext(): CanvasRenderingContext2D {
    if (!this.context) {
      const context = this.host.document?.createElement("canvas").getContext("2d");
      if (!context) throw new Error("UIKit text measurement requires a browser canvas.");
      this.context = context;
    }
    return this.context;
  }
  private fittedFont(
    context: CanvasRenderingContext2D,
    state: LabelState,
    text: string,
    width: number,
  ): Font {
    const font = this.fonts.get(state.font);
    context.font = canvasFont(font);
    if (!state.adjusts || state.lines !== 1 || context.measureText(text).width <= width)
      return font;
    let low = Math.min(font.size, Math.max(1, state.minimumSize)),
      high = font.size;
    for (let iteration = 0; iteration < FIT_ITERATIONS; iteration++) {
      const size = (low + high) / HALF;
      context.font = canvasFont({ ...font, size });
      if (context.measureText(text).width <= width) low = size;
      else high = size;
    }
    return { ...font, size: low };
  }
  private color(pointer: number): string {
    if (!pointer) return "black";
    const channel = (field: number): number =>
      Math.min(1, Math.max(0, floatFromBits(this.host.read(pointer + field * WORD_BYTES))));
    return `rgba(${channel(ColorField.Red) * COLOR_CHANNEL_MAX},${channel(ColorField.Green) * COLOR_CHANNEL_MAX},${channel(ColorField.Blue) * COLOR_CHANNEL_MAX},${channel(ColorField.Alpha)})`;
  }
  draw(self: number, context: CanvasRenderingContext2D): void {
    const state = this.labels.get(self);
    const text = state.text ? this.host.text(state.text) : "";
    const [x, y, width, height] = this.host.view(self).bounds;
    if (!text || width <= 0 || height <= 0) return;
    const font = this.fittedFont(context, state, text, width);
    context.save();
    try {
      context.beginPath();
      context.rect(x, y, width, height);
      context.clip();
      context.font = canvasFont(font);
      const lineHeight = fontLineHeight(font);
      const lines = layoutText(
        text,
        width,
        state.mode,
        state.lines,
        (value) => context.measureText(value).width,
      );
      const offset =
        state.alignment === TextAlignment.Center
          ? width / HALF
          : state.alignment === TextAlignment.Right
            ? width
            : 0;
      context.textAlign =
        state.alignment === TextAlignment.Center
          ? "center"
          : state.alignment === TextAlignment.Right
            ? "right"
            : "left";
      context.textBaseline = "middle";
      context.fillStyle = this.color(
        state.highlighted && state.highlightedColor ? state.highlightedColor : state.color,
      );
      const top = y + (height - Math.min(height, lines.length * lineHeight)) / HALF;
      lines.forEach((line, index) =>
        context.fillText(line, x + offset, top + index * lineHeight + lineHeight / HALF),
      );
    } finally {
      context.restore();
    }
  }
  fit(self: number): void {
    const state = this.labels.get(self);
    const text = state.text ? this.host.text(state.text) : "";
    const [width, height] = this.measure(
      text,
      this.fonts.get(state.font),
      MAX_TEXT_EXTENT,
      MAX_TEXT_EXTENT,
      state,
    );
    const frame = this.host.view(self).frame;
    this.host.setFrame(self, [frame[GeometryField.X], frame[GeometryField.Y], width, height]);
  }
}
