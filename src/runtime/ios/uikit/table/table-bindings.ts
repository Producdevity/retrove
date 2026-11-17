import { floatBits, floatFromBits, GeometryField, WORD_BYTES } from "../../abi/scalars";
import { Argument, type HostMethod } from "../../objc/host";
import { structureMethod } from "../host";
import { TableClass } from "./host";
import { TableStyle, rowAt, rowKey, rowPosition, rowsBetween, scrollOffset } from "./model";
import type { TableSelection } from "./selection";
import type { Path, TableState, TableViews } from "./table-views";

const STYLE_ARGUMENT = 4;
type Retained = "headerView" | "footerView" | "separatorColor";

function readRect(args: (index: number) => number): [number, number, number, number] {
  return [
    floatFromBits(args(GeometryField.X)),
    floatFromBits(args(GeometryField.Y)),
    floatFromBits(args(GeometryField.Width)),
    floatFromBits(args(GeometryField.Height)),
  ];
}

export class TableBindings {
  constructor(
    private readonly tables: TableViews,
    private readonly selection: TableSelection,
  ) {}
  private get host() {
    return this.tables.host;
  }
  private method(selector: string, implementation: HostMethod): void {
    this.host.method(TableClass.Table, false, selector, implementation);
  }
  /** Reloads now, or at the end of the outermost beginUpdates block. */
  private async changed(self: number): Promise<void> {
    if (this.tables.get(self).updates > 0) return;
    await this.tables.reload(self);
    await this.tables.tile(self);
  }
  private created(path: Path): number {
    return this.host.autorelease(this.tables.paths.create(path));
  }
  install(): void {
    this.initializers();
    this.properties();
    this.data();
    this.queries();
    this.touches();
  }
  private initializers(): void {
    const setup = (self: number, style: number, frame?: [number, number, number, number]) => {
      this.tables.get(self).style = style;
      return frame ? this.host.setFrame(self, frame) : self;
    };
    this.method("init", (self) => setup(self, TableStyle.Plain));
    this.method("initWithFrame:", (self, args) => setup(self, TableStyle.Plain, readRect(args)));
    this.method("initWithFrame:style:", (self, args) =>
      setup(self, args(STYLE_ARGUMENT), readRect(args)),
    );
    this.method("style", (self) => this.tables.get(self).style);
    this.method("layoutSubviews", (self) => this.tables.tile(self));
    this.method("dealloc", async (self) => {
      await this.tables.destroy(self);
      this.tables.scrolls.states.delete(self);
      await this.host.deallocateView(self);
    });
  }
  private retained(getter: string, setter: string, field: Retained): void {
    this.method(getter, (self) => this.tables.get(self)[field]);
    this.method(setter, async (self, args) => {
      const state = this.tables.get(self),
        old = state[field],
        value = args(Argument.First);
      if (old === value) return;
      state[field] = value ? this.host.retain(value) : 0;
      if (old) {
        if (field !== "separatorColor" && this.host.parent(old) === self)
          await this.host.send(old, "removeFromSuperview");
        await this.host.release(old);
      }
      if (field === "separatorColor") this.host.view(self).needsLayout = true;
      else if (state.loaded) await this.changed(self);
    });
  }
  private properties(): void {
    this.method("dataSource", (self) => this.tables.get(self).dataSource);
    this.method("setDataSource:", (self, args) => {
      this.tables.get(self).dataSource = args(Argument.First);
    });
    this.method("rowHeight", (self) => floatBits(this.tables.get(self).rowHeight));
    this.method("setRowHeight:", (self, args) => {
      this.tables.get(self).rowHeight = floatFromBits(args(Argument.First));
    });
    for (const [getter, setter, field] of [
      ["separatorStyle", "setSeparatorStyle:", "separatorStyle"],
      ["allowsSelection", "setAllowsSelection:", "allowsSelection"],
      ["isEditing", "setEditing:", "editing"],
    ] as const) {
      this.method(getter, (self) => Number(this.tables.get(self)[field]));
      this.method(setter, (self, args) => {
        const state: TableState = this.tables.get(self);
        if (field === "separatorStyle") state.separatorStyle = args(Argument.First);
        else state[field] = Boolean(args(Argument.First));
        this.host.view(self).needsLayout = true;
      });
    }
    this.method("setEditing:animated:", (self, args) => {
      this.tables.get(self).editing = Boolean(args(Argument.First));
    });
    for (const selector of [
      "setSectionHeaderHeight:",
      "setSectionFooterHeight:",
      "setAllowsSelectionDuringEditing:",
    ])
      this.method(selector, () => {});
    this.retained("tableHeaderView", "setTableHeaderView:", "headerView");
    this.retained("tableFooterView", "setTableFooterView:", "footerView");
    this.retained("separatorColor", "setSeparatorColor:", "separatorColor");
  }
  private data(): void {
    this.method("reloadData", (self) => this.changed(self));
    this.method("beginUpdates", (self) => {
      this.tables.get(self).updates++;
    });
    this.method("endUpdates", async (self) => {
      const state = this.tables.get(self);
      state.updates = Math.max(0, state.updates - 1);
      await this.changed(self);
    });
    for (const selector of [
      "reloadSections:withRowAnimation:",
      "insertSections:withRowAnimation:",
      "deleteSections:withRowAnimation:",
      "reloadRowsAtIndexPaths:withRowAnimation:",
      "insertRowsAtIndexPaths:withRowAnimation:",
      "deleteRowsAtIndexPaths:withRowAnimation:",
      "reloadSectionIndexTitles",
    ])
      this.method(selector, (self) => this.changed(self));
    this.method("dequeueReusableCellWithIdentifier:", (self, args) =>
      this.tables.dequeue(self, this.host.text(args(Argument.First))),
    );
    this.method("selectRowAtIndexPath:animated:scrollPosition:", async (self, args) => {
      const path = this.tables.path(args(Argument.First));
      await this.selection.select(self, path);
      if (path)
        await this.scrollTo(self, path, args(Argument.Third), Boolean(args(Argument.Second)));
    });
    this.method("deselectRowAtIndexPath:animated:", (self, args) =>
      this.selection.deselect(self, this.tables.path(args(Argument.First))),
    );
    this.method("indexPathForSelectedRow", (self) => {
      const selected = this.tables.get(self).selected;
      return selected ? this.created(selected) : 0;
    });
    this.method("scrollToRowAtIndexPath:atScrollPosition:animated:", (self, args) => {
      const path = this.tables.path(args(Argument.First));
      return path
        ? this.scrollTo(self, path, args(Argument.Second), Boolean(args(Argument.Third)))
        : undefined;
    });
  }
  private async scrollTo(self: number, path: Path, position: number, animated: boolean) {
    if (!this.tables.get(self).loaded) await this.tables.reload(self);
    const row = rowPosition(this.tables.get(self).layout, ...path);
    if (!row) return;
    const [x, y, , height] = this.host.view(self).bounds,
      target = this.tables.scrolls.clamp(self, [x, scrollOffset(row, position, y, height)]);
    await this.tables.scrolls.setOffset(self, target, animated);
  }
  private queries(): void {
    this.method("numberOfSections", (self) => this.tables.get(self).layout.sections.length);
    this.method(
      "numberOfRowsInSection:",
      (self, args) => this.tables.get(self).layout.sections[args(Argument.First)]?.rows.length ?? 0,
    );
    this.method("cellForRowAtIndexPath:", (self, args) =>
      this.selection.cell(self, this.tables.path(args(Argument.First))),
    );
    this.method("indexPathForCell:", (self, args) => {
      const path = this.tables.pathOf(self, args(Argument.First));
      return path ? this.created(path) : 0;
    });
    this.method("indexPathForRowAtPoint:", (self, args) => {
      const row = rowAt(this.tables.get(self).layout, floatFromBits(args(Argument.Second)));
      return row ? this.created([row.section, row.row]) : 0;
    });
    const visibleRows = (self: number) => {
      const [, y, , height] = this.host.view(self).bounds;
      return rowsBetween(this.tables.get(self).layout, y, y + height);
    };
    this.method("visibleCells", (self) => {
      const state = this.tables.get(self);
      return this.host.array(
        visibleRows(self).flatMap((row) => state.visible.get(rowKey(row.section, row.row)) ?? []),
      );
    });
    this.method("indexPathsForVisibleRows", (self) =>
      this.host.array(visibleRows(self).map((row) => this.created([row.section, row.row]))),
    );
    this.host.structure(
      TableClass.Table,
      false,
      "rectForRowAtIndexPath:",
      structureMethod((self, args, out) => {
        const path = this.tables.path(args(Argument.First)),
          row = path ? rowPosition(this.tables.get(self).layout, ...path) : undefined,
          width = this.host.view(self).bounds[GeometryField.Width] ?? 0,
          rect = row ? [0, row.top, width, row.height] : [0, 0, 0, 0];
        rect.forEach((value, index) => this.host.write(out + index * WORD_BYTES, floatBits(value)));
      }),
    );
  }
  private touches(): void {
    this.method("touchesBegan:withEvent:", (self, args) =>
      this.selection.began(self, args(Argument.First)),
    );
    this.method("touchesMoved:withEvent:", (self, args) =>
      this.selection.moved(self, args(Argument.First)),
    );
    this.method("touchesEnded:withEvent:", (self, args) =>
      this.selection.ended(self, args(Argument.First)),
    );
    this.method("touchesCancelled:withEvent:", (self) => this.selection.cancelled(self));
  }
}
