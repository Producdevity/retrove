import { floatBits, floatFromBits, GeometryField } from "../../abi/scalars";
import { Argument, type HostMethod } from "../../objc/host";
import { objectResult, type Rectangle } from "../host";
import type { Cells, CellView } from "./cells";
import { integerResult, TableClass, type TableHost } from "./host";
import { CellStyle, TableStyle } from "./model";

const FRAME_IDENTIFIER = 4;
const LABEL_FORWARDS = [
  ["text", "setText:", "text", "setText:"],
  ["font", "setFont:", "font", "setFont:"],
  ["textColor", "setTextColor:", "textColor", "setTextColor:"],
  ["textAlignment", "setTextAlignment:", "textAlignment", "setTextAlignment:"],
  ["lineBreakMode", "setLineBreakMode:", "lineBreakMode", "setLineBreakMode:"],
  [
    "selectedTextColor",
    "setSelectedTextColor:",
    "highlightedTextColor",
    "setHighlightedTextColor:",
  ],
] as const;

function readRect(args: (index: number) => number): Rectangle {
  return [
    floatFromBits(args(GeometryField.X)),
    floatFromBits(args(GeometryField.Y)),
    floatFromBits(args(GeometryField.Width)),
    floatFromBits(args(GeometryField.Height)),
  ];
}

/** UITableViewCell methods, including the iPhone OS 2 text and image accessors. */
export function installCellMethods(host: TableHost, cells: Cells): void {
  const method = (selector: string, implementation: HostMethod) =>
    host.method(TableClass.Cell, false, selector, implementation);
  method("init", (self) => cells.setup(self, CellStyle.Default, 0));
  method("initWithCoder:", (self, args) => decodeCell(host, cells, self, args(Argument.First)));
  method("initWithFrame:", (self, args) => cells.setup(self, CellStyle.Default, 0, readRect(args)));
  method("initWithStyle:reuseIdentifier:", (self, args) =>
    cells.setup(self, args(Argument.First), args(Argument.Second)),
  );
  method("initWithFrame:reuseIdentifier:", (self, args) =>
    cells.setup(self, CellStyle.Default, args(FRAME_IDENTIFIER), readRect(args)),
  );
  method("reuseIdentifier", (self) => cells.get(self).reuseString);
  method("contentView", async (self) => {
    const state = cells.get(self);
    if (!state.content) await cells.setup(self, state.style, 0, host.view(self).frame);
    return state.content;
  });
  method("textLabel", (self) => cells.textLabel(self));
  method("detailTextLabel", (self) => cells.detailLabel(self));
  method("imageView", (self) => cells.imageView(self));
  for (const [getter, setter, field] of [
    ["selectionStyle", "setSelectionStyle:", "selectionStyle"],
    ["accessoryType", "setAccessoryType:", "accessory"],
  ] as const) {
    method(getter, (self) => cells.get(self)[field]);
    method(setter, (self, args) => {
      cells.get(self)[field] = args(Argument.First);
      const view = host.view(self);
      view.needsDisplay = view.needsLayout = true;
    });
  }
  for (const [getter, field] of [
    ["accessoryView", "accessoryView"],
    ["backgroundView", "backgroundView"],
    ["selectedBackgroundView", "selectedBackgroundView"],
  ] as const satisfies readonly (readonly [string, CellView])[]) {
    method(getter, (self) => cells.get(self)[field]);
    method(`set${getter[0]?.toUpperCase() ?? ""}${getter.slice(1)}:`, (self, args) =>
      cells.replace(self, field, args(Argument.First)),
    );
  }
  for (const [getter, field] of [
    ["Selected", "selected"],
    ["Highlighted", "highlighted"],
  ] as const) {
    method(`is${getter}`, (self) => Number(cells.get(self)[field]));
    method(`set${getter}:`, (self, args) =>
      host.send(self, `set${getter}:animated:`, [args(Argument.First), 0]),
    );
    method(`set${getter}:animated:`, (self, args) =>
      cells.mark(self, field, Boolean(args(Argument.First))),
    );
  }
  for (const selector of ["prepareForReuse", "setEditing:animated:", "setShowsReorderControl:"])
    method(selector, () => {});
  method("layoutSubviews", (self) => cells.layout(self));
  for (const [getter, setter, labelGetter, labelSetter] of LABEL_FORWARDS) {
    method(getter, async (self) => host.send(await cells.textLabel(self), labelGetter));
    method(setter, async (self, args) =>
      host.send(await cells.textLabel(self), labelSetter, [args(Argument.First)]),
    );
  }
  method("image", async (self) => host.send(await cells.imageView(self), "image"));
  method("setImage:", async (self, args) => {
    await host.send(await cells.imageView(self), "setImage:", [args(Argument.First)]);
    host.view(self).needsLayout = true;
  });
  method("dealloc", (self) => cells.destroy(self));
}

const CODER_VIEWS = [
  ["UIContentView", "content"],
  ["UITextLabel", "textLabel"],
  ["UIDetailTextLabel", "detailLabel"],
  ["UIImageView", "imageView"],
] as const;
/** Decodes a nib cell; owned views that are not in the hierarchy join the content view. */
async function decodeCell(host: TableHost, cells: Cells, self: number, coder: number) {
  await host.decodeView(self, coder);
  const state = cells.get(self),
    decode = async (selector: string, key: string) =>
      (await host.send(coder, "containsValueForKey:", [host.string(key)]))
        ? integerResult(await host.send(coder, selector, [host.string(key)]))
        : undefined;
  for (const [key, field] of CODER_VIEWS) {
    const view = (await decode("decodeObjectForKey:", key)) ?? 0;
    if (!view) continue;
    state[field] = view;
    const parent = field === "content" ? self : state.content || self;
    if (!host.parent(view)) await host.send(parent, "addSubview:", [view]);
  }
  const identifier = (await decode("decodeObjectForKey:", "UIReuseIdentifier")) ?? 0;
  if (identifier) {
    state.reuseString = host.retain(identifier);
    state.reuse = host.text(identifier);
  }
  state.selectionStyle =
    (await decode("decodeIntegerForKey:", "UISelectionStyle")) ?? state.selectionStyle;
  state.accessory = (await decode("decodeIntegerForKey:", "UIAccessoryType")) ?? state.accessory;
  return self;
}

/** UITableViewController: a view controller whose view is a table it serves. */
export function installTableControllers(host: TableHost): void {
  const styles = new Map<number, number>(),
    clears = new Map<number, boolean>(),
    method = (selector: string, implementation: HostMethod) =>
      host.method(TableClass.Controller, false, selector, implementation);
  method("initWithStyle:", (self, args) => {
    styles.set(self, args(Argument.First));
    return self;
  });
  method("loadView", async (self) => {
    const [width, height] = host.screenSize(),
      table = objectResult(
        await host.send(host.alloc(host.classNamed(TableClass.Table)), "initWithFrame:style:", [
          ...[0, 0, width, height].map(floatBits),
          styles.get(self) ?? TableStyle.Plain,
        ]),
      );
    await host.send(table, "setDataSource:", [self]);
    await host.send(table, "setDelegate:", [self]);
    await host.send(self, "setView:", [table]);
    await host.release(table);
  });
  method("tableView", (self) => host.send(self, "view"));
  method("setTableView:", (self, args) => host.send(self, "setView:", [args(Argument.First)]));
  method("clearsSelectionOnViewWillAppear", (self) => Number(clears.get(self) ?? true));
  method("setClearsSelectionOnViewWillAppear:", (self, args) => {
    clears.set(self, Boolean(args(Argument.First)));
  });
}
