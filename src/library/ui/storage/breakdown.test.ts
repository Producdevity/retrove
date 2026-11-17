import { expect, test } from "vite-plus/test";
import { StorageCategory, storageBreakdown } from "./breakdown";

test("space the browser reports beyond the measured categories is other", () => {
  expect(
    storageBreakdown({ apps: 100, saves: 20, translations: 30, imports: 0, usage: 200 }),
  ).toEqual([
    { category: StorageCategory.Apps, bytes: 100 },
    { category: StorageCategory.Saves, bytes: 20 },
    { category: StorageCategory.Translations, bytes: 30 },
    { category: StorageCategory.Other, bytes: 50 },
  ]);
});

test("a browser estimate below the measured total never produces negative space", () => {
  expect(storageBreakdown({ apps: 100, saves: 0, translations: 0, imports: 5, usage: 50 })).toEqual(
    [
      { category: StorageCategory.Apps, bytes: 100 },
      { category: StorageCategory.Imports, bytes: 5 },
    ],
  );
});

test("without a browser estimate only measured categories appear", () => {
  expect(
    storageBreakdown({ apps: 0, saves: 3, translations: 0, imports: 0, usage: undefined }),
  ).toEqual([{ category: StorageCategory.Saves, bytes: 3 }]);
});
