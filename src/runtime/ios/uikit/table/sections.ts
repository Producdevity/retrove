import { floatFromBits, GeometryField } from "../../abi/scalars";
import { integerResult, pointerResult } from "./host";
import { defaultTitleHeight, type SectionInput } from "./model";
import type { Path, TableViews } from "./table-views";

async function float(
  tables: TableViews,
  target: number,
  selector: string,
  args: number[],
  path?: Path,
) {
  const value = await tables.ask(target, selector, args, path);
  return typeof value === "number" ? floatFromBits(value) : undefined;
}
async function title(
  tables: TableViews,
  self: number,
  selector: string,
  section: number,
): Promise<string | undefined> {
  const value = await tables.ask(tables.get(self).dataSource, selector, [self, section]);
  return typeof value === "number" && value ? tables.host.text(value) : undefined;
}
/** Asks the data source and delegate for one section's rows, heights, titles and views. */
export async function querySection(
  tables: TableViews,
  self: number,
  section: number,
  views: number[],
): Promise<SectionInput> {
  const state = tables.get(self),
    delegate = tables.delegate(self),
    count = integerResult(
      await tables.ask(state.dataSource, "tableView:numberOfRowsInSection:", [self, section]),
    ),
    rows: number[] = [];
  if (count < 0) throw new Error(`UITableView section ${section} has ${count} rows.`);
  for (let row = 0; row < count; row++)
    rows.push(
      (await float(
        tables,
        delegate,
        "tableView:heightForRowAtIndexPath:",
        [self],
        [section, row],
      )) ?? state.rowHeight,
    );
  const titles = {
    header: await title(tables, self, "tableView:titleForHeaderInSection:", section),
    footer: await title(tables, self, "tableView:titleForFooterInSection:", section),
  };
  state.titles[section] = titles;
  const height = async (kind: "Header" | "Footer"): Promise<number> => {
    const view = pointerResult(
      await tables.ask(delegate, `tableView:viewFor${kind}InSection:`, [self, section]),
    );
    views.push(view ? tables.host.retain(view) : 0);
    const viewHeight = view ? tables.host.view(view).frame[GeometryField.Height] : undefined;
    return (
      (await float(tables, delegate, `tableView:heightFor${kind}InSection:`, [self, section])) ??
      viewHeight ??
      defaultTitleHeight(
        state.style,
        kind === "Footer",
        titles[kind === "Header" ? "header" : "footer"],
      )
    );
  };
  return { rows, header: await height("Header"), footer: await height("Footer") };
}
