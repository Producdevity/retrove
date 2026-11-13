import { expect, test } from "vite-plus/test";
import { layoutText, LineBreak } from "./text-layout";
const measure = (text: string): number => Array.from(text).length;
test("word wrapping consumes boundary whitespace and preserves hard line breaks", () => {
  expect(layoutText("hello world", 5, LineBreak.Word, 0, measure)).toEqual(["hello", "world"]);
  expect(layoutText("hello world", 6, LineBreak.Word, 0, measure)).toEqual(["hello", "world"]);
  expect(layoutText("one two three\nlast", 8, LineBreak.Word, 0, measure)).toEqual([
    "one two",
    "three",
    "last",
  ]);
});
test("long words and character wrapping do not cut surrogate pairs", () => {
  expect(layoutText("abcdefghijkl", 5, LineBreak.Word, 0, measure)).toEqual([
    "abcde",
    "fghij",
    "kl",
  ]);
  expect(layoutText("a🎮bc", 2, LineBreak.Character, 0, measure)).toEqual(["a🎮", "bc"]);
});
test("head, middle and tail truncation fit within the label", () => {
  expect(layoutText("abcdefghij", 5, LineBreak.Head, 1, measure)).toEqual(["…ghij"]);
  expect(layoutText("abcdefghij", 5, LineBreak.Middle, 1, measure)).toEqual(["ab…ij"]);
  expect(layoutText("abcdefghij", 5, LineBreak.Tail, 1, measure)).toEqual(["abcd…"]);
  expect(layoutText("abcdef", 5, LineBreak.Clip, 1, measure)).toEqual(["abcdef"]);
  expect(layoutText("", 5, LineBreak.Tail, 1, measure)).toEqual([]);
});
