import type { Rectangle } from "../host";
import type { CellState } from "./cells";
import type { TableHost } from "./host";
import { AccessoryType, CellStyle, TableMetric } from "./model";

const Layout = { TitleShare: 0.55, ValueTwoTitle: 67, ValueTwoGap: 6, Separator: 1 } as const;

function layoutContent(host: TableHost, state: CellState, width: number, height: number): void {
  let x = TableMetric.CellPadding;
  if (state.imageView) {
    const image = host.viewImage(state.imageView),
      [iw, ih] = image ? host.imageSize(image) : [0, 0];
    host.setFrame(state.imageView, [x, (height - ih) * TableMetric.Half, iw, ih]);
    if (iw) x += iw + TableMetric.CellPadding;
  }
  const text = Math.max(0, width - x - TableMetric.CellPadding),
    split = height * Layout.TitleShare,
    frames: Record<number, readonly [Rectangle, Rectangle]> = {
      [CellStyle.Subtitle]: [
        [x, 0, text, split],
        [x, split, text, height - split],
      ],
      [CellStyle.Value2]: [
        [x, 0, Layout.ValueTwoTitle, height],
        [
          x + Layout.ValueTwoTitle + Layout.ValueTwoGap,
          0,
          Math.max(0, text - Layout.ValueTwoTitle - Layout.ValueTwoGap),
          height,
        ],
      ],
    };
  const [title, detail] = frames[state.style] ?? [
    [x, 0, text, height],
    [x, 0, text, height],
  ];
  if (state.textLabel) host.setFrame(state.textLabel, title);
  if (state.detailLabel) host.setFrame(state.detailLabel, detail);
}

/** Lays out the views a cell owns; custom subviews keep their frames. */
export function layoutCell(host: TableHost, state: CellState, bounds: Rectangle): void {
  const [, , width, height] = bounds;
  for (const view of [state.backgroundView, state.selectedBackgroundView])
    if (view) host.setFrame(view, [0, 0, width, height]);
  let right = width;
  if (state.accessoryView) {
    const [, , accessoryWidth, accessoryHeight] = host.view(state.accessoryView).frame;
    right = width - accessoryWidth - TableMetric.CellPadding;
    host.setFrame(state.accessoryView, [
      right,
      (height - accessoryHeight) * TableMetric.Half,
      accessoryWidth,
      accessoryHeight,
    ]);
  } else if (state.accessory !== AccessoryType.None)
    right = width - TableMetric.AccessoryWidth - TableMetric.CellPadding;
  const contentHeight = height - (state.separator ? Layout.Separator : 0);
  if (state.content) host.setFrame(state.content, [0, 0, right, contentHeight]);
  layoutContent(host, state, right, contentHeight);
}
