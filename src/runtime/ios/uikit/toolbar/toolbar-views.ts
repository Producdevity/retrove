import { GeometryField } from "../../abi/scalars";
import type { UIKitHost } from "../host";
import type { BarItems } from "./bar-items";
import { GLYPH_FONT, TITLE_FONT, drawToolbar, type ItemPaint } from "./drawing";
import {
  BarItemStyle,
  BarStyle,
  BarSystemItem,
  ToolbarMetric,
  effectiveStyle,
  isSpace,
  itemAt,
  layoutItems,
  systemGlyph,
  systemTitle,
  type BarItemState,
  type MeasuredItem,
  type PlacedItem,
} from "./model";

/** Padding applies on both sides of an item. */
const SIDES = 2;
export interface ToolbarHost extends UIKitHost {
  elements(array: number): readonly number[];
  touchPoint(touches: number, view: number): readonly [number, number] | undefined;
  selectorName(pointer: number): string;
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
export interface ToolbarState {
  items: number;
  style: number;
  tint: number;
  pressed: number;
  placed: PlacedItem[];
}

/** Toolbar state, item layout, hit testing and drawing. */
export class ToolbarViews {
  readonly states = new Map<number, ToolbarState>();
  #measurer: CanvasRenderingContext2D | undefined;
  constructor(
    private readonly host: ToolbarHost,
    private readonly items: BarItems,
  ) {}
  get(self: number): ToolbarState {
    let state = this.states.get(self);
    if (!state) {
      state = { items: 0, style: BarStyle.Default, tint: 0, pressed: 0, placed: [] };
      this.states.set(self, state);
    }
    return state;
  }
  item(pointer: number): BarItemState | undefined {
    return this.items.get(pointer);
  }
  elements(self: number): readonly number[] {
    const array = this.states.get(self)?.items;
    return array ? this.host.elements(array) : [];
  }
  changed(self: number): void {
    const view = this.host.view(self);
    view.needsDisplay = true;
    view.needsLayout = true;
  }
  itemChanged(item: number): void {
    for (const toolbar of this.states.keys())
      if (this.elements(toolbar).includes(item)) {
        this.layout(toolbar);
        this.changed(toolbar);
      }
  }
  private measure(text: string, font: string): number {
    this.#measurer ??= this.host.document?.createElement("canvas").getContext("2d") ?? undefined;
    if (!this.#measurer) return 0;
    this.#measurer.font = font;
    return this.#measurer.measureText(text).width;
  }
  private width(item: BarItemState): number {
    if (item.width) return item.width;
    if (item.customView) return this.host.view(item.customView).frame[GeometryField.Width] ?? 0;
    const title = item.title ? this.host.text(item.title) : systemTitle(item.system),
      plain = effectiveStyle(item) === BarItemStyle.Plain;
    if (title !== undefined)
      return (
        this.measure(title, TITLE_FONT) +
        SIDES * (plain ? ToolbarMetric.PlainPadding : ToolbarMetric.TitlePadding)
      );
    if (item.image) return this.host.imageSize(item.image)[0] + SIDES * ToolbarMetric.ImagePadding;
    const glyph = systemGlyph(item.system);
    return glyph === undefined
      ? 0
      : Math.max(ToolbarMetric.GlyphWidth, this.measure(glyph, GLYPH_FONT)) +
          SIDES * ToolbarMetric.GlyphPadding;
  }
  /** Places items and moves custom views into their slots. */
  layout(self: number): void {
    const state = this.get(self),
      bounds = this.host.view(self).bounds,
      measured: MeasuredItem[] = this.elements(self).map((pointer) => {
        const item = this.items.get(pointer),
          flexible = item?.system === BarSystemItem.FlexibleSpace;
        return {
          pointer,
          width: item && !flexible ? this.width(item) : 0,
          flexible,
          space: !item || isSpace(item),
        };
      });
    state.placed = layoutItems(measured, bounds[GeometryField.Width] ?? 0);
    const height = bounds[GeometryField.Height] ?? ToolbarMetric.Height;
    for (const placed of state.placed) {
      const custom = this.items.get(placed.pointer)?.customView;
      if (!custom) continue;
      const customHeight = this.host.view(custom).frame[GeometryField.Height] ?? 0;
      this.host.setFrame(custom, [
        placed.x,
        (height - customHeight) * ToolbarMetric.Half,
        placed.width,
        customHeight,
      ]);
    }
  }
  /** The enabled button item under the first touch, or 0. */
  hit(self: number, touches: number): number {
    const point = this.host.touchPoint(touches, self),
      state = this.get(self);
    if (!point) return 0;
    const inactive = new Set(
      state.placed
        .map((placed) => placed.pointer)
        .filter((pointer) => {
          const item = this.items.get(pointer);
          return !item || isSpace(item) || item.customView !== 0 || !item.enabled;
        }),
    );
    return itemAt(
      state.placed,
      inactive,
      point[0] - (this.host.view(self).bounds[GeometryField.X] ?? 0),
    );
  }
  private paints(state: ToolbarState): ItemPaint[] {
    const paints: ItemPaint[] = [];
    for (const placed of state.placed) {
      const item = this.items.get(placed.pointer);
      if (!item || isSpace(item) || item.customView) continue;
      paints.push({
        x: placed.x,
        width: placed.width,
        style: effectiveStyle(item),
        enabled: item.enabled,
        pressed: placed.pointer === state.pressed,
        title: item.title ? this.host.text(item.title) : systemTitle(item.system),
        glyph: systemGlyph(item.system),
        image: item.image || undefined,
        imageSize: item.image ? this.host.imageSize(item.image) : undefined,
      });
    }
    return paints;
  }
  draw(self: number, context: CanvasRenderingContext2D): void {
    const state = this.states.get(self);
    if (!state) return;
    drawToolbar(
      context,
      this.host.view(self).bounds,
      { style: state.style, tint: state.tint ? this.host.rgba(state.tint) : undefined },
      this.paints(state),
      (image, x, y, width, height) => this.host.drawImage(image, context, x, y, width, height),
    );
  }
}
