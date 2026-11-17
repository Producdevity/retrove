import { describe, expect, it } from "vite-plus/test";
import {
  BarItemStyle,
  BarSystemItem,
  ToolbarMetric,
  barItemState,
  effectiveStyle,
  itemAt,
  layoutItems,
  systemGlyph,
  systemTitle,
} from "./model";

describe("toolbar layout", () => {
  it("shares the remaining width between flexible spaces", () => {
    const placed = layoutItems(
      [
        { pointer: 1, width: 60, flexible: false, space: false },
        { pointer: 2, width: 0, flexible: true, space: true },
        { pointer: 3, width: 40, flexible: false, space: false },
      ],
      320,
    );
    const share = 320 - 2 * ToolbarMetric.Margin - 2 * ToolbarMetric.Gap - 100;
    expect(placed).toEqual([
      { pointer: 1, x: ToolbarMetric.Margin, width: 60 },
      { pointer: 2, x: ToolbarMetric.Margin + 60 + ToolbarMetric.Gap, width: share },
      { pointer: 3, x: 320 - ToolbarMetric.Margin - 40, width: 40 },
    ]);
    expect(itemAt(placed, new Set([2]), 300)).toBe(3);
    expect(itemAt(placed, new Set([2]), 160)).toBe(0);
  });
  it("draws system words bordered and maps icons to symbols", () => {
    expect(systemTitle(BarSystemItem.Done)).toBe("Done");
    expect(systemGlyph(BarSystemItem.Refresh)).toBe("↻");
    expect(effectiveStyle({ ...barItemState(), system: BarSystemItem.Done })).toBe(
      BarItemStyle.Done,
    );
    expect(effectiveStyle({ ...barItemState(), system: BarSystemItem.Cancel })).toBe(
      BarItemStyle.Bordered,
    );
    expect(effectiveStyle({ ...barItemState(), system: BarSystemItem.Play })).toBe(
      BarItemStyle.Plain,
    );
  });
});
