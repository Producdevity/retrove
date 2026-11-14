import { expect, test } from "vite-plus/test";
import { appendPathExtension, pathComponents, pathWithComponents } from "./paths";

const foundationCases: [string, string, string | null][] = [
  ["", "txt", null],
  ["", "", ""],
  ["", "a/b", null],
  ["", ".x", null],
  ["/", "txt", null],
  ["/", "", "/"],
  ["/", "a/b", null],
  ["/", ".x", null],
  ["//", "txt", null],
  ["//", "", "//"],
  ["//", "a/b", null],
  ["//", ".x", null],
  ["/tmp/", "txt", "/tmp.txt"],
  ["/tmp/", "", "/tmp/"],
  ["/tmp/", "a/b", null],
  ["/tmp/", ".x", "/tmp..x"],
  ["scratch.old", "txt", "scratch.old.txt"],
  ["scratch.old", "", "scratch.old"],
  ["scratch.old", "a/b", null],
  ["scratch.old", ".x", "scratch.old..x"],
  [".hidden", "txt", ".hidden.txt"],
  [".hidden", "", ".hidden"],
  [".hidden", "a/b", null],
  [".hidden", ".x", ".hidden..x"],
  ["~", "txt", "~.txt"],
  ["~", "", "~"],
  ["~", "a/b", null],
  ["~", ".x", "~..x"],
  ["~/", "txt", "~.txt"],
  ["~/", "", "~/"],
  ["~/", "a/b", null],
  ["~/", ".x", "~..x"],
  ["~foo", "txt", "~foo.txt"],
  ["~foo", "", "~foo"],
  ["~foo", "a/b", null],
  ["~foo", ".x", "~foo..x"],
  ["a//b/", "txt", "a/b.txt"],
  ["a//b/", "", "a//b/"],
  ["a//b/", "a/b", null],
  ["a//b/", ".x", "a/b..x"],
  ["a/../b", "txt", "a/../b.txt"],
  ["a/../b", "", "a/../b"],
  ["a/../b", "a/b", null],
  ["a/../b", ".x", "a/../b..x"],
];
test("appending path extensions matches native Foundation edge cases", () => {
  for (const [path, extension, expected] of foundationCases)
    expect(appendPathExtension(path, extension)).toBe(expected ?? undefined);
});

const componentCases: [string, string[]][] = [
  ["", []],
  ["/", ["/"]],
  ["///", ["/", "/"]],
  ["a/b/", ["a", "b", "/"]],
  ["/a//b/", ["/", "a", "b", "/"]],
  ["./a/../b", [".", "a", "..", "b"]],
  ["~/a", ["~", "a"]],
  ["a\\b", ["a\\b"]],
  ["a%2Fb/é", ["a%2Fb", "é"]],
];
test("NSString path components preserve native leading and trailing separators", () => {
  for (const [path, expected] of componentCases) expect(pathComponents(path)).toEqual(expected);
});

const joinedCases: [string[], string][] = [
  [[], ""],
  [["/"], "/"],
  [["/", "/"], "/"],
  [["a", "b", "/"], "a/b"],
  [["a", "", "b"], "a/b"],
  [["/a/", "/b/"], "/a/b"],
  [["a", "/", "b"], "a/b"],
  [[".", "a", "..", "b"], "./a/../b"],
  [["a%2Fb", "é"], "a%2Fb/é"],
  [["", ""], ""],
  [["///"], "/"],
  [["a/", "/b"], "a/b"],
];
test("NSString paths reconstructed from components match native separator normalization", () => {
  for (const [parts, path] of joinedCases) expect(pathWithComponents(parts)).toBe(path);
});
