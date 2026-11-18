import { svgImage } from "./svg-image";

/** Document coordinates, or viewport coordinates when `pinned` (inside a fixed element). */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pinned: boolean;
}
type Paint =
  | { readonly kind: "fill"; readonly box: Box; readonly radius: number; readonly color: string }
  | {
      readonly kind: "image";
      readonly box: Box;
      readonly radius: number;
      readonly image: CanvasImageSource;
    }
  | {
      readonly kind: "text";
      readonly box: Box;
      readonly text: string;
      readonly font: string;
      readonly color: string;
    };
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const HALF = 0.5;
const LUMA = { red: 0.2126, green: 0.7152, blue: 0.0722 };
const CHANNEL = 255;
/** Glass reads lighter than the ground it hides. */
const COVER_SHEEN = { dark: "rgb(255 255 255 / 12%)", light: "rgb(255 255 255 / 60%)" };
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$|\/ 0\)$/u;
const SKIPPED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "INPUT", "SELECT", "TEXTAREA", "CANVAS"]);

function visible(color: string): boolean {
  return color !== "" && !TRANSPARENT.test(color);
}
function luminance(color: string): number {
  const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/gu) ?? []).map(Number);
  return (LUMA.red * red + LUMA.green * green + LUMA.blue * blue) / CHANNEL;
}
function fontOf(style: CSSStyleDeclaration): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}
function intersects(box: Box, left: number, top: number, region: Region): boolean {
  const x = box.pinned ? region.x : left,
    y = box.pinned ? region.y : top;
  return !(
    box.y > y + region.height ||
    box.y + box.height < y ||
    box.x > x + region.width ||
    box.x + box.width < x
  );
}

/**
 * Repaints the page content that sits under glass controls. Browsers do not let WebGL read
 * page pixels, and WebKit ignores SVG filters in backdrop-filter, so the glass needs a copy.
 */
export class BackdropPainter {
  /** Whether the page under the glass is dark, so the material can match it. */
  dark = false;
  private paints: Paint[] = [];
  private stale = true;
  private covers: { element: Element; pinned: boolean }[] = [];
  private ground = "";
  private readonly measure = document.createElement("canvas").getContext("2d");
  constructor(
    private readonly root: HTMLElement,
    private readonly excluded: (element: Element) => boolean,
    /** Controls that hide what lies under them, as their glass does on screen. */
    private readonly opaque: (element: Element) => boolean = () => false,
  ) {}
  invalidate(): void {
    this.stale = true;
  }
  paint(context: CanvasRenderingContext2D, region: Region, scale: number): void {
    if (this.stale) this.collect();
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = this.ground;
    context.fillRect(0, 0, region.width, region.height);
    const left = region.x + scrollX,
      top = region.y + scrollY;
    for (const paint of this.paints) {
      if (!intersects(paint.box, left, top, region)) continue;
      const pinned = paint.box.pinned;
      context.setTransform(scale, 0, 0, scale, -(pinned ? region.x : left) * scale, 0);
      context.translate(0, -(pinned ? region.y : top));
      draw(context, paint);
    }
  }
  private collect(): void {
    this.stale = false;
    this.ground = getComputedStyle(document.body).backgroundColor;
    if (!visible(this.ground))
      this.ground = getComputedStyle(document.documentElement).backgroundColor;
    this.dark = luminance(this.ground) < HALF;
    this.paints = [];
    this.covers = [];
    this.walk(this.root, false);
    // Covering controls paint last, over whatever page content shares their box.
    for (const { element, pinned } of this.covers.splice(0)) this.walk(element, pinned, true);
  }
  private box(rect: DOMRect, pinned: boolean): Box {
    const x = pinned ? 0 : scrollX,
      y = pinned ? 0 : scrollY;
    return { x: rect.left + x, y: rect.top + y, width: rect.width, height: rect.height, pinned };
  }
  private walk(element: Element, insideFixed: boolean, covering = false): void {
    if (SKIPPED.has(element.tagName) || this.excluded(element)) return;
    if (!covering && this.opaque(element)) {
      this.covers.push({ element, pinned: insideFixed });
      return;
    }
    if (element instanceof HTMLElement && element.hidden) return;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
    const pinned = insideFixed || style.position === "fixed";
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && style.display !== "contents") return;
    const box = this.box(rect, pinned);
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    if (covering && this.opaque(element)) {
      this.paints.push({ kind: "fill", box, radius, color: this.ground });
      const color = this.dark ? COVER_SHEEN.dark : COVER_SHEEN.light;
      this.paints.push({ kind: "fill", box, radius, color });
    }
    if (visible(style.backgroundColor))
      this.paints.push({ kind: "fill", box, radius, color: style.backgroundColor });
    const border = Number.parseFloat(style.borderTopWidth);
    if (border > 0 && style.borderTopStyle !== "none" && visible(style.borderTopColor))
      this.paints.push({
        kind: "fill",
        box: { ...box, height: border },
        radius: 0,
        color: style.borderTopColor,
      });
    if (element instanceof SVGSVGElement) {
      const image = svgImage(element, style.color, () => this.invalidate());
      if (image) this.paints.push({ kind: "image", box, radius: 0, image });
      return;
    }
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0) {
      this.paints.push({ kind: "image", box, radius, image: element });
      return;
    }
    // WebKit keeps layout boxes for the contents of a closed <details>.
    const closed = element instanceof HTMLDetailsElement && !element.open;
    for (const child of element.childNodes) {
      if (closed && !(child instanceof HTMLElement && child.tagName === "SUMMARY")) continue;
      if (child instanceof Element) this.walk(child, pinned);
      else if (child instanceof Text) this.text(child, style, pinned);
    }
  }
  private text(node: Text, style: CSSStyleDeclaration, pinned: boolean): void {
    const content = node.data.replace(/\s+/gu, " ").trim();
    if (!content || !this.measure) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const font = fontOf(style);
    this.measure.font = font;
    const words = content.split(" ");
    for (const line of lines) {
      let text = words.shift() ?? "";
      while (words.length) {
        const next = `${text} ${words[0]}`;
        if (lines.length > 1 && this.measure.measureText(next).width > line.width + 1) break;
        text = next;
        words.shift();
      }
      const box = this.box(line, pinned);
      this.paints.push({ kind: "text", box, text, font, color: style.color });
    }
  }
}

function draw(context: CanvasRenderingContext2D, paint: Paint): void {
  const { box } = paint;
  if (paint.kind === "text") {
    context.font = paint.font;
    context.fillStyle = paint.color;
    context.textBaseline = "alphabetic";
    const ascent = context.measureText(paint.text).fontBoundingBoxAscent;
    context.save();
    context.beginPath();
    context.rect(box.x, box.y, box.width, box.height);
    context.clip();
    context.fillText(paint.text, box.x, box.y + ascent);
    context.restore();
    return;
  }
  context.save();
  context.beginPath();
  context.roundRect(box.x, box.y, box.width, box.height, Math.min(paint.radius, box.height * HALF));
  if (paint.kind === "fill") {
    context.fillStyle = paint.color;
    context.fill();
  } else {
    context.clip();
    context.drawImage(paint.image, box.x, box.y, box.width, box.height);
  }
  context.restore();
}
