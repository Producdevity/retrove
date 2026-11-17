import { BarItemStyle, BarStyle, ToolbarMetric } from "./model";

type Context = CanvasRenderingContext2D;
export const TITLE_FONT = "bold 12px Helvetica, Arial, sans-serif";
export const GLYPH_FONT = "18px Helvetica, Arial, sans-serif";
const CHANNEL_MAX = 255;
const Shade = { Light: 1.25, Dark: 0.7, Pressed: 0.6, Border: 0.45 } as const;
const DISABLED_ALPHA = 0.4;
const CORNER_RADIUS = 5;
const SHADOW_OFFSET = -1;
interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}
const BarColor = {
  Blue: { red: 0.42, green: 0.51, blue: 0.64 },
  Black: { red: 0.12, green: 0.12, blue: 0.12 },
  Done: { red: 0.13, green: 0.36, blue: 0.83 },
} as const satisfies Record<string, Rgb>;

export interface ItemPaint {
  readonly x: number;
  readonly width: number;
  readonly style: number;
  readonly enabled: boolean;
  readonly pressed: boolean;
  readonly title?: string | undefined;
  readonly glyph?: string | undefined;
  readonly image?: number | undefined;
  readonly imageSize?: readonly [number, number] | undefined;
}
export interface BarPaint {
  readonly style: number;
  /** Tint as 0–1 RGB(A); replaces the bar style's color. */
  readonly tint: readonly number[] | undefined;
}

function shade(rgb: Rgb, factor: number): string {
  const channel = (value: number): number =>
    Math.round(Math.min(1, Math.max(0, value * factor)) * CHANNEL_MAX);
  return `rgb(${channel(rgb.red)},${channel(rgb.green)},${channel(rgb.blue)})`;
}
function base(bar: BarPaint): Rgb {
  if (bar.tint) {
    const [red = 0, green = 0, blue = 0] = bar.tint;
    return { red, green, blue };
  }
  return bar.style === BarStyle.Default ? BarColor.Blue : BarColor.Black;
}
function roundedRect(context: Context, x: number, y: number, width: number, height: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, CORNER_RADIUS);
}
function drawButton(context: Context, item: ItemPaint, y: number, rgb: Rgb): void {
  if (item.style === BarItemStyle.Plain) return;
  const color = item.style === BarItemStyle.Done ? BarColor.Done : rgb,
    factor = item.pressed ? Shade.Pressed : 1,
    gradient = context.createLinearGradient(0, y, 0, y + ToolbarMetric.ButtonHeight);
  gradient.addColorStop(0, shade(color, Shade.Light * factor));
  gradient.addColorStop(1, shade(color, Shade.Dark * factor));
  roundedRect(context, item.x, y, item.width, ToolbarMetric.ButtonHeight);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = shade(color, Shade.Border);
  context.stroke();
}
function drawContent(
  context: Context,
  item: ItemPaint,
  centerY: number,
  drawImage: (image: number, x: number, y: number, width: number, height: number) => void,
): void {
  const centerX = item.x + item.width * ToolbarMetric.Half;
  if (item.image && item.imageSize) {
    const [width, height] = item.imageSize;
    drawImage(
      item.image,
      centerX - width * ToolbarMetric.Half,
      centerY - height * ToolbarMetric.Half,
      width,
      height,
    );
    return;
  }
  const text = item.title ?? item.glyph;
  if (!text) return;
  context.font = item.title === undefined ? GLYPH_FONT : TITLE_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "white";
  context.shadowColor = "rgba(0,0,0,0.5)";
  context.shadowOffsetY = SHADOW_OFFSET;
  context.fillText(text, centerX, centerY);
}
/** Draws the bar gradient and its non-custom items in bar coordinates. */
export function drawToolbar(
  context: Context,
  bounds: readonly number[],
  bar: BarPaint,
  items: readonly ItemPaint[],
  drawImage: (image: number, x: number, y: number, width: number, height: number) => void,
): void {
  const [x = 0, y = 0, width = 0, height = 0] = bounds,
    rgb = base(bar),
    gradient = context.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, shade(rgb, Shade.Light));
  gradient.addColorStop(1, shade(rgb, Shade.Dark));
  context.save();
  try {
    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);
    context.fillStyle = shade(rgb, Shade.Border);
    context.fillRect(x, y, width, 1);
    const centerY = y + height * ToolbarMetric.Half,
      buttonY = centerY - ToolbarMetric.ButtonHeight * ToolbarMetric.Half;
    for (const item of items) {
      context.save();
      context.translate(x, 0);
      context.globalAlpha = item.enabled ? 1 : DISABLED_ALPHA;
      drawButton(context, item, buttonY, rgb);
      drawContent(context, item, centerY, drawImage);
      context.restore();
    }
  } finally {
    context.restore();
  }
}
