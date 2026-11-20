import { expect, test } from "vite-plus/test";
import { MaxCallDepth } from "./emit-depth";
import { HostCalls } from "./host-calls";
import { StopState, stateLayout } from "./layout";

const layout = stateLayout(0x100, { arena: 0, mask: 0xffff }, { base: 0x800, start: 0, end: 0 });
const GATE = 0x4000_0448,
  RETURN_ADDRESS = 0x1235;

function setup(depth = 3) {
  const view = new DataView(new ArrayBuffer(0x1000));
  view.setUint32(layout.depth, depth, true);
  view.setInt32(layout.budget, 500, true);
  const calls = new HostCalls(
    () => view,
    () => layout,
  );
  return { view, calls };
}

test("without a handler every gate leaves translated code", () => {
  expect(setup().calls.call(GATE)).toBe(0);
});

test("a completed call continues at its PC with the run's control words intact", () => {
  const { view, calls } = setup();
  const depths: number[] = [];
  calls.handler = (pc) => {
    expect(pc).toBe(GATE);
    depths.push(calls.baseDepth);
    // Guest code the host ran on this stack moved the control words.
    view.setUint32(layout.depth, 0, true);
    view.setInt32(layout.budget, 7, true);
    view.setUint32(layout.stopped, StopState.Budget, true);
    return RETURN_ADDRESS;
  };
  expect(calls.call(GATE)).toBe(RETURN_ADDRESS);
  expect(depths).toEqual([3]);
  expect(calls.baseDepth).toBe(0);
  expect(view.getUint32(layout.depth, true)).toBe(3);
  expect(view.getInt32(layout.budget, true)).toBe(500);
  expect(view.getUint32(layout.stopped, true)).toBe(StopState.Running);
});

test("a call the host cannot finish in place leaves at the gate", () => {
  const { calls } = setup();
  calls.handler = () => undefined;
  expect(calls.call(GATE)).toBe(0);
  expect(calls.baseDepth).toBe(0);
});

test("deep stacks leave at the gate so nested guest code keeps room", () => {
  const { calls } = setup(MaxCallDepth);
  let called = false;
  calls.handler = () => {
    called = true;
    return RETURN_ADDRESS;
  };
  expect(calls.call(GATE)).toBe(0);
  expect(called).toBe(false);
});

test("an exception still restores the base depth", () => {
  const { calls } = setup();
  calls.handler = () => {
    throw new Error("host failed");
  };
  expect(() => calls.call(GATE)).toThrow("host failed");
  expect(calls.baseDepth).toBe(0);
});
