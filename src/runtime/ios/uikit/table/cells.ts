import { floatBits } from "../../abi/scalars";
import { objectResult, type Rectangle } from "../host";
import { AccessoryType, CellStyle, SelectionStyle, TableMetric } from "./model";
import type { TableHost } from "./host";
import { layoutCell } from "./cell-layout";

const LabelSize = { Default: 20, Subtitle: 18, Detail: 14, Value: 17, ValueTwo: 12 } as const;
const TextAlignment = { Right: 2 } as const;
const Gray = { Detail: 0.5 } as const;
const ValueColor = { red: 0.22, green: 0.33, blue: 0.53 } as const;
const DEFAULT_WIDTH = 320;

export interface CellState {
  style: number;
  reuse: string;
  reuseString: number;
  content: number;
  textLabel: number;
  detailLabel: number;
  imageView: number;
  accessory: number;
  accessoryView: number;
  backgroundView: number;
  selectedBackgroundView: number;
  selectionStyle: number;
  selected: boolean;
  highlighted: boolean;
  /** Separator line color from the table showing the cell. */
  separator: readonly number[] | undefined;
}
export type CellView = "accessoryView" | "backgroundView" | "selectedBackgroundView";

/** UITableViewCell state, subviews and layout. */
export class Cells {
  readonly states = new Map<number, CellState>();
  constructor(private readonly host: TableHost) {}
  get(self: number): CellState {
    let state = this.states.get(self);
    if (!state) {
      state = {
        style: CellStyle.Default,
        reuse: "",
        reuseString: 0,
        content: 0,
        textLabel: 0,
        detailLabel: 0,
        imageView: 0,
        accessory: AccessoryType.None,
        accessoryView: 0,
        backgroundView: 0,
        selectedBackgroundView: 0,
        selectionStyle: SelectionStyle.Blue,
        selected: false,
        highlighted: false,
        separator: undefined,
      };
      this.states.set(self, state);
    }
    return state;
  }
  async setup(self: number, style: number, identifier: number, frame?: Rectangle): Promise<number> {
    const state = this.get(self);
    state.style = style;
    if (identifier && !state.reuseString) {
      state.reuseString = this.host.retain(identifier);
      state.reuse = this.host.text(identifier);
    }
    this.host.setFrame(self, frame ?? [0, 0, DEFAULT_WIDTH, TableMetric.RowHeight]);
    if (!state.content) state.content = await this.subview(self, "UIView");
    return self;
  }
  private async subview(parent: number, className: string): Promise<number> {
    const [, , width, height] = this.host.view(parent).bounds,
      view = objectResult(
        await this.host.send(
          this.host.alloc(this.host.classNamed(className)),
          "initWithFrame:",
          [0, 0, width, height].map(floatBits),
        ),
      );
    await this.host.send(parent, "addSubview:", [view]);
    await this.host.release(view);
    return view;
  }
  private async classSend(name: string, selector: string, args: number[] = []): Promise<number> {
    return objectResult(await this.host.send(this.host.classNamed(name), selector, args));
  }
  private async configure(
    label: number,
    size: number,
    bold: boolean,
    color?: number,
  ): Promise<void> {
    const font = await this.classSend(
      "UIFont",
      bold ? "boldSystemFontOfSize:" : "systemFontOfSize:",
      [floatBits(size)],
    );
    await this.host.send(label, "setFont:", [font]);
    await this.host.send(label, "setBackgroundColor:", [
      await this.classSend("UIColor", "clearColor"),
    ]);
    await this.host.send(label, "setHighlightedTextColor:", [
      await this.classSend("UIColor", "whiteColor"),
    ]);
    if (color) await this.host.send(label, "setTextColor:", [color]);
  }
  private async rgb(channels: readonly number[]): Promise<number> {
    return this.classSend(
      "UIColor",
      "colorWithRed:green:blue:alpha:",
      [...channels, 1].map(floatBits),
    );
  }
  async textLabel(self: number): Promise<number> {
    const state = this.get(self);
    if (state.textLabel) return state.textLabel;
    if (!state.content) await this.setup(self, state.style, 0, this.host.view(self).frame);
    state.textLabel = await this.subview(state.content, "UILabel");
    const size =
      state.style === CellStyle.Subtitle
        ? LabelSize.Subtitle
        : state.style === CellStyle.Value2
          ? LabelSize.ValueTwo
          : state.style === CellStyle.Value1
            ? LabelSize.Value
            : LabelSize.Default;
    await this.configure(
      state.textLabel,
      size,
      true,
      state.style === CellStyle.Value2
        ? await this.rgb([ValueColor.red, ValueColor.green, ValueColor.blue])
        : undefined,
    );
    if (state.style === CellStyle.Value2)
      await this.host.send(state.textLabel, "setTextAlignment:", [TextAlignment.Right]);
    this.host.view(self).needsLayout = true;
    return state.textLabel;
  }
  async detailLabel(self: number): Promise<number> {
    const state = this.get(self);
    if (state.detailLabel || state.style === CellStyle.Default) return state.detailLabel;
    await this.textLabel(self);
    state.detailLabel = await this.subview(state.content, "UILabel");
    if (state.style === CellStyle.Subtitle)
      await this.configure(
        state.detailLabel,
        LabelSize.Detail,
        false,
        await this.rgb([Gray.Detail, Gray.Detail, Gray.Detail]),
      );
    else if (state.style === CellStyle.Value1) {
      await this.configure(
        state.detailLabel,
        LabelSize.Value,
        false,
        await this.rgb([ValueColor.red, ValueColor.green, ValueColor.blue]),
      );
      await this.host.send(state.detailLabel, "setTextAlignment:", [TextAlignment.Right]);
    } else await this.configure(state.detailLabel, LabelSize.Value, true);
    this.host.view(self).needsLayout = true;
    return state.detailLabel;
  }
  async imageView(self: number): Promise<number> {
    const state = this.get(self);
    if (!state.imageView) {
      if (!state.content) await this.setup(self, state.style, 0, this.host.view(self).frame);
      state.imageView = await this.subview(state.content, "UIImageView");
      this.host.view(self).needsLayout = true;
    }
    return state.imageView;
  }
  async replace(self: number, field: CellView, view: number): Promise<void> {
    const state = this.get(self),
      old = state[field];
    if (old === view) return;
    state[field] = view ? this.host.retain(view) : 0;
    if (old) {
      if (this.host.parent(old) === self) await this.host.send(old, "removeFromSuperview");
      await this.host.release(old);
    }
    if (view) {
      await this.host.send(self, "addSubview:", [view]);
      if (field !== "accessoryView") await this.host.send(self, "sendSubviewToBack:", [view]);
    }
    if (field === "selectedBackgroundView" && view)
      await this.host.send(view, "setHidden:", [Number(!(state.selected || state.highlighted))]);
    this.host.view(self).needsLayout = true;
  }
  /** Applies a selected or highlighted change and highlights content that supports it. */
  async mark(self: number, field: "selected" | "highlighted", value: boolean): Promise<void> {
    const state = this.get(self);
    state[field] = value;
    const shown =
      state.selectionStyle !== SelectionStyle.None && (state.selected || state.highlighted);
    if (state.selectedBackgroundView)
      await this.host.send(state.selectedBackgroundView, "setHidden:", [Number(!shown)]);
    const walk = async (view: number): Promise<void> => {
      for (const child of this.host.children(view)) {
        if (child === state.selectedBackgroundView || child === state.backgroundView) continue;
        if (
          this.host.responds(child, "setHighlighted:") &&
          !this.host.responds(child, "sendActionsForControlEvents:")
        )
          await this.host.send(child, "setHighlighted:", [Number(shown)]);
        await walk(child);
      }
    };
    if (state.selectionStyle !== SelectionStyle.None) await walk(self);
    this.host.view(self).needsDisplay = true;
  }
  layout(self: number): void {
    const state = this.states.get(self);
    if (state) layoutCell(this.host, state, this.host.view(self).bounds);
  }
  async destroy(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    for (const owned of [
      state?.reuseString,
      state?.accessoryView,
      state?.backgroundView,
      state?.selectedBackgroundView,
    ])
      if (owned) await this.host.release(owned);
    await this.host.deallocateView(self);
  }
}
