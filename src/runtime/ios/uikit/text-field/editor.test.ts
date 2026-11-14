import { expect, test } from "vite-plus/test";
import { textChange } from "./editor";
for (const [before, after, start, length, text] of [
  ["", "player", 0, 0, "player"],
  ["player", "play", 4, 2, ""],
  ["hello world", "hello Retrove", 6, 5, "Retrove"],
  ["a🎮b", "a🎲b", 1, 2, "🎲"],
  ["café", "cafe", 3, 1, "e"],
] as const)
  test(`text replacement preserves UTF-16 ranges for ${JSON.stringify(after)}`, () => {
    const change = textChange(before, after);
    expect(change).toEqual({ start, length, text });
    expect(
      before.slice(0, change.start) + change.text + before.slice(change.start + change.length),
    ).toBe(after);
  });
