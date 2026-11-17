import {
  AccessoryType,
  SectionView,
  SelectionStyle,
  TableMetric,
  TableStyle,
  sectionViewIndex,
  type TableLayout,
} from "./model";
import type { Rectangle } from "../host";
import type { SectionTitles } from "./table-views";

type Context = CanvasRenderingContext2D;
const CHANNEL_MAX = 255;
const Color = {
  Plain: "#ffffff",
  Grouped: "#c5ccd4",
  GroupBorder: "#a9abad",
  GroupedTitle: "#4c566c",
  HeaderTop: "#90a0ab",
  HeaderBottom: "#b8c1c8",
  Accessory: "#808080",
  Check: "#32508c",
  DetailButton: "#2364d8",
} as const;
const Selection = {
  [SelectionStyle.Blue]: ["#058cf5", "#015ee6"],
  [SelectionStyle.Gray]: ["#bdbdbd", "#8e8e8e"],
} as const;
const Font = {
  PlainHeader: "bold 18px Helvetica, Arial, sans-serif",
  GroupedHeader: "bold 17px Helvetica, Arial, sans-serif",
  GroupedFooter: "15px Helvetica, Arial, sans-serif",
} as const;
const Glyph = { Chevron: 4, Check: 6, Button: 11, Line: 3, ButtonLine: 2 } as const;
const GROUP_RADIUS = 10;
const SIDES = 2;
const TEXT_BOTTOM = 8;
const SHADOW = 1;

function css(rgba: readonly number[]): string {
  const [red = 0, green = 0, blue = 0, alpha = 1] = rgba;
  return `rgba(${[red, green, blue].map((value) => Math.round(value * CHANNEL_MAX)).join(",")},${alpha})`;
}
function title(context: Context, text: string, x: number, y: number, font: string, color: string) {
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "alphabetic";
  context.fillText(text, x, y);
}
/** Draws a section's title in plain or grouped style, in content coordinates. */
function drawTitles(
  context: Context,
  style: number,
  width: number,
  layout: TableLayout,
  titles: readonly SectionTitles[],
  views: readonly number[],
): void {
  layout.sections.forEach((section, index) => {
    const { header, footer } = titles[index] ?? { header: undefined, footer: undefined },
      hasHeaderView = Boolean(views[sectionViewIndex(index, SectionView.Header)]),
      hasFooterView = Boolean(views[sectionViewIndex(index, SectionView.Footer)]);
    if (header && !hasHeaderView && section.header > 0) {
      if (style === TableStyle.Plain) {
        const gradient = context.createLinearGradient(
          0,
          section.top,
          0,
          section.top + section.header,
        );
        gradient.addColorStop(0, Color.HeaderTop);
        gradient.addColorStop(1, Color.HeaderBottom);
        context.fillStyle = gradient;
        context.fillRect(0, section.top, width, section.header);
        context.shadowColor = "rgba(0,0,0,0.4)";
        context.shadowOffsetY = SHADOW;
        title(
          context,
          header,
          TableMetric.CellPadding + TableMetric.CellPadding,
          section.top + section.header - TableMetric.Half * TEXT_BOTTOM,
          Font.PlainHeader,
          "white",
        );
      } else {
        context.shadowColor = "white";
        context.shadowOffsetY = SHADOW;
        title(
          context,
          header,
          TableMetric.GroupedInset * SIDES,
          section.top + section.header - TEXT_BOTTOM,
          Font.GroupedHeader,
          Color.GroupedTitle,
        );
      }
      context.shadowColor = "transparent";
    }
    if (footer && !hasFooterView && style === TableStyle.Grouped && section.footer > 0) {
      context.textAlign = "center";
      title(
        context,
        footer,
        width * TableMetric.Half,
        section.bottom - TEXT_BOTTOM,
        Font.GroupedFooter,
        Color.GroupedTitle,
      );
      context.textAlign = "start";
    }
  });
}
export interface TablePaint {
  readonly style: number;
  readonly background: boolean;
  readonly layout: TableLayout;
  readonly titles: readonly SectionTitles[];
  readonly sectionViews: readonly number[];
}
export function drawTable(context: Context, bounds: Rectangle, table: TablePaint): void {
  const [x, y, width, height] = bounds;
  context.save();
  try {
    if (!table.background) {
      context.fillStyle = table.style === TableStyle.Grouped ? Color.Grouped : Color.Plain;
      context.fillRect(x, y, width, height);
    }
    if (table.style === TableStyle.Grouped)
      for (const section of table.layout.sections) {
        const top = section.offsets[0],
          rows = section.bottom - section.footer - (top ?? 0);
        if (top === undefined || rows <= 0) continue;
        context.beginPath();
        context.roundRect(
          TableMetric.GroupedInset,
          top,
          width - TableMetric.GroupedInset * SIDES,
          rows,
          GROUP_RADIUS,
        );
        context.fillStyle = Color.Plain;
        context.fill();
        context.strokeStyle = Color.GroupBorder;
        context.stroke();
      }
    drawTitles(context, table.style, width, table.layout, table.titles, table.sectionViews);
  } finally {
    context.restore();
  }
}

