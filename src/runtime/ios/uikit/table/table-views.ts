import { GeometryField } from "../../abi/scalars";
import type { IndexPaths } from "../../foundation/index-paths";
import type { Rectangle } from "../host";
import type { ScrollViews } from "../scroll/state";
import type { Cells } from "./cells";
import { integerResult, pointerResult, type TableHost } from "./host";
import { querySection } from "./sections";
import {
  SectionView,
  SeparatorStyle,
  TableMetric,
  TableStyle,
  layoutTable,
  rowKey,
  rowsBetween,
  sectionViewIndex,
  type RowPosition,
  type SectionInput,
  type TableLayout,
} from "./model";

const SEPARATOR_GRAY = 0.88;
const DEFAULT_SEPARATOR = [SEPARATOR_GRAY, SEPARATOR_GRAY, SEPARATOR_GRAY, 1] as const;
export type Path = readonly [section: number, row: number];
export interface SectionTitles {
  readonly header: string | undefined;
  readonly footer: string | undefined;
}
export interface TableState {
  style: number;
  dataSource: number;
  rowHeight: number;
  separatorStyle: number;
  separatorColor: number;
  allowsSelection: boolean;
  editing: boolean;
  headerView: number;
  footerView: number;
  layout: TableLayout;
  titles: SectionTitles[];
  sectionViews: number[];
  visible: Map<string, number>;
  reuse: Map<string, number[]>;
  selected: Path | undefined;
  pressed: Path | undefined;
  loaded: boolean;
  tiling: boolean;
  retile: boolean;
  updates: number;
}

