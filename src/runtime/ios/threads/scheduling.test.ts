import { expect, test } from "vite-plus/test";
import { Scheduling, SchedulingChoice, resolveScheduling } from "./scheduling";

test("a game's preset applies unless the tester forces a scheduling", () => {
  expect(resolveScheduling(undefined, SchedulingChoice.Game)).toBe(Scheduling.Slices);
  expect(resolveScheduling(Scheduling.Blocks, SchedulingChoice.Game)).toBe(Scheduling.Blocks);
  expect(resolveScheduling(Scheduling.Blocks, SchedulingChoice.Slices)).toBe(Scheduling.Slices);
  expect(resolveScheduling(undefined, SchedulingChoice.Blocks)).toBe(Scheduling.Blocks);
});
