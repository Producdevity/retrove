import { expect, test } from "vite-plus/test";
import { floatBits } from "../../abi/scalars";
import type { ViewState } from "../host";
import { Pickers } from "./model";
function fixture() {
  let point: readonly [number, number] = [25, 100],
    rows = 100,
    custom = false;
  const selections: number[][] = [],
    view: ViewState = {
      frame: [0, 0, 200, 200],
      bounds: [0, 0, 200, 200],
      interactive: true,
      needsDisplay: false,
      needsLayout: false,
    };
  const pickers = new Pickers({
    view: () => view,
    retain: (p) => p,
    release: async () => {},
    deallocateView: async () => {},
    text: (p) => "Row " + (p - 200),
    touchPoint: () => point,
    responds: () => custom,
    send: async (_pointer, selector, args = []) => {
      if (selector === "numberOfComponentsInPickerView:") return 2;
      if (selector === "pickerView:numberOfRowsInComponent:") return rows;
      if (selector === "pickerView:widthForComponent:") return 0;
      if (selector === "pickerView:rowHeightForComponent:") return floatBits(40);
      if (selector === "pickerView:titleForRow:forComponent:") return 200 + (args[1] ?? 0);
      if (selector === "pickerView:didSelectRow:inComponent:") {
        selections.push(args);
        return;
      }
      throw new Error("Unexpected delegate callback " + selector);
    },
  });
  pickers.get(1).source = 9;
  pickers.get(1).delegate = 8;
  return {
    pickers,
    selections,
    point: (value: readonly [number, number]) => {
      point = value;
    },
    rows: (value: number) => {
      rows = value;
    },
    custom: () => {
      custom = true;
    },
  };
}
test("picker user gestures select within their component, notify once and restore cancelled changes", async () => {
  const x = fixture();
  await x.pickers.load(1);
  await x.pickers.select(1, 4, 1);
  expect(x.selections).toEqual([]);
  await x.pickers.touch(1, "begin", 0);
  x.point([25, 20]);
  await x.pickers.touch(1, "move", 0);
  expect(x.pickers.get(1).components[0]?.selected).toBe(2);
  await x.pickers.touch(1, "end", 0);
  expect(x.selections).toEqual([[1, 2, 0]]);
  expect(x.pickers.get(1).components[1]?.selected).toBe(4);
  x.point([25, 100]);
  await x.pickers.touch(1, "begin", 0);
  x.point([25, 180]);
  await x.pickers.touch(1, "move", 0);
  await x.pickers.touch(1, "cancel", 0);
  expect(x.pickers.get(1).components[0]?.selected).toBe(2);
  expect(x.selections).toHaveLength(1);
  x.point([25, 140]);
  await x.pickers.touch(1, "begin", 0);
  await x.pickers.touch(1, "end", 0);
  expect(x.selections.at(-1)).toEqual([1, 3, 0]);
});
test("picker reloads clamp old selections and lazy row titles have bounded storage", async () => {
  const x = fixture();
  await x.pickers.load(1);
  for (let row = 0; row < 100; row++) expect(await x.pickers.title(1, row, 0)).toBe("Row " + row);
  expect(x.pickers.get(1).components[0]?.titles.size).toBeLessThanOrEqual(64);
  await x.pickers.select(1, 90, 0);
  x.rows(2);
  x.pickers.invalidate(1);
  await x.pickers.load(1);
  expect(x.pickers.get(1).components[0]?.selected).toBe(1);
  expect(x.selections).toEqual([]);
  x.custom();
  await expect(x.pickers.title(1, 0, 0)).rejects.toThrow(/custom row views/);
});
