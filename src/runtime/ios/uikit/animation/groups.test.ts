import { expect, test } from "vite-plus/test";
import type { HostMethod } from "../../objc/host";
import { installAnimationGroups } from "./groups";
function fixture() {
  let time = 0;
  const methods = new Map<string, HostMethod>(),
    calls: { self: number; name: string; args: number[] }[] = [],
    retained: number[] = [],
    released: number[] = [];
  const groups = installAnimationGroups({
    method: (_cls, _meta, name, fn) => {
      methods.set(name, fn);
    },
    retain: (p) => {
      retained.push(p);
      return p;
    },
    release: async (p) => {
      released.push(p);
    },
    thread: () => 1,
    now: () => time,
    selectorName: (p) => (p === 1 ? "willStart" : "didStop"),
    send: async (self, name, args) => {
      calls.push({ self, name, args });
      return 0;
    },
  });
  return {
    groups,
    calls,
    retained,
    released,
    time: (next: number) => {
      time = next;
    },
    call: async (name: string, ...args: number[]) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(name);
      return fn(0, (i) => args[i] ?? 0);
    },
  };
}
test("animation commits keep callback arguments alive and deliver completion after duration", async () => {
  const x = fixture();
  await x.call("beginAnimations:context:", 10, 20);
  await x.call("setAnimationDelegate:", 30);
  await x.call("setAnimationWillStartSelector:", 1);
  await x.call("setAnimationDidStopSelector:", 2);
  const context = x.groups.context();
  expect(context?.duration).toBe(0.2);
  await x.call("commitAnimations");
  expect(x.calls).toEqual([{ self: 30, name: "willStart", args: [10, 20] }]);
  x.time(199);
  await x.groups.pump();
  expect(x.groups.pending()).toBe(true);
  expect(x.released).not.toContain(30);
  x.time(200);
  await x.groups.pump();
  expect(x.calls.at(-1)).toEqual({ self: 30, name: "didStop", args: [10, 1, 20] });
  expect(x.released).toContain(10);
  expect(x.released).toContain(30);
  expect(x.groups.pending()).toBe(false);
});
test("nested animation contexts restore parents and reject unbalanced commits", async () => {
  const x = fixture();
  await x.call("beginAnimations:context:", 0, 0);
  const outer = x.groups.context();
  await x.call("beginAnimations:context:", 0, 0);
  expect(x.groups.context()).not.toBe(outer);
  await x.call("commitAnimations");
  expect(x.groups.context()).toBe(outer);
  await x.call("commitAnimations");
  expect(x.groups.context()).toBeUndefined();
  await expect(x.call("commitAnimations")).rejects.toThrow("Unbalanced");
});
