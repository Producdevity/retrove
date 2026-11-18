import { describe, expect, it } from "vite-plus/test";
import {
  NO_SEGMENT,
  SegmentMetric,
  fittedWidth,
  insertSegment,
  removeSegment,
  segment,
  segmentAt,
  segmentWidths,
  segmentedState,
  tapSegment,
} from "./model";

function control(count: number) {
  const state = segmentedState();
  for (let index = 0; index < count; index++) state.segments.push(segment(index + 1, 0));
  return state;
}

describe("segmented control model", () => {
  it("shares free width between automatic segments", () => {
    const state = control(3);
    if (state.segments[0]) state.segments[0].width = 100;
    expect(segmentWidths(state.segments, 300)).toEqual([100, 100, 100]);
    expect(segmentWidths(state.segments, 200)).toEqual([100, 50, 50]);
  });
  it("hit tests segments by x", () => {
    const state = control(2);
    expect(segmentAt(state.segments, 200, 50)).toBe(0);
    expect(segmentAt(state.segments, 200, 150)).toBe(1);
    expect(segmentAt(state.segments, 200, 250)).toBe(NO_SEGMENT);
  });
  it("sizes every segment to the widest content", () => {
    expect(fittedWidth([10, 60])).toBe(2 * (60 + SegmentMetric.Padding + SegmentMetric.Padding));
    expect(fittedWidth([])).toBe(0);
  });
  it("only reports a change when the selection moves", () => {
    const state = control(2);
    expect(tapSegment(state, 1)).toBe(true);
    expect(state.selected).toBe(1);
    expect(tapSegment(state, 1)).toBe(false);
    if (state.segments[0]) state.segments[0].enabled = false;
    expect(tapSegment(state, 0)).toBe(false);
  });
  it("reports every tap and keeps no selection when momentary", () => {
    const state = control(2);
    state.momentary = true;
    expect(tapSegment(state, 0)).toBe(true);
    expect(tapSegment(state, 0)).toBe(true);
    expect(state.selected).toBe(NO_SEGMENT);
  });
  it("keeps the selected segment across inserts and removals", () => {
    const state = control(3);
    state.selected = 1;
    insertSegment(state, segment(9, 0), 0);
    expect(state.selected).toBe(2);
    removeSegment(state, 0);
    expect(state.selected).toBe(1);
    removeSegment(state, 1);
    expect(state.selected).toBe(NO_SEGMENT);
  });
});
