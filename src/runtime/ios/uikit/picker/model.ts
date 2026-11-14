import { GeometryField, floatFromBits } from "../../abi/scalars";
import { objectResult } from "../host";
import { MAX_PICKER_ROWS, PickerDefaults } from "./types";
import type { PickerComponent, PickerHost, PickerState } from "./types";
function count(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new RangeError("Invalid UIPickerView data-source count.");
  return value;
}
export class Pickers {
  private readonly states = new Map<number, PickerState>();
  constructor(
    readonly host: Pick<
      PickerHost,
      "view" | "retain" | "release" | "text" | "send" | "deallocateView" | "responds" | "touchPoint"
    >,
  ) {}
  has(self: number): boolean {
    return this.states.has(self);
  }
  get(self: number): PickerState {
    let state = this.states.get(self);
    if (!state) {
      state = {
        delegate: 0,
        source: 0,
        components: [],
        dirty: true,
        loading: false,
        revision: 0,
        indicator: false,
        drag: undefined,
      };
      this.states.set(self, state);
    }
    return state;
  }
  changed(self: number): void {
    this.host.view(self).needsDisplay = true;
  }
  invalidate(self: number): void {
    const state = this.get(self);
    state.dirty = true;
    state.revision++;
    state.drag = undefined;
    this.changed(self);
  }
  async destroy(self: number): Promise<void> {
    this.states.delete(self);
    await this.host.deallocateView(self);
  }
  clear(): void {
    this.states.clear();
  }
  private async component(
    self: number,
    index: number,
    total: number,
    previous?: PickerComponent,
  ): Promise<PickerComponent> {
    const state = this.get(self),
      rows = count(
        objectResult(
          await this.host.send(state.source, "pickerView:numberOfRowsInComponent:", [self, index]),
        ),
        MAX_PICKER_ROWS,
      );
    const width = floatFromBits(
      objectResult(
        await this.host.send(state.delegate, "pickerView:widthForComponent:", [self, index], true),
      ),
    );
    const height = floatFromBits(
      objectResult(
        await this.host.send(
          state.delegate,
          "pickerView:rowHeightForComponent:",
          [self, index],
          true,
        ),
      ),
    );
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0)
      throw new RangeError("Invalid UIPickerView row dimensions.");
    return {
      rows,
      selected: rows ? Math.min(Math.max(previous?.selected ?? 0, 0), rows - 1) : -1,
      width: width || this.host.view(self).bounds[GeometryField.Width] / total,
      height: height || PickerDefaults.RowHeight,
      titles: new Map(),
    };
  }
  async load(self: number, only?: number): Promise<void> {
    const state = this.get(self);
    if (state.loading || (!state.dirty && only === undefined)) return;
    state.loading = true;
    this.host.retain(self);
    const revision = state.revision;
    try {
      if (!state.source) {
        state.components = [];
        state.dirty = false;
        return;
      }
      const total = count(
        objectResult(await this.host.send(state.source, "numberOfComponentsInPickerView:", [self])),
        PickerDefaults.Components,
      );
      const components: PickerComponent[] = [];
      for (let index = 0; index < total; index++) {
        const previous = state.components[index];
        components.push(
          only !== undefined && index !== only && previous
            ? previous
            : await this.component(self, index, total, previous),
        );
      }
      if (state.revision === revision && this.states.get(self) === state) {
        state.components = components;
        state.dirty = false;
      }
    } finally {
      state.loading = false;
      await this.host.release(self);
    }
  }
  async select(self: number, row: number, index: number): Promise<void> {
    await this.load(self);
    const state = this.get(self),
      component = state.components[index];
    if (!component || !Number.isInteger(row) || row < 0 || row >= component.rows)
      throw new RangeError("UIPickerView selection outside data-source rows.");
    state.drag = undefined;
    component.selected = row;
    this.changed(self);
  }
  async title(self: number, row: number, index: number): Promise<string> {
    const state = this.get(self),
      component = state.components[index];
    if (!component || row < 0 || row >= component.rows) return "";
    const cached = component.titles.get(row);
    if (cached !== undefined) return cached;
    if (
      this.host.responds(state.delegate, "pickerView:viewForRow:forComponent:reusingView:") ||
      this.host.responds(state.delegate, "pickerView:attributedTitleForRow:forComponent:")
    )
      throw new Error("UIPickerView custom row views and attributed titles are not implemented.");
    const pointer = objectResult(
      await this.host.send(
        state.delegate,
        "pickerView:titleForRow:forComponent:",
        [self, row, index],
        true,
      ),
    );
    const title = pointer ? this.host.text(pointer) : "";
    if (component.titles.size >= PickerDefaults.TitleCache) {
      const oldest = component.titles.keys().next().value;
      if (oldest !== undefined) component.titles.delete(oldest);
    }
    component.titles.set(row, title);
    return title;
  }
  left(self: number): number {
    const bounds = this.host.view(self).bounds;
    return (
      bounds[0] +
      (bounds[GeometryField.Width] -
        this.get(self).components.reduce((sum, c) => sum + c.width, 0)) *
        PickerDefaults.Half
    );
  }
  async touch(
    self: number,
    phase: "begin" | "move" | "end" | "cancel",
    touches: number,
  ): Promise<void> {
    await this.load(self);
    const state = this.get(self),
      point = this.host.touchPoint(touches, self);
    if (phase === "cancel") {
      const drag = state.drag,
        component = drag && state.components[drag.component];
      if (drag && component) component.selected = drag.row;
      state.drag = undefined;
      this.changed(self);
      return;
    }
    if (!point) return;
    if (phase === "begin") {
      let left = this.left(self);
      for (const [index, component] of state.components.entries()) {
        if (point[0] >= left && point[0] < left + component.width && component.rows) {
          state.drag = { component: index, row: component.selected, y: point[1], distance: 0 };
          break;
        }
        left += component.width;
      }
      return;
    }
    const drag = state.drag,
      component = drag && state.components[drag.component];
    if (!drag || !component) return;
    drag.distance = point[1] - drag.y;
    const bounds = this.host.view(self).bounds,
      center = bounds[1] + bounds[GeometryField.Height] * PickerDefaults.Half;
    const target =
      phase === "end" && Math.abs(drag.distance) < PickerDefaults.TapSlop
        ? drag.row + Math.round((point[1] - center) / component.height)
        : drag.row - Math.round(drag.distance / component.height);
    component.selected = Math.max(0, Math.min(component.rows - 1, target));
    this.changed(self);
    if (phase === "end") {
      state.drag = undefined;
      if (component.selected !== drag.row)
        await this.host.send(
          state.delegate,
          "pickerView:didSelectRow:inComponent:",
          [self, component.selected, drag.component],
          true,
        );
    }
  }
}
