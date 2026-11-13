import { expect, test } from "vite-plus/test";
import { ThreadAttributes, ThreadDetach, ThreadPolicy } from "./attributes";
test("Darwin thread attributes retain FMOD realtime priorities without rejecting thread creation", () => {
  const attributes = new ThreadAttributes(),
    address = 0x1000;
  expect(attributes.initialize(address)).toBe(0);
  expect(attributes.policy(address, ThreadPolicy.Fifo)).toBe(0);
  expect(attributes.detach(address, ThreadDetach.Detached)).toBe(0);
  expect(attributes.stackSize(address, 8192)).toBe(0);
  for (const priority of [0, 31, 63, 90, 94, 99, -1, 0x7fffffff]) {
    expect(attributes.priority(address, priority)).toBe(0);
    expect(attributes.get(address)).toEqual({ size: 8192, detached: true, policy: 4, priority });
  }
});
test("invalid attribute updates preserve state and destroyed handles cannot create threads", () => {
  const attributes = new ThreadAttributes(),
    address = 0x1000;
  attributes.initialize(address);
  const before = attributes.get(address);
  for (const size of [0, 8191, 0xffffffff, NaN, 8192.5])
    expect(attributes.stackSize(address, size)).toBe(22);
  expect(attributes.policy(address, 0)).toBe(22);
  expect(attributes.detach(address, 3)).toBe(22);
  expect(attributes.get(address)).toEqual(before);
  expect(attributes.destroy(address)).toBe(0);
  expect(attributes.has(address)).toBe(false);
  expect(attributes.priority(address, 90)).toBe(22);
  expect(attributes.destroy(address)).toBe(22);
  expect(attributes.get(address)).toBeUndefined();
});