/** UITableView state, data source queries and cell tiling. */
export class TableViews {
  readonly states = new Map<number, TableState>();
  constructor(
    readonly host: TableHost,
    readonly cells: Cells,
    readonly paths: IndexPaths,
    readonly scrolls: ScrollViews,
  ) {}
  get(self: number): TableState {
    let state = this.states.get(self);
    if (!state) {
      state = {
        style: TableStyle.Plain,
        dataSource: 0,
        rowHeight: TableMetric.RowHeight,
        separatorStyle: SeparatorStyle.SingleLine,
        separatorColor: 0,
        allowsSelection: true,
        editing: false,
        headerView: 0,
        footerView: 0,
        layout: { sections: [], height: 0 },
        titles: [],
        sectionViews: [],
        visible: new Map(),
        reuse: new Map(),
        selected: undefined,
        pressed: undefined,
        loaded: false,
        tiling: false,
        retile: false,
        updates: 0,
      };
      this.states.set(self, state);
      this.scrolls.get(self);
    }
    return state;
  }
  delegate(self: number): number {
    return this.scrolls.get(self).delegate;
  }
  /** Sends an optional data source or delegate method with an index path argument. */
  async ask(target: number, selector: string, args: number[], path?: Path): Promise<unknown> {
    if (!target || !this.host.responds(target, selector)) return undefined;
    if (!path) return this.host.send(target, selector, args);
    const pointer = this.paths.create(path);
    try {
      return await this.host.send(target, selector, [...args, pointer]);
    } finally {
      await this.host.release(pointer);
    }
  }
  path(pointer: number): Path | undefined {
    const [section, row] = this.paths.indexes(pointer) ?? [];
    return section === undefined || row === undefined ? undefined : [section, row];
  }
  /** Rebuilds the row layout from the data source and returns visible cells to the reuse pool. */
  async reload(self: number): Promise<void> {
    const state = this.get(self);
    state.loaded = true;
    state.selected = state.pressed = undefined;
    for (const cell of state.visible.values()) await this.enqueue(state, cell);
    state.visible.clear();
    for (const view of state.sectionViews.splice(0)) {
      if (!view) continue;
      if (this.host.parent(view) === self) await this.host.send(view, "removeFromSuperview");
      await this.host.release(view);
    }
    const count = this.host.responds(state.dataSource, "numberOfSectionsInTableView:")
      ? integerResult(
          await this.host.send(state.dataSource, "numberOfSectionsInTableView:", [self]),
        )
      : Number(Boolean(state.dataSource));
    const sections: SectionInput[] = [],
      views: number[] = [];
    state.titles = [];
    for (let section = 0; section < count; section++)
      sections.push(await querySection(this, self, section, views));
    const headerHeight = this.viewHeight(state.headerView),
      layout = layoutTable(sections, headerHeight, this.viewHeight(state.footerView));
    state.layout = layout;
    state.sectionViews = views;
    await this.placeViews(self, state, views);
    const width = this.host.view(self).bounds[GeometryField.Width] ?? 0;
    this.scrolls.get(self).size = [width, layout.height];
    const offset = this.scrolls.offset(self),
      clamped = this.scrolls.clamp(self, offset);
    if (clamped[1] !== offset[1]) await this.scrolls.move(self, clamped);
    this.host.view(self).needsDisplay = true;
  }
  private viewHeight(view: number): number {
    return view ? (this.host.view(view).frame[GeometryField.Height] ?? 0) : 0;
  }
  private async placeViews(self: number, state: TableState, views: readonly number[]) {
    const width = this.host.view(self).bounds[GeometryField.Width] ?? 0,
      place = async (view: number, y: number, height: number) => {
        if (!view) return;
        this.host.setFrame(view, [0, y, width, height]);
        if (this.host.parent(view) !== self) await this.host.send(self, "addSubview:", [view]);
      };
    await place(state.headerView, 0, this.viewHeight(state.headerView));
    for (const [index, section] of state.layout.sections.entries()) {
      await place(
        views[sectionViewIndex(index, SectionView.Header)] ?? 0,
        section.top,
        section.header,
      );
      await place(
        views[sectionViewIndex(index, SectionView.Footer)] ?? 0,
        section.bottom - section.footer,
        section.footer,
      );
    }
    const footer = this.viewHeight(state.footerView);
    await place(state.footerView, state.layout.height - footer, footer);
  }
  private async enqueue(state: TableState, cell: number): Promise<void> {
    if (this.host.parent(cell)) await this.host.send(cell, "removeFromSuperview");
    const identifier = this.cells.states.get(cell)?.reuse;
    if (!identifier) {
      await this.host.release(cell);
      return;
    }
    const pool = state.reuse.get(identifier) ?? [];
    pool.push(cell);
    state.reuse.set(identifier, pool);
  }
  /** Takes a pooled cell for the data source; ownership moves to the autorelease pool. */
  async dequeue(self: number, identifier: string): Promise<number> {
    const cell = this.get(self).reuse.get(identifier)?.pop();
    if (!cell) return 0;
    await this.host.send(cell, "prepareForReuse", [], true);
    return this.host.autorelease(cell);
  }
  /** Creates cells for rows that came into view and pools the ones that left. */
  async tile(self: number): Promise<void> {
    const state = this.get(self);
    if (state.tiling) {
      state.retile = true;
      return;
    }
    state.tiling = true;
    try {
      do {
        state.retile = false;
        if (!state.loaded) await this.reload(self);
        await this.tileOnce(self, state);
      } while (state.retile);
    } finally {
      state.tiling = false;
    }
  }
  private async tileOnce(self: number, state: TableState): Promise<void> {
    const [, y, , height] = this.host.view(self).bounds,
      wanted = rowsBetween(state.layout, y, y + height),
      keys = new Set(wanted.map((row) => rowKey(row.section, row.row)));
    for (const [key, cell] of [...state.visible]) {
      if (keys.has(key)) continue;
      state.visible.delete(key);
      await this.enqueue(state, cell);
    }
    for (const row of wanted) {
      const key = rowKey(row.section, row.row);
      let cell = state.visible.get(key);
      if (!cell) {
        cell = await this.create(self, row);
        if (state.retile) {
          await this.enqueue(state, cell);
          return;
        }
        state.visible.set(key, cell);
      }
      await this.place(self, state, cell, row);
    }
  }
  private async create(self: number, row: RowPosition): Promise<number> {
    const state = this.get(self),
      cell = pointerResult(
        await this.ask(
          state.dataSource,
          "tableView:cellForRowAtIndexPath:",
          [self],
          [row.section, row.row],
        ),
      );
    if (!cell)
      throw new Error(
        `UITableView data source returned no cell for row ${row.row} in section ${row.section}.`,
      );
    this.host.retain(cell);
    for (const [key, shown] of state.visible)
      if (shown === cell) {
        state.visible.delete(key);
        await this.host.release(cell);
      }
    const selected = state.selected?.[0] === row.section && state.selected[1] === row.row;
    if (selected !== this.cells.get(cell).selected)
      await this.host.send(cell, "setSelected:", [Number(selected)]);
    return cell;
  }
  private async place(self: number, state: TableState, cell: number, row: RowPosition) {
    const width = this.host.view(self).bounds[GeometryField.Width] ?? 0,
      grouped = state.style === TableStyle.Grouped,
      inset = grouped ? TableMetric.GroupedInset : 0,
      frame: Rectangle = [inset, row.top, width - inset - inset, row.height],
      current = this.host.view(cell).frame,
      last = row.row + 1 === state.layout.sections[row.section]?.rows.length,
      cellState = this.cells.get(cell),
      separator =
        state.separatorStyle === SeparatorStyle.None || (grouped && last)
          ? undefined
          : ((state.separatorColor ? this.host.rgba(state.separatorColor) : undefined) ??
            DEFAULT_SEPARATOR);
    if (frame.some((value, index) => value !== current[index])) this.host.setFrame(cell, frame);
    if (cellState.separator?.join() !== separator?.join()) {
      cellState.separator = separator;
      const view = this.host.view(cell);
      view.needsDisplay = view.needsLayout = true;
    }
    if (this.host.parent(cell) !== self) await this.host.send(self, "addSubview:", [cell]);
  }
  pathOf(self: number, cell: number): Path | undefined {
    for (const [key, shown] of this.get(self).visible) {
      if (shown !== cell) continue;
      const [section = 0, row = 0] = key.split(":").map(Number);
      return [section, row];
    }
    return undefined;
  }
  async destroy(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    if (!state) return;
    for (const cell of [...state.visible.values(), ...[...state.reuse.values()].flat()])
      await this.host.release(cell);
    for (const owned of [
      ...state.sectionViews,
      state.headerView,
      state.footerView,
      state.separatorColor,
    ])
      if (owned) await this.host.release(owned);
  }
}
