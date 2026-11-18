import { SegmentMetric, SegmentedStyle } from "./model";

type Context = CanvasRenderingContext2D;
export const SEGMENT_FONT = "bold 13px Helvetica, Arial, sans-serif";
const CHANNEL_MAX = 255;
const CORNER_RADIUS = 6;
const DISABLED_ALPHA = 0.4;
const Shade = { Light: 1.2, Dark: 0.75, Selected: 0.62, Border: 0.5 } as const;
interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}
const Palette = {
  Plain: { red: 0.97, green: 0.97, blue: 0.97 },
  PlainSelected: { red: 0.25, green: 0.47, blue: 0.85 },
  PlainText: { red: 0.3, green: 0.3, blue: 0.3 },
  Bar: { red: 0.42, green: 0.51, blue: 0.64 },
} as const satisfies Record<string, Rgb>;

export interface SegmentPaint {
  readonly x: number;
  readonly width: number;
  readonly enabled: boolean;
  readonly title?: string | undefined;
  readonly image?: number | undefined;
  readonly imageSize?: readonly [number, number] | undefined;
}
export interface SegmentedPaint {
  readonly style: number;
  readonly tint: readonly number[] | undefined;
  readonly selected: number;
  readonly pressed: number;
  readonly segments: readonly SegmentPaint[];
}
type DrawImage = (image: number, x: number, y: number, width: number, height: number) => void;

function css(rgb: Rgb, factor: number): string {
  const channel = (value: number): number =>
    Math.round(Math.min(1, Math.max(0, value * factor)) * CHANNEL_MAX);
  return `rgb(${channel(rgb.red)},${channel(rgb.green)},${channel(rgb.blue)})`;
}
function tinted(paint: SegmentedPaint): Rgb | undefined {
  if (paint.tint) {
    const [red = 0, green = 0, blue = 0] = paint.tint;
    return { red, green, blue };
  }
  return paint.style === SegmentedStyle.Bar || paint.style === SegmentedStyle.Bezeled
    ? Palette.Bar
    : undefined;
}
function fill(context: Context, rgb: Rgb, factor: number, y: number, height: number): void {
  const gradient = context.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, css(rgb, Shade.Light * factor));
  gradient.addColorStop(1, css(rgb, Shade.Dark * factor));
  context.fillStyle = gradient;
}
function drawContent(
  context: Context,
  item: SegmentPaint,
  centerY: number,
  color: string,
  drawImage: DrawImage,
): void {
  const centerX = item.x + item.width * SegmentMetric.Half;
  if (item.image && item.imageSize) {
    const [width, height] = item.imageSize;
    drawImage(
      item.image,
      centerX - width * SegmentMetric.Half,
      centerY - height * SegmentMetric.Half,
      width,
      height,
    );
    return;
  }
  if (!item.title) return;
  context.font = SEGMENT_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(item.title, centerX, centerY, Math.max(0, item.width - SegmentMetric.Padding));
}
/** Draws segment backgrounds, dividers and contents in control coordinates. */
export function drawSegmented(
  context: Context,
  bounds: readonly number[],
  paint: SegmentedPaint,
  drawImage: DrawImage,
): void {
  const [x = 0, y = 0, width = 0, height = 0] = bounds,
    tint = tinted(paint),
    base = tint ?? Palette.Plain;
  context.save();
  try {
    context.beginPath();
    context.roundRect(x, y, width, height, CORNER_RADIUS);
    context.clip();
    for (const [index, item] of paint.segments.entries()) {
      const active = index === paint.selected || index === paint.pressed,
        color = active && !tint ? Palette.PlainSelected : base;
      fill(context, color, active && tint ? Shade.Selected : 1, y, height);
      context.fillRect(x + item.x, y, item.width, height);
      if (index > 0) {
        context.fillStyle = css(base, Shade.Border);
        context.fillRect(x + item.x, y, 1, height);
      }
      context.globalAlpha = item.enabled ? 1 : DISABLED_ALPHA;
      drawContent(
        context,
        { ...item, x: x + item.x },
        y + height * SegmentMetric.Half,
        tint || active ? "white" : css(Palette.PlainText, 1),
        drawImage,
      );
      context.globalAlpha = 1;
    }
  } finally {
    context.restore();
  }
  context.save();
  try {
    context.beginPath();
    context.roundRect(
      x + SegmentMetric.Half,
      y + SegmentMetric.Half,
      width - 1,
      height - 1,
      CORNER_RADIUS,
    );
    context.strokeStyle = css(base, Shade.Border);
    context.stroke();
  } finally {
    context.restore();
  }
}
