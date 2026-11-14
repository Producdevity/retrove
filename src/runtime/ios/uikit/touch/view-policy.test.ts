import { expect, test } from "vite-plus/test";
import { touchConflict, type TouchViewState } from "./view-policy";
import { DropReason } from "../../../diagnostics/input-metrics";
test("exclusive touches block other views in both directions while allowing multitouch on their owner", () => {
  const states = new Map<number, TouchViewState>([
    [1, { interactive: true, multi: true, exclusive: true }],
    [2, { interactive: true, multi: false, exclusive: false }],
    [3, { interactive: true, multi: false, exclusive: false }],
  ]);
  const state = (pointer: number) => {
    const value = states.get(pointer);
    if (!value) throw new Error("Unknown view");
    return value;
  };
  expect(touchConflict(state, 2, [1])).toBe(DropReason.Exclusive);
  expect(touchConflict(state, 1, [2])).toBe(DropReason.Exclusive);
  expect(touchConflict(state, 1, [1])).toBeUndefined();
  expect(touchConflict(state, 2, [2])).toBe(DropReason.Occupied);
  expect(touchConflict(state, 2, [3])).toBeUndefined();
});
