import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";

type EffectCanvas = Pick<
  CanvasRenderingContext2D,
  "shadowOffsetX" | "shadowOffsetY" | "shadowBlur" | "shadowColor" | "getTransform"
> & { clip(path: Path2D): void };
interface EffectHost {
  context(pointer: number): EffectCanvas | null;
  /** CSS color of a CGColor, or undefined for NULL or an unknown color. */
  color(pointer: number): string | undefined;
  setAntialias(pointer: number, enabled: boolean): void;
}
const Shadow = { Context: 0, Width: 1, Height: 2, Blur: 3, Color: 4 } as const;
const RECT_FLOATS = 4;
/** CGContextSetShadow's documented default: black at one-third alpha. */
const DEFAULT_SHADOW = "rgba(0,0,0,0.333)";
const NO_SHADOW = "rgba(0,0,0,0)";

/** Shadows, rectangle clipping and antialiasing switches on a Quartz context. */
export function contextEffectImports(host: EffectHost) {
  const shadow = (args: GuestArguments, color: string | undefined) => {
    const canvas = host.context(args(Shadow.Context));
    if (!canvas) return;
    // Quartz shadow offsets and blur are in base space; canvas shadows ignore the CTM too, but
    // its base space is the backing store, so scale by the context's device scale.
    const matrix = canvas.getTransform(),
      scale = Math.hypot(matrix.a, matrix.b) || 1;
    canvas.shadowOffsetX = floatFromBits(args(Shadow.Width)) * scale;
    canvas.shadowOffsetY = floatFromBits(args(Shadow.Height)) * scale;
    canvas.shadowBlur = Math.max(0, floatFromBits(args(Shadow.Blur))) * scale;
    canvas.shadowColor = color ?? NO_SHADOW;
  };
  return {
    _CGContextSetShadow: (args: GuestArguments) => shadow(args, DEFAULT_SHADOW),
    _CGContextSetShadowWithColor: (args: GuestArguments) =>
      shadow(args, host.color(args(Shadow.Color))),
    _CGContextClipToRect: (args: GuestArguments) => {
      const canvas = host.context(args(0));
      if (!canvas) return;
      const [x = 0, y = 0, width = 0, height = 0] = Array.from({ length: RECT_FLOATS }, (_, i) =>
        floatFromBits(args(1 + i)),
      );
      const area = new Path2D();
      area.rect(x, y, width, height);
      canvas.clip(area);
    },
    _CGContextSetShouldAntialias: (args: GuestArguments) =>
      host.setAntialias(args(0), Boolean(args(1))),
    _CGContextSetShouldSmoothFonts: () => undefined,
  };
}
