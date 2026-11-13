import { expect, test } from "vite-plus/test";
import { ControlActions, ControlEvent } from "./control-actions";
test("merges target actions and removes only selected event bits", async () => {
  const actions = new ControlActions(),
    calls: number[] = [];
  actions.add(10, 20, ControlEvent.Down);
  actions.add(10, 20, ControlEvent.UpInside);
  actions.remove(10, 20, ControlEvent.Down);
  await actions.dispatch(ControlEvent.Down, async (target) => {
    calls.push(target);
  });
  await actions.dispatch(ControlEvent.UpInside, async (target) => {
    calls.push(target);
  });
  expect(calls).toEqual([10]);
  expect(actions.events).toBe(ControlEvent.UpInside);
});
test("callbacks can remove pending actions; newly added actions wait for the next event", async () => {
  const actions = new ControlActions(),
    calls: number[] = [];
  actions.add(10, 20, ControlEvent.UpInside);
  actions.add(30, 40, ControlEvent.UpInside);
  await actions.dispatch(ControlEvent.UpInside, async (target) => {
    calls.push(target);
    actions.remove(30, 0, ControlEvent.UpInside);
    actions.add(50, 60, ControlEvent.UpInside);
  });
  expect(calls).toEqual([10]);
  await actions.dispatch(ControlEvent.UpInside, async (target) => {
    calls.push(target);
  });
  expect(calls).toEqual([10, 10, 50]);
});
