/** UIBarButtonSystemItem values. */
export const BarSystemItem = {
  Done: 0,
  Cancel: 1,
  Edit: 2,
  Save: 3,
  Add: 4,
  FlexibleSpace: 5,
  FixedSpace: 6,
  Compose: 7,
  Reply: 8,
  Action: 9,
  Organize: 10,
  Bookmarks: 11,
  Search: 12,
  Refresh: 13,
  Stop: 14,
  Camera: 15,
  Trash: 16,
  Play: 17,
  Pause: 18,
  Rewind: 19,
  FastForward: 20,
  Undo: 21,
  Redo: 22,
  PageCurl: 23,
} as const;
/** UIBarButtonItemStyle values. */
export const BarItemStyle = { Plain: 0, Bordered: 1, Done: 2 } as const;
/** UIBarStyle values. */
export const BarStyle = { Default: 0, Black: 1, BlackTranslucent: 2 } as const;
/** iPhone OS 3 toolbar metrics in points. */
export const ToolbarMetric = {
  Height: 44,
  Margin: 6,
  Gap: 10,
  ButtonHeight: 30,
  TitlePadding: 10,
  PlainPadding: 5,
  GlyphWidth: 20,
  GlyphPadding: 7,
  ImagePadding: 6,
  Half: 0.5,
} as const;

export interface BarItemState {
  title: number;
  image: number;
  style: number;
  system: number | undefined;
  target: number;
  action: number;
  customView: number;
  width: number;
  enabled: boolean;
  tag: number;
}
export function barItemState(): BarItemState {
  return {
    title: 0,
    image: 0,
    style: BarItemStyle.Plain,
    system: undefined,
    target: 0,
    action: 0,
    customView: 0,
    width: 0,
    enabled: true,
    tag: 0,
  };
}

const SYSTEM_TITLES: Readonly<Record<number, string>> = {
  [BarSystemItem.Done]: "Done",
  [BarSystemItem.Cancel]: "Cancel",
  [BarSystemItem.Edit]: "Edit",
  [BarSystemItem.Save]: "Save",
  [BarSystemItem.Undo]: "Undo",
  [BarSystemItem.Redo]: "Redo",
};
const SYSTEM_GLYPHS: Readonly<Record<number, string>> = {
  [BarSystemItem.Add]: "+",
  [BarSystemItem.Compose]: "✎",
  [BarSystemItem.Reply]: "↩",
  [BarSystemItem.Action]: "⇪",
  [BarSystemItem.Organize]: "▤",
  [BarSystemItem.Bookmarks]: "▯",
  [BarSystemItem.Search]: "⌕",
  [BarSystemItem.Refresh]: "↻",
  [BarSystemItem.Stop]: "✕",
  [BarSystemItem.Camera]: "◉",
  [BarSystemItem.Trash]: "⌫",
  [BarSystemItem.Play]: "▶",
  [BarSystemItem.Pause]: "❚❚",
  [BarSystemItem.Rewind]: "◀◀",
  [BarSystemItem.FastForward]: "▶▶",
  [BarSystemItem.PageCurl]: "↶",
};
/** Title text of a system item that shows a word, such as Done. */
export function systemTitle(system: number | undefined): string | undefined {
  return system === undefined ? undefined : SYSTEM_TITLES[system];
}
/** Symbol standing in for a system item's icon. */
export function systemGlyph(system: number | undefined): string | undefined {
  return system === undefined ? undefined : SYSTEM_GLYPHS[system];
}
export function isSpace(item: BarItemState): boolean {
  return item.system === BarSystemItem.FlexibleSpace || item.system === BarSystemItem.FixedSpace;
}
/** System word items are bordered; Done is drawn in the Done style. */
export function effectiveStyle(item: BarItemState): number {
  if (item.system === BarSystemItem.Done) return BarItemStyle.Done;
  return systemTitle(item.system) === undefined ? item.style : BarItemStyle.Bordered;
}

export interface MeasuredItem {
  readonly pointer: number;
  /** Width without flexible space; 0 for flexible space. */
  readonly width: number;
  readonly flexible: boolean;
  readonly space: boolean;
}
export interface PlacedItem {
  readonly pointer: number;
  readonly x: number;
  readonly width: number;
}
/** Places items left to right with margins and gaps; flexible spaces share what is left. */
export function layoutItems(items: readonly MeasuredItem[], barWidth: number): PlacedItem[] {
  const gaps = Math.max(0, items.length - 1) * ToolbarMetric.Gap,
    fixed = items.reduce((sum, item) => sum + item.width, 0),
    flexible = items.filter((item) => item.flexible).length,
    left = barWidth - ToolbarMetric.Margin - ToolbarMetric.Margin - gaps - fixed,
    share = flexible && left > 0 ? left / flexible : 0;
  let x = ToolbarMetric.Margin;
  return items.map((item) => {
    const width = item.flexible ? share : item.width,
      placed = { pointer: item.pointer, x, width };
    x += width + ToolbarMetric.Gap;
    return placed;
  });
}
/** The placed, non-space item under `x`, if any. */
export function itemAt(
  placed: readonly PlacedItem[],
  spaces: ReadonlySet<number>,
  x: number,
): number {
  const half = ToolbarMetric.Gap * ToolbarMetric.Half;
  return (
    placed.find(
      (item) => !spaces.has(item.pointer) && x >= item.x - half && x < item.x + item.width + half,
    )?.pointer ?? 0
  );
}
