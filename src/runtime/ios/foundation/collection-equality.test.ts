import { expect, test } from "vite-plus/test";
import type { HostMethod } from "../objc/host";
import { installCollectionEquality } from "./collection-equality";
type Value =
  | { kind: "text"; text: string }
  | { kind: "array"; items: number[] }
  | { kind: "dictionary"; entries: [number, number][] };
function fixture() {
  const values = new Map<number, Value>();
  let next = 1;
  const methods = new Map<string, HostMethod>();
  const add = (value: Value) => {
    const pointer = next++;
    values.set(pointer, value);
    return pointer;
  };
  const array = (pointer: number) => {
    const value = values.get(pointer);
    return value?.kind === "array" ? value.items : [];
  };
  const entries = (pointer: number) => {
    const value = values.get(pointer);
    return value?.kind === "dictionary" ? value.entries : [];
  };
  installCollectionEquality({
    method: (type, _meta, selector, method) => {
      methods.set(`${type}:${selector}`, method);
    },
    isKind: (pointer, name) =>
      values.get(pointer)?.kind === (name === "NSDictionary" ? "dictionary" : "array"),
    entries,
    items: array,
    send: (left, _selector, args) => {
      const a = values.get(left),
        b = values.get(args[0] ?? 0);
      return Promise.resolve(Number(a?.kind === "text" && b?.kind === "text" && a.text === b.text));
    },
  });
  const equal = async (left: number, right: number, selector = "isEqual:") => {
    const type = values.get(left)?.kind === "dictionary" ? "NSDictionary" : "NSArray";
    const method = methods.get(`${type}:${selector}`);
    if (!method) throw new Error("Missing equality method");
    return method(left, () => right);
  };
  return { add, equal, array, entries };
}
test("dictionary equality compares copied keys and nested collections regardless of insertion order", async () => {
  const x = fixture(),
    key = x.add({ kind: "text", text: "score" }),
    copy = x.add({ kind: "text", text: "score" }),
    a = x.add({ kind: "text", text: "two" }),
    b = x.add({ kind: "text", text: "two" });
  const extra = x.add({ kind: "text", text: "level" }),
    extraCopy = x.add({ kind: "text", text: "level" });
  const first = x.add({
    kind: "dictionary",
    entries: [
      [key, x.add({ kind: "array", items: [a] })],
      [extra, a],
    ],
  });
  const other = x.add({
    kind: "dictionary",
    entries: [
      [extraCopy, b],
      [copy, x.add({ kind: "array", items: [b] })],
    ],
  });
  expect(await x.equal(first, other, "isEqualToDictionary:")).toBe(1);
  expect(await x.equal(first, first)).toBe(1);
  expect(await x.equal(first, 0)).toBe(0);
  expect(x.entries(first)).toHaveLength(2);
  expect(x.entries(other)).toHaveLength(2);
  const mismatched = x.add({ kind: "dictionary", entries: [[a, copy]] });
  expect(await x.equal(first, mismatched)).toBe(0);
});
test("array equality preserves ordering and distinguishes collection types", async () => {
  const x = fixture(),
    a = x.add({ kind: "text", text: "a" }),
    b = x.add({ kind: "text", text: "b" });
  const left = x.add({ kind: "array", items: [a, b] }),
    right = x.add({ kind: "array", items: [b, a] });
  expect(await x.equal(left, right, "isEqualToArray:")).toBe(0);
  expect(await x.equal(left, x.add({ kind: "array", items: [a, b] }))).toBe(1);
  expect(await x.equal(left, x.add({ kind: "dictionary", entries: [] }))).toBe(0);
  expect(x.array(left)).toEqual([a, b]);
});
