import type { IndexPaths } from "../../foundation/index-paths";
import type { ScrollViews } from "../scroll/state";
import { installCellMethods, installTableControllers } from "./cell-bindings";
import { Cells } from "./cells";
import { drawCell, drawTable } from "./drawing";
import { TableClass, type TableHost } from "./host";
import { TableSelection } from "./selection";
import { TableBindings } from "./table-bindings";
import { TableViews } from "./table-views";

export type { TableHost } from "./host";
export interface Tables {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): void;
}

/** UITableView, UITableViewCell and UITableViewController. */
export function installTables(host: TableHost, paths: IndexPaths, scrolls: ScrollViews): Tables {
  host.hostClass(TableClass.Table, "UIScrollView");
  host.hostClass(TableClass.Cell, "UIView");
  host.hostClass(TableClass.Controller, "UIViewController");
  host.hostClass(TableClass.ContentView, "UIView");
  const cells = new Cells(host),
    tables = new TableViews(host, cells, paths, scrolls);
  new TableBindings(tables, new TableSelection(tables)).install();
  installCellMethods(host, cells);
  installTableControllers(host);
  return {
    has: (pointer) => tables.states.has(pointer) || cells.states.has(pointer),
    draw: (pointer, context) => {
      const bounds = host.view(pointer).bounds,
        table = tables.states.get(pointer);
      if (table) {
        drawTable(context, bounds, {
          style: table.style,
          background: host.hasBackground(pointer),
          layout: table.layout,
          titles: table.titles,
          sectionViews: table.sectionViews,
        });
        return;
      }
      const cell = cells.states.get(pointer);
      if (cell)
        drawCell(context, bounds, {
          selectionStyle: cell.selectionStyle,
          lit: cell.selected || cell.highlighted,
          customSelection: Boolean(cell.selectedBackgroundView),
          separator: cell.separator,
          accessory: cell.accessory,
          accessoryView: Boolean(cell.accessoryView),
        });
    },
  };
}
