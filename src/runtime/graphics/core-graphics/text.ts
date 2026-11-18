import { floatBits, floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import { glyphCharacters } from "./font-tables";
import { QuartzTable, type TableMemory } from "./quartz-table";

interface CGFont {
  readonly family: string;
  readonly characters: Map<number, number>;
}
type TextCanvas = Pick<
  CanvasRenderingContext2D,
  | "font"
  | "measureText"
  | "fillText"
  | "strokeText"
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "textBaseline"
  | "textAlign"
>;
interface TextState {
  font: number;
  size: number;
  mode: number;
  x: number;
  y: number;
}
interface TextHost extends TableMemory {
  readBytes(pointer: number, length: number): Uint8Array;
  cString(pointer: number): string;
  writeWord(pointer: number, value: number): void;
  /** File contents for CGDataProviderCreateWithFilename, or undefined when missing. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  /** Bytes behind a CFData-backed provider that the bitmap module created. */
  providerBytes(provider: number): Uint8Array | undefined;
  /** Makes a font usable by canvas text under `family`. */
  loadFont(family: string, bytes: Uint8Array): Promise<void>;
  paint(context: number, draw: (canvas: TextCanvas) => void): boolean;
}
const TextMode = { Fill: 0, Stroke: 1, FillStroke: 2, Invisible: 3 } as const;
const Glyphs = { Context: 0, X: 1, Y: 2, Address: 3, Count: 4 } as const;
const GLYPH_BYTES = 2;
const DEFAULT_FONT_SIZE = 12;
const REPLACEMENT = 0xfffd;

/** Characters for CGGlyph IDs, so canvas can draw text it only knows by glyph. */
export function glyphText(characters: Map<number, number>, glyphs: readonly number[]): string {
  return String.fromCodePoint(...glyphs.map((glyph) => characters.get(glyph) ?? REPLACEMENT));
}

function showGlyphs(
  host: TextHost,
  text: TextState,
  fonts: QuartzTable<CGFont>,
  args: GuestArguments,
): void {
  const font = fonts.get(text.font),
    count = Math.max(0, args(Glyphs.Count) | 0);
  text.x = floatFromBits(args(Glyphs.X));
  text.y = floatFromBits(args(Glyphs.Y));
  if (!font || !count) return;
  const bytes = host.readBytes(args(Glyphs.Address), count * GLYPH_BYTES),
    data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const glyphs = Array.from({ length: count }, (_, index) =>
    data.getUint16(index * GLYPH_BYTES, true),
  );
  const value = glyphText(font.characters, glyphs);
  host.paint(args(Glyphs.Context), (canvas) => {
    canvas.save();
    try {
      canvas.font = `${text.size}px "${font.family}"`;
      canvas.textAlign = "left";
      canvas.textBaseline = "alphabetic";
      const width = canvas.measureText(value).width;
      // Quartz text space is y-up with an identity text matrix; canvas glyphs are y-down.
      canvas.translate(text.x, text.y);
      canvas.scale(1, -1);
      if (text.mode === TextMode.Fill || text.mode === TextMode.FillStroke)
        canvas.fillText(value, 0, 0);
      if (text.mode === TextMode.Stroke || text.mode === TextMode.FillStroke)
        canvas.strokeText(value, 0, 0);
      text.x += width;
    } finally {
      canvas.restore();
    }
  });
}

/** CGFont from TrueType data and glyph drawing with CGContextShowGlyphsAtPoint. */
export function textImports(host: TextHost) {
  const providers = new QuartzTable<Uint8Array>(host),
    fonts = new QuartzTable<CGFont>(host),
    states = new Map<number, TextState>();
  let families = 0;
  const state = (context: number): TextState => {
    let value = states.get(context);
    if (!value)
      states.set(context, (value = { font: 0, size: DEFAULT_FONT_SIZE, mode: 0, x: 0, y: 0 }));
    return value;
  };
  const show = (args: GuestArguments) => showGlyphs(host, state(args(Glyphs.Context)), fonts, args);
  const imports = {
    _CGDataProviderCreateWithFilename: async (args: GuestArguments) => {
      const bytes = args(0) ? await host.readFile(host.cString(args(0))) : undefined;
      return bytes ? providers.add(bytes) : 0;
    },
    _CGFontCreateWithDataProvider: async (args: GuestArguments) => {
      const bytes = providers.get(args(0)) ?? host.providerBytes(args(0));
      if (!bytes) return 0;
      let characters: Map<number, number>;
      try {
        characters = glyphCharacters(bytes);
      } catch {
        return 0;
      }
      const family = `RetroveCGFont${++families}`;
      await host.loadFont(family, bytes);
      return fonts.add({ family, characters });
    },
    _CGFontRetain: (args: GuestArguments) => (args(0) ? fonts.retain(args(0)) : 0),
    _CGFontRelease: (args: GuestArguments) => fonts.release(args(0)),
    _CGContextSetFont: (args: GuestArguments) => {
      state(args(0)).font = args(1);
    },
    _CGContextSetFontSize: (args: GuestArguments) => {
      state(args(0)).size = floatFromBits(args(1));
    },
    _CGContextSetTextDrawingMode: (args: GuestArguments) => {
      state(args(0)).mode = args(1);
    },
    _CGContextSetTextPosition: (args: GuestArguments) => {
      const text = state(args(0));
      text.x = floatFromBits(args(1));
      text.y = floatFromBits(args(Glyphs.Y));
    },
    _CGContextGetTextPosition: (args: GuestArguments) => {
      const text = states.get(args(1));
      host.writeWord(args(0), floatBits(text?.x ?? 0));
      host.writeWord(args(0) + WORD_BYTES, floatBits(text?.y ?? 0));
    },
    _CGContextShowGlyphsAtPoint: show,
  };
  return {
    imports,
    tables: [providers, fonts],
    forget: (context: number) => states.delete(context),
  };
}
