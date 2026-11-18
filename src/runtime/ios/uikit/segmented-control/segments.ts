import { GeometryField } from "../../abi/scalars";
import type { ControlHost } from "../control-host";
import { SEGMENT_FONT, drawSegmented, type SegmentPaint } from "./drawing";
import {
  NO_SEGMENT,
  controlHeight,
  fittedWidth,
  segment,
  segmentWidths,
  segmentedState,
  validIndex,
  type Segment,
  type SegmentedState,
} from "./model";

export interface SegmentedHost extends ControlHost {
  elements(array: number): readonly number[];
  isString(pointer: number): boolean;
  touchPoint(touches: number, view: number): readonly [number, number] | undefined;
  rgba(color: number): readonly number[] | undefined;
  imageSize(image: number): readonly [number, number];
  drawImage(
    image: number,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}

/** Segmented control state, sizing and drawing. */
export class Segments {
  readonly states = new Map<number, SegmentedState>();
  #measurer: CanvasRenderingContext2D | undefined;
  constructor(private readonly host: SegmentedHost) {}
  get(self: number): SegmentedState {
    let state = this.states.get(self);
    if (!state) {
      state = segmentedState();
      this.states.set(self, state);
    }
    return state;
  }
  at(self: number, index: number): Segment {
    const state = this.get(self),
      item = state.segments[index];
    if (!item || !validIndex(state, index))
      throw new Error(`UISegmentedControl segment ${index} is out of bounds.`);
    return item;
  }
  changed(self: number): void {
    const view = this.host.view(self);
    view.needsDisplay = true;
    view.needsLayout = true;
  }
  /** Retains each item; strings become titles and anything else an image. */
  content(item: number): Segment {
    if (!item) return segment(0, 0);
    const retained = this.host.retain(item);
    return this.host.isString(item) ? segment(retained, 0) : segment(0, retained);
  }
  async release(item: Segment): Promise<void> {
    if (item.title) await this.host.release(item.title);
    if (item.image) await this.host.release(item.image);
  }
  private measure(text: string): number {
    this.#measurer ??= this.host.document?.createElement("canvas").getContext("2d") ?? undefined;
    if (!this.#measurer) return 0;
    this.#measurer.font = SEGMENT_FONT;
    return this.#measurer.measureText(text).width;
  }
  private contentWidth(item: Segment): number {
    if (item.width) return item.width;
    if (item.title) return this.measure(this.host.text(item.title));
    return item.image ? this.host.imageSize(item.image)[0] : 0;
  }
  fittedSize(self: number): [number, number] {
    const state = this.get(self);
    return [
      fittedWidth(state.segments.map((item) => this.contentWidth(item))),
      controlHeight(state.style),
    ];
  }
  width(self: number): number {
    return this.host.view(self).bounds[GeometryField.Width] ?? 0;
  }
  draw(self: number, context: CanvasRenderingContext2D): void {
    const state = this.states.get(self);
    if (!state) return;
    const bounds = this.host.view(self).bounds,
      widths = segmentWidths(state.segments, this.width(self));
    let x = 0;
    const segments = state.segments.map((item, index): SegmentPaint => {
      const width = widths[index] ?? 0,
        paint = {
          x,
          width,
          enabled: item.enabled,
          title: item.title ? this.host.text(item.title) : undefined,
          image: item.image || undefined,
          imageSize: item.image ? this.host.imageSize(item.image) : undefined,
        };
      x += width;
      return paint;
    });
    drawSegmented(
      context,
      bounds,
      {
        style: state.style,
        tint: state.tint ? this.host.rgba(state.tint) : undefined,
        selected: state.momentary ? NO_SEGMENT : state.selected,
        pressed: state.pressed,
        segments,
      },
      (image, left, top, width, height) => {
        this.host.drawImage(image, context, left, top, width, height);
      },
    );
  }
  async destroy(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    if (!state) return;
    for (const item of state.segments) await this.release(item);
    if (state.tint) await this.host.release(state.tint);
  }
}
