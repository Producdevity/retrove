/** UITableViewStyle values. */
export const TableStyle = { Plain: 0, Grouped: 1 } as const;
/** UITableViewCellStyle values. */
export const CellStyle = { Default: 0, Value1: 1, Value2: 2, Subtitle: 3 } as const;
/** UITableViewCellSeparatorStyle values. */
export const SeparatorStyle = { None: 0, SingleLine: 1, SingleLineEtched: 2 } as const;
/** UITableViewCellSelectionStyle values. */
export const SelectionStyle = { None: 0, Blue: 1, Gray: 2 } as const;
/** UITableViewCellAccessoryType values. */
export const AccessoryType = {
  None: 0,
  DisclosureIndicator: 1,
  DetailDisclosureButton: 2,
  Checkmark: 3,
} as const;
/** UITableViewScrollPosition values. */
export const ScrollPosition = { None: 0, Top: 1, Middle: 2, Bottom: 3 } as const;

/** iPhone OS 3 table metrics in points. */
export const TableMetric = {
  RowHeight: 44,
  PlainTitleHeight: 22,
  GroupedTitleHeight: 46,
  GroupedFooterTitleHeight: 30,
  GroupedGap: 10,
  GroupedInset: 10,
  CellPadding: 10,
  AccessoryWidth: 20,
  Half: 0.5,
} as const;

export interface SectionInput {
  readonly rows: readonly number[];
  readonly header: number;
  readonly footer: number;
}
export interface SectionLayout extends SectionInput {
  readonly top: number;
  /** Top of each row in content coordinates. */
  readonly offsets: readonly number[];
  readonly bottom: number;
}
export interface TableLayout {
  readonly sections: readonly SectionLayout[];
  readonly height: number;
}
export interface RowPosition {
  readonly section: number;
  readonly row: number;
  readonly top: number;
  readonly height: number;
}

/** Stacks the table header, sections and table footer from top to bottom. */
export function layoutTable(
  sections: readonly SectionInput[],
  tableHeader: number,
  tableFooter: number,
): TableLayout {
  let y = tableHeader;
  const laid = sections.map((section) => {
    const top = y;
    y += section.header;
    const offsets = section.rows.map((height) => {
      const offset = y;
      y += height;
      return offset;
    });
    y += section.footer;
    return { ...section, top, offsets, bottom: y };
  });
  return { sections: laid, height: y + tableFooter };
}

export function rowPosition(
  layout: TableLayout,
  section: number,
  row: number,
): RowPosition | undefined {
  const value = layout.sections[section],
    top = value?.offsets[row],
    height = value?.rows[row];
  return top === undefined || height === undefined ? undefined : { section, row, top, height };
}
/** Rows that intersect the content range from `top` to `bottom`. */
export function rowsBetween(layout: TableLayout, top: number, bottom: number): RowPosition[] {
  const rows: RowPosition[] = [];
  layout.sections.forEach((section, index) => {
    if (section.bottom <= top || section.top >= bottom) return;
    section.offsets.forEach((offset, row) => {
      const height = section.rows[row] ?? 0;
      if (offset < bottom && offset + height > top)
        rows.push({ section: index, row, top: offset, height });
    });
  });
  return rows;
}
export function rowAt(layout: TableLayout, y: number): RowPosition | undefined {
  return rowsBetween(layout, y, y + 1).find((row) => y >= row.top && y < row.top + row.height);
}
/** Content offset that shows a row at the requested position within the viewport. */
export function scrollOffset(
  row: RowPosition,
  position: number,
  current: number,
  viewport: number,
): number {
  switch (position) {
    case ScrollPosition.Top:
      return row.top;
    case ScrollPosition.Middle:
      return row.top + (row.height - viewport) * TableMetric.Half;
    case ScrollPosition.Bottom:
      return row.top + row.height - viewport;
    default:
      if (row.top < current) return row.top;
      if (row.top + row.height > current + viewport) return row.top + row.height - viewport;
      return current;
  }
}
/** Default header and footer heights before the delegate overrides them. */
export function defaultTitleHeight(
  style: number,
  footer: boolean,
  title: string | undefined,
): number {
  if (style === TableStyle.Plain) return title ? TableMetric.PlainTitleHeight : 0;
  if (!title) return TableMetric.GroupedGap;
  return footer ? TableMetric.GroupedFooterTitleHeight : TableMetric.GroupedTitleHeight;
}
/** Header and footer views of a section are stored side by side. */
export const SectionView = { Header: 0, Footer: 1, PerSection: 2 } as const;
export function sectionViewIndex(section: number, kind: number): number {
  return section * SectionView.PerSection + kind;
}
export function rowKey(section: number, row: number): string {
  return `${section}:${row}`;
}
