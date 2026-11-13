import { floatBits, floatFromBits } from "../abi/scalars";
import { Argument } from "../objc/host";
import { fontNames } from "./font-names";
import { UIKitClass, type UIKitHost } from "./host";

export const SYSTEM_FONT_SIZE = 17;
const FONT_READ_LIMIT = 16_777_216;
const FONT_LINE_HEIGHT = 1.2;
export interface Font {
  readonly family: string;
  readonly name: string;
  readonly size: number;
  readonly weight: string;
  readonly style: string;
}
export const defaultFont: Font = {
  family: "sans-serif",
  name: "Helvetica",
  size: SYSTEM_FONT_SIZE,
  weight: "normal",
  style: "normal",
};
export function canvasFont(font: Font): string {
  return `${font.style} ${font.weight} ${font.size}px ${font.family}`;
}
export function fontLineHeight(font: Font): number {
  return font.size * FONT_LINE_HEIGHT;
}
export class Fonts {
  private readonly objects = new Map<number, Font>();
  private readonly families = new Map<string, string>();
  private readonly faces: FontFace[] = [];
  private loading: Promise<void> | undefined;
  private closed = false;
  private readonly classPointer: number;
  constructor(private readonly host: UIKitHost) {
    this.classPointer = host.hostClass(UIKitClass.Font, UIKitClass.Object);
  }
  get(pointer: number): Font {
    if (!pointer) return defaultFont;
    const font = this.objects.get(pointer);
    if (!font) throw new Error("UIFont has not been initialized.");
    return font;
  }
  create(font: Font): number {
    if (!Number.isFinite(font.size) || font.size <= 0) throw new Error("Invalid font size.");
    const pointer = this.host.alloc(this.classPointer);
    this.objects.set(pointer, font);
    return this.host.autorelease(pointer);
  }
  async named(name: string, size: number): Promise<number> {
    await (this.loading ??= this.load());
    const family = this.families.get(name.toLowerCase());
    if (family) return this.create({ ...defaultFont, name, family, size });
    if (
      /^(Helvetica(?:Neue)?|Arial|Courier|TimesNewRoman)(?:-(Bold|Italic|BoldItalic))?$/.test(name)
    ) {
      return this.create({
        ...defaultFont,
        name,
        size,
        family: name.startsWith("Courier")
          ? "monospace"
          : name.startsWith("Times")
            ? "serif"
            : "sans-serif",
        weight: name.includes("Bold") ? "bold" : "normal",
        style: name.includes("Italic") ? "italic" : "normal",
      });
    }
    return 0;
  }
  private async load(): Promise<void> {
    const declared: unknown = this.host.ipa.info.UIAppFonts;
    if (!Array.isArray(declared)) return;
    for (const path of declared) {
      if (typeof path !== "string" || path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("Invalid bundled font path.");
      const bytes = await this.host.ipa.read(`${this.host.ipa.bundlePath}/${path}`, {
        maxBytes: FONT_READ_LIMIT,
      });
      const names = fontNames(bytes);
      const family = `retrove-guest-font-${this.faces.length}`;
      if (this.host.document) {
        const face = await new FontFace(family, bytes).load();
        if (this.closed) return;
        this.host.document.fonts.add(face);
        this.faces.push(face);
      }
      for (const name of names) this.families.set(name.toLowerCase(), family);
    }
  }
  install(): void {
    const host = this.host;
    host.method(UIKitClass.Font, true, "fontWithName:size:", (_self, args) =>
      args(Argument.First)
        ? this.named(host.text(args(Argument.First)), floatFromBits(args(Argument.Second)))
        : 0,
    );
    for (const [selector, weight, style] of [
      ["systemFontOfSize:", "normal", "normal"],
      ["boldSystemFontOfSize:", "bold", "normal"],
      ["italicSystemFontOfSize:", "normal", "italic"],
    ] as const) {
      host.method(UIKitClass.Font, true, selector, (_self, args) =>
        this.create({ ...defaultFont, size: floatFromBits(args(Argument.First)), weight, style }),
      );
    }
    host.method(UIKitClass.Font, false, "fontWithSize:", (self, args) =>
      this.create({ ...this.get(self), size: floatFromBits(args(Argument.First)) }),
    );
    host.method(UIKitClass.Font, false, "pointSize", (self) => floatBits(this.get(self).size));
    host.method(UIKitClass.Font, false, "lineHeight", (self) =>
      floatBits(fontLineHeight(this.get(self))),
    );
    host.method(UIKitClass.Font, false, "fontName", (self) => host.string(this.get(self).name));
    host.method(UIKitClass.Font, false, "dealloc", (self) => {
      this.objects.delete(self);
      host.destroy(self);
    });
  }
  close(): void {
    this.closed = true;
    for (const face of this.faces) this.host.document?.fonts.delete(face);
    this.faces.length = 0;
    this.objects.clear();
    this.families.clear();
  }
}
