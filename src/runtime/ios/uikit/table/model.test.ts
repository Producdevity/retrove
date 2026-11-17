import { expect, test } from "vite-plus/test";
import { compareIndexes } from "../../foundation/index-paths";
import {
  ScrollPosition,
  TableStyle,
  defaultTitleHeight,
  layoutTable,
  rowAt,
  rowsBetween,
  scrollOffset,
} from "./model";

const layout = layoutTable(
  [
    { rows: [44, 44, 60], header: 22, footer: 0 },
    { rows: [], header: 22, footer: 10 },
    { rows: [30], header: 0, footer: 0 },
  ],
  50,
  20,
);

test("sections stack below the table header with rows after each section header", () => {
  expect(layout.sections.map((section) => section.offsets)).toEqual([[72, 116, 160], [], [252]]);
  expect(layout.sections.map((section) => [section.top, section.bottom])).toEqual([
    [50, 220],
    [220, 252],
    [252, 282],
  ]);
  expect(layout.height).toBe(302);
});
test("visible rows are the ones that intersect the viewport", () => {
  expect(rowsBetween(layout, 100, 170).map((row) => [row.section, row.row])).toEqual([
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
  expect(rowsBetween(layout, 220, 252)).toEqual([]);
  expect(rowAt(layout, 116)).toEqual({ section: 0, row: 1, top: 116, height: 44 });
  expect(rowAt(layout, 60)).toBeUndefined();
  expect(rowAt(layout, 281)?.section).toBe(2);
});
test("scroll positions place the row at the top, middle, bottom or minimally", () => {
  const row = { section: 0, row: 2, top: 160, height: 60 };
  expect(scrollOffset(row, ScrollPosition.Top, 0, 100)).toBe(160);
  expect(scrollOffset(row, ScrollPosition.Middle, 0, 100)).toBe(140);
  expect(scrollOffset(row, ScrollPosition.Bottom, 0, 100)).toBe(120);
  expect(scrollOffset(row, ScrollPosition.None, 0, 100)).toBe(120);
  expect(scrollOffset(row, ScrollPosition.None, 200, 100)).toBe(160);
  expect(scrollOffset(row, ScrollPosition.None, 150, 100)).toBe(150);
});
test("title heights follow the table style", () => {
  expect(defaultTitleHeight(TableStyle.Plain, false, undefined)).toBe(0);
  expect(defaultTitleHeight(TableStyle.Plain, false, "A")).toBe(22);
  expect(defaultTitleHeight(TableStyle.Grouped, false, undefined)).toBe(10);
  expect(defaultTitleHeight(TableStyle.Grouped, false, "A")).toBe(46);
  expect(defaultTitleHeight(TableStyle.Grouped, true, "A")).toBe(30);
});
test("index paths compare by position, then by length", () => {
  expect(compareIndexes([0, 1], [0, 2])).toBe(-1);
  expect(compareIndexes([1, 0], [0, 9])).toBe(1);
  expect(compareIndexes([0, 1], [0, 1])).toBe(0);
  expect(compareIndexes([0], [0, 1])).toBe(-1);
});