export interface CellPaint {
  readonly selectionStyle: number;
  readonly lit: boolean;
  readonly customSelection: boolean;
  readonly separator: readonly number[] | undefined;
  readonly accessory: number;
  readonly accessoryView: boolean;
}
function drawAccessory(context: Context, type: number, width: number, height: number): void {
  const x = width - TableMetric.CellPadding - TableMetric.AccessoryWidth * TableMetric.Half,
    y = height * TableMetric.Half;
  context.lineWidth = Glyph.Line;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (type === AccessoryType.DisclosureIndicator) {
    context.strokeStyle = Color.Accessory;
    context.moveTo(x - Glyph.Chevron, y - Glyph.Chevron * SIDES);
    context.lineTo(x + Glyph.Chevron, y);
    context.lineTo(x - Glyph.Chevron, y + Glyph.Chevron * SIDES);
  } else if (type === AccessoryType.Checkmark) {
    context.strokeStyle = Color.Check;
    context.moveTo(x - Glyph.Check, y);
    context.lineTo(x - Glyph.Check * TableMetric.Half, y + Glyph.Check);
    context.lineTo(x + Glyph.Check, y - Glyph.Check);
  } else if (type === AccessoryType.DetailDisclosureButton) {
    context.fillStyle = Color.DetailButton;
    context.arc(x, y, Glyph.Button, 0, Math.PI * SIDES);
    context.fill();
    context.beginPath();
    context.strokeStyle = "white";
    context.lineWidth = Glyph.ButtonLine;
    context.moveTo(x - Glyph.Chevron * TableMetric.Half, y - Glyph.Chevron);
    context.lineTo(x + Glyph.Chevron * TableMetric.Half, y);
    context.lineTo(x - Glyph.Chevron * TableMetric.Half, y + Glyph.Chevron);
  }
  context.stroke();
}
export function drawCell(context: Context, bounds: Rectangle, cell: CellPaint): void {
  const [x, y, width, height] = bounds;
  context.save();
  try {
    const colors =
      cell.selectionStyle === SelectionStyle.Blue || cell.selectionStyle === SelectionStyle.Gray
        ? Selection[cell.selectionStyle]
        : undefined;
    if (cell.lit && colors && !cell.customSelection) {
      const gradient = context.createLinearGradient(0, y, 0, y + height);
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(1, colors[1]);
      context.fillStyle = gradient;
      context.fillRect(x, y, width, height);
    }
    if (cell.separator) {
      context.fillStyle = css(cell.separator);
      context.fillRect(x, y + height - 1, width, 1);
    }
    if (!cell.accessoryView) drawAccessory(context, cell.accessory, x + width, y + height);
  } finally {
    context.restore();
  }
}
