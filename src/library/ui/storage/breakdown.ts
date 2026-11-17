export const StorageCategory = {
  Apps: "apps",
  Saves: "saves",
  Translations: "translations",
  Imports: "imports",
  Other: "other",
} as const;
export type StorageCategory = (typeof StorageCategory)[keyof typeof StorageCategory];

export const CATEGORY_LABELS: Readonly<Record<StorageCategory, string>> = {
  [StorageCategory.Apps]: "Apps",
  [StorageCategory.Saves]: "Saves",
  [StorageCategory.Translations]: "Translated code",
  [StorageCategory.Imports]: "Unfinished imports",
  [StorageCategory.Other]: "Other",
};

export interface StorageSlice {
  readonly category: StorageCategory;
  readonly bytes: number;
}
export interface MeasuredStorage {
  readonly apps: number;
  readonly saves: number;
  readonly translations: number;
  readonly imports: number;
  /** What the browser reports for this origin, when it reports anything. */
  readonly usage: number | undefined;
}

/**
 * Splits used space into categories. Whatever the browser counts beyond the measured
 * categories, such as the offline copy of Retrove itself, is "Other".
 */
export function storageBreakdown(measured: MeasuredStorage): StorageSlice[] {
  const known = measured.apps + measured.saves + measured.translations + measured.imports;
  const other = measured.usage === undefined ? 0 : Math.max(0, measured.usage - known);
  const slices: StorageSlice[] = [
    { category: StorageCategory.Apps, bytes: measured.apps },
    { category: StorageCategory.Saves, bytes: measured.saves },
    { category: StorageCategory.Translations, bytes: measured.translations },
    { category: StorageCategory.Imports, bytes: measured.imports },
    { category: StorageCategory.Other, bytes: other },
  ];
  return slices.filter((slice) => slice.bytes > 0);
}
