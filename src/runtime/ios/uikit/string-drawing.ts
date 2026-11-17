import { WORD_BYTES, floatBits, floatFromBits } from "../abi/scalars";
import type { GuestArguments } from "../objc/host";
import { canvasFont, fontLineHeight, type Font, type Fonts } from "./fonts";
import { MAX_TEXT_EXTENT } from "./label-drawing";
import { LineBreak, TextAlignment, layoutText, lineBreak } from "./text-layout";
import { UIKitClass, structureMethod, type UIKitHost } from "./host";

type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Runs `draw` against the current UIGraphics context; false when there is none. */
export type CurrentContext = (draw: (context: TextContext) => void) => boolean;
type Measure = (
  text: string,
  font: Font,
  width: number,
  height: number,
  state: { mode: LineBreak; lines: number },
) => [number, number];

const RectArgument = { X: 0, Y: 1, Width: 2, Height: 3, Font: 4, Mode: 5, Alignment: 6 } as const;
const PointArgument = { X: 0, Y: 1, Font: 2 } as const;
const WidthArgument = { Width: 2, Font: 3, Mode: 4 } as const;
const HALF = 2;
interface TextBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mode: LineBreak;
  readonly alignment: number;
}

/** Draws with the context's current fill color, top-down from the box origin as UIKit does. */
function drawLines(context: TextContext, text: string, font: Font, box: TextBox): [number, number] {
  context.save();
  try {
    context.font = canvasFont(font);
    const lineHeight = fontLineHeight(font),
      measure = (value: string): number => context.measureText(value).width,
      visible = Math.max(1, Math.floor(box.height / lineHeight)),
      lines = layoutText(text, box.width, box.mode, visible, measure);
    const center = box.alignment === TextAlignment.Center,
      right = box.alignment === TextAlignment.Right;
    context.textAlign = center ? "center" : right ? "right" : "left";
    context.textBaseline = "middle";
    const offset = center ? box.width / HALF : right ? box.width : 0;
    lines.forEach((line, index) =>
      context.fillText(line, box.x + offset, box.y + index * lineHeight + lineHeight / HALF),
    );
    return [Math.min(box.width, Math.max(0, ...lines.map(measure))), lines.length * lineHeight];
  } finally {
    context.restore();
  }
}

/** NSString (UIStringDrawing): measuring and drawing into the current UIGraphics context. */
export function installStringDrawing(
  host: UIKitHost,
  fonts: Fonts,
  measure: Measure,
  current: CurrentContext | undefined,
): void {
  const draw = (self: number, fontPointer: number, box: TextBox): [number, number] => {
    const text = host.text(self),
      font = fonts.get(fontPointer);
    let size: [number, number] | undefined;
    current?.((context) => {
      size = drawLines(context, text, font, box);
    });
    return size ?? measure(text, font, box.width, box.height, { mode: box.mode, lines: 0 });
  };
  const sized = (
    selector: string,
    result: (self: number, args: GuestArguments) => [number, number],
  ): void =>
    host.structure(
      UIKitClass.String,
      false,
      selector,
      structureMethod((self, args, destination) => {
        const [width, height] = result(self, args);
        host.write(destination, floatBits(width));
        host.write(destination + WORD_BYTES, floatBits(height));
      }),
    );
  const float = (args: GuestArguments, index: number): number => floatFromBits(args(index));
  const inRect = (args: GuestArguments, mode: number, alignment: number): TextBox => ({
    x: float(args, RectArgument.X),
    y: float(args, RectArgument.Y),
    width: float(args, RectArgument.Width),
    height: float(args, RectArgument.Height),
    mode: lineBreak(mode),
    alignment,
  });
  sized("drawInRect:withFont:", (self, args) =>
    draw(self, args(RectArgument.Font), inRect(args, LineBreak.Word, TextAlignment.Left)),
  );
  sized("drawInRect:withFont:lineBreakMode:", (self, args) =>
    draw(self, args(RectArgument.Font), inRect(args, args(RectArgument.Mode), TextAlignment.Left)),
  );
  sized("drawInRect:withFont:lineBreakMode:alignment:", (self, args) =>
    draw(
      self,
      args(RectArgument.Font),
      inRect(args, args(RectArgument.Mode), args(RectArgument.Alignment)),
    ),
  );
  const atPoint = (args: GuestArguments, width: number, mode: number): TextBox => ({
    x: float(args, PointArgument.X),
    y: float(args, PointArgument.Y),
    width,
    height: MAX_TEXT_EXTENT,
    mode: lineBreak(mode),
    alignment: TextAlignment.Left,
  });
  sized("drawAtPoint:withFont:", (self, args) =>
    draw(self, args(PointArgument.Font), {
      ...atPoint(args, MAX_TEXT_EXTENT, LineBreak.Clip),
      height: fontLineHeight(fonts.get(args(PointArgument.Font))),
    }),
  );
  sized("drawAtPoint:forWidth:withFont:lineBreakMode:", (self, args) =>
    draw(self, args(WidthArgument.Font), {
      ...atPoint(args, float(args, WidthArgument.Width), args(WidthArgument.Mode)),
      height: fontLineHeight(fonts.get(args(WidthArgument.Font))),
    }),
  );
  sized("sizeWithFont:", (self, args) =>
    measure(host.text(self), fonts.get(args(0)), MAX_TEXT_EXTENT, MAX_TEXT_EXTENT, {
      mode: LineBreak.Clip,
      lines: 1,
    }),
  );
}
