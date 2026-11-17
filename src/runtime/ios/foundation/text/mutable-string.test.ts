import { expect, test } from "vite-plus/test";
import type { HostMethod } from "../../objc/host";
import { installMutableStringEdits } from "./mutable-string";

const setup = (initial: string) => {
  const methods = new Map<string, HostMethod>(),
    strings = new Map<number, string>([
      [1, initial],
      [2, "😀"],
    ]);
  installMutableStringEdits({
    method: (_, __, selector, implementation) => methods.set(selector, implementation),
    text: (pointer) => strings.get(pointer) ?? "",
    assign: (self, value) => strings.set(self, value),
  });
  const call = (selector: string, ...args: number[]) => {
    void methods.get(selector)?.(1, (index) => args[index] ?? 0);
  };
  return { call, value: () => strings.get(1) };
};

test("mutable strings edit by UTF-16 ranges", () => {
  const { call, value } = setup("hello world");
  call("deleteCharactersInRange:", 5, 6);
  call("insertString:atIndex:", 2, 0);
  call("replaceCharactersInRange:withString:", 2, 1, 2);
  expect(value()).toBe("😀😀ello");
  expect(value()?.length).toBe(8);
});

test("out-of-range edits throw instead of clamping", () => {
  const { call } = setup("abc");
  expect(() => call("deleteCharactersInRange:", 2, 2)).toThrow("out of bounds");
  expect(() => call("insertString:atIndex:", 2, 4)).toThrow("out of bounds");
});
