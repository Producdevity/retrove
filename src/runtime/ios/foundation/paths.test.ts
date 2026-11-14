import { expect, test } from "vite-plus/test";
import {
  appendPathExtension,
  pathComponents,
  pathWithComponents,
  stringLastPathComponent,
  stringPathExtension,
  deletePathExtension,
  deleteLastPathComponent,
} from "./paths";

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

const nativePaths = [
  { path: "", lastComponent: "", deletingLastComponent: "", extension: "", deletingExtension: "" },
  {
    path: "file.xml",
    lastComponent: "file.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: "file",
  },
  {
    path: ".hidden",
    lastComponent: ".hidden",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: ".hidden",
  },
  {
    path: ".hidden.xml",
    lastComponent: ".hidden.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: ".hidden",
  },
  {
    path: "file.",
    lastComponent: "file.",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: "file.",
  },
  {
    path: ".",
    lastComponent: ".",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: ".",
  },
  {
    path: "..",
    lastComponent: "..",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: "..",
  },
  {
    path: "..foo",
    lastComponent: "..foo",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: "..foo",
  },
  {
    path: "..foo.xml",
    lastComponent: "..foo.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: "..foo",
  },
  {
    path: "/",
    lastComponent: "/",
    deletingLastComponent: "/",
    extension: "",
    deletingExtension: "/",
  },
  {
    path: "///",
    lastComponent: "/",
    deletingLastComponent: "/",
    extension: "",
    deletingExtension: "/",
  },
  {
    path: "/a///b.c//",
    lastComponent: "b.c",
    deletingLastComponent: "/a",
    extension: "c",
    deletingExtension: "/a/b",
  },
  {
    path: "a.b/../c",
    lastComponent: "c",
    deletingLastComponent: "a.b/..",
    extension: "",
    deletingExtension: "a.b/../c",
  },
  {
    path: "a.b/.",
    lastComponent: ".",
    deletingLastComponent: "a.b",
    extension: "",
    deletingExtension: "a.b/.",
  },
  {
    path: "a.b/..",
    lastComponent: "..",
    deletingLastComponent: "a.b",
    extension: "",
    deletingExtension: "a.b/..",
  },
  {
    path: "~/a.b/",
    lastComponent: "a.b",
    deletingLastComponent: "~",
    extension: "b",
    deletingExtension: "~/a",
  },
  {
    path: "a%20b.xml",
    lastComponent: "a%20b.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: "a%20b",
  },
  {
    path: "a\\b.xml",
    lastComponent: "a\\b.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: "a\\b",
  },
  {
    path: "\ud83d\ude00.xml",
    lastComponent: "\ud83d\ude00.xml",
    deletingLastComponent: "",
    extension: "xml",
    deletingExtension: "\ud83d\ude00",
  },
  {
    path: "a//",
    lastComponent: "a",
    deletingLastComponent: "",
    extension: "",
    deletingExtension: "a",
  },
  {
    path: "/a",
    lastComponent: "a",
    deletingLastComponent: "/",
    extension: "",
    deletingExtension: "/a",
  },
];
test("NSString path getters and deletions match native normalization and leading-dot rules", () => {
  for (const item of nativePaths) {
    expect(stringLastPathComponent(item.path)).toBe(item.lastComponent);
    expect(stringPathExtension(item.path)).toBe(item.extension);
    expect(deletePathExtension(item.path)).toBe(item.deletingExtension);
    expect(deleteLastPathComponent(item.path)).toBe(item.deletingLastComponent);
  }
});
