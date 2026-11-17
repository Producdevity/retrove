import { pointerResult } from "./host";
import { rowAt, rowKey } from "./model";
import type { Path, TableViews } from "./table-views";

function same(left: Path | undefined, right: Path | undefined): boolean {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

/** Row selection driven by the data model, guest calls and touches. */
export class TableSelection {
  constructor(private readonly tables: TableViews) {}
  cell(self: number, path: Path | undefined): number {
    return path ? (this.tables.get(self).visible.get(rowKey(...path)) ?? 0) : 0;
  }
  private async mark(self: number, path: Path | undefined, selector: string, value: boolean) {
    const cell = this.cell(self, path);
    if (cell) await this.tables.host.send(cell, selector, [Number(value), 0]);
  }
  async select(self: number, path: Path | undefined): Promise<void> {
    const state = this.tables.get(self);
    if (same(state.selected, path)) return;
    await this.mark(self, state.selected, "setSelected:animated:", false);
    state.selected = path;
    await this.mark(self, path, "setSelected:animated:", true);
  }
  async deselect(self: number, path: Path | undefined): Promise<void> {
    if (path && same(this.tables.get(self).selected, path)) await this.select(self, undefined);
  }
  private row(self: number, touches: number): Path | undefined {
    const point = this.tables.host.touchPoint(touches, self),
      row = point ? rowAt(this.tables.get(self).layout, point[1]) : undefined;
    return row ? [row.section, row.row] : undefined;
  }
  async began(self: number, touches: number): Promise<void> {
    const state = this.tables.get(self);
    if (!state.allowsSelection || state.editing) return;
    state.pressed = this.row(self, touches);
    await this.mark(self, state.pressed, "setHighlighted:animated:", true);
  }
  async moved(self: number, touches: number): Promise<void> {
    const state = this.tables.get(self);
    if (state.pressed && !same(state.pressed, this.row(self, touches))) await this.cancelled(self);
  }
  async cancelled(self: number): Promise<void> {
    const state = this.tables.get(self),
      pressed = state.pressed;
    state.pressed = undefined;
    await this.mark(self, pressed, "setHighlighted:animated:", false);
  }
  async ended(self: number, touches: number): Promise<void> {
    const state = this.tables.get(self),
      pressed = state.pressed;
    if (!pressed) return;
    const inside = same(pressed, this.row(self, touches));
    await this.cancelled(self);
    if (inside) await this.choose(self, pressed);
  }
  /** Selection by the user: the delegate may redirect or refuse it. */
  private async choose(self: number, path: Path): Promise<void> {
    const delegate = this.tables.delegate(self),
      state = this.tables.get(self);
    let target: Path | undefined = path;
    if (this.tables.host.responds(delegate, "tableView:willSelectRowAtIndexPath:")) {
      const result = pointerResult(
        await this.tables.ask(delegate, "tableView:willSelectRowAtIndexPath:", [self], path),
      );
      target = result ? this.tables.path(result) : undefined;
    }
    if (!target) return;
    const previous = state.selected;
    await this.select(self, target);
    if (previous && !same(previous, target))
      await this.tables.ask(delegate, "tableView:didDeselectRowAtIndexPath:", [self], previous);
    await this.tables.ask(delegate, "tableView:didSelectRowAtIndexPath:", [self], target);
  }
}
