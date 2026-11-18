/** UISegmentedControlStyle. */
export const SegmentedStyle = { Plain: 0, Bordered: 1, Bar: 2, Bezeled: 3 } as const;
/** UISegmentedControlNoSegment. */
export const NO_SEGMENT = -1;
export const SegmentMetric = {
  Height: 44,
  BarHeight: 30,
  BezeledHeight: 40,
  Padding: 10,
  MinimumWidth: 44,
  Half: 0.5,
} as const;

export interface Segment {
  title: number;
  image: number;
  /** Zero sizes the segment automatically. */
  width: number;
  enabled: boolean;
}
export interface SegmentedState {
  segments: Segment[];
  selected: number;
  momentary: boolean;
  style: number;
  tint: number;
  pressed: number;
}
export function segmentedState(): SegmentedState {
  return {
    segments: [],
    selected: NO_SEGMENT,
    momentary: false,
    style: SegmentedStyle.Plain,
    tint: 0,
    pressed: NO_SEGMENT,
  };
}
export function segment(title: number, image: number): Segment {
  return { title, image, width: 0, enabled: true };
}
export function controlHeight(style: number): number {
  if (style === SegmentedStyle.Bar) return SegmentMetric.BarHeight;
  if (style === SegmentedStyle.Bezeled) return SegmentMetric.BezeledHeight;
  return SegmentMetric.Height;
}
export function validIndex(state: SegmentedState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.segments.length;
}
/** Fixed widths are kept; automatic segments share the remaining width equally. */
export function segmentWidths(segments: readonly Segment[], total: number): number[] {
  const fixed = segments.reduce((sum, item) => sum + item.width, 0),
    automatic = segments.filter((item) => !item.width).length,
    share = automatic ? Math.max(0, total - fixed) / automatic : 0;
  return segments.map((item) => item.width || share);
}
export function segmentAt(segments: readonly Segment[], total: number, x: number): number {
  let left = 0;
  for (const [index, width] of segmentWidths(segments, total).entries()) {
    if (x >= left && x < left + width) return index;
    left += width;
  }
  return NO_SEGMENT;
}
/** Every segment is as wide as the widest content so the control stays even. */
export function fittedWidth(contentWidths: readonly number[]): number {
  const widest = Math.max(
    SegmentMetric.MinimumWidth,
    ...contentWidths.map((width) => width + SegmentMetric.Padding + SegmentMetric.Padding),
  );
  return contentWidths.length * widest;
}
/** Returns whether a tap on `index` sends UIControlEventValueChanged. */
export function tapSegment(state: SegmentedState, index: number): boolean {
  if (!validIndex(state, index) || !state.segments[index]?.enabled) return false;
  if (state.momentary) return true;
  if (state.selected === index) return false;
  state.selected = index;
  return true;
}
export function insertSegment(state: SegmentedState, item: Segment, index: number): void {
  const at = Math.max(0, Math.min(index | 0, state.segments.length));
  state.segments.splice(at, 0, item);
  if (state.selected >= at) state.selected += 1;
}
/** Returns the removed segment so the caller can release its contents. */
export function removeSegment(state: SegmentedState, index: number): Segment | undefined {
  if (!validIndex(state, index)) return undefined;
  const [removed] = state.segments.splice(index, 1);
  if (state.selected === index) state.selected = NO_SEGMENT;
  else if (state.selected > index) state.selected -= 1;
  return removed;
}
