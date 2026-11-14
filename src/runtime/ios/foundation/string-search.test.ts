import { expect, test } from "vite-plus/test";
import { CharacterSet } from "./character-set";
import { characterRange, NOT_FOUND, SearchOption } from "./string-search";

test("character searches use UTF-16 ranges and return whole supplementary characters", () => {
  const set = CharacterSet.characters("🎮x");
  expect(characterRange("a🎮bx", set)).toEqual({ location: 1, length: 2 });
  expect(characterRange("a🎮bx", set, SearchOption.Backwards)).toEqual({ location: 4, length: 1 });
  expect(characterRange("a🎮bx", set, 0, 2, 2)).toEqual({ location: NOT_FOUND, length: 0 });
  expect(set.contains("\ud83c")).toBe(false);
  expect(set.contains("\udfae")).toBe(false);
});
test("anchored searches use the selected range boundary without normalizing Unicode", () => {
  const set = CharacterSet.characters("xü");
  expect(characterRange("axxb", set, SearchOption.Anchored)).toEqual({
    location: NOT_FOUND,
    length: 0,
  });
  expect(characterRange("axxb", set, SearchOption.Anchored | SearchOption.Backwards, 1, 2)).toEqual(
    { location: 2, length: 1 },
  );
  expect(characterRange("u\u0308", set)).toEqual({ location: NOT_FOUND, length: 0 });
  expect(() => characterRange("abc", set, 0, 2, 2)).toThrow("bounds");
});
