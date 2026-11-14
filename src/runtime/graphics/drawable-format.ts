export const DrawableFormat = { RGBA8: "RGBA8", RGB565: "RGB565" } as const;
interface StorageFormats {
  readonly RGB565: number;
  readonly RGBA4: number;
  readonly RGBA8?: number;
  readonly blitFramebuffer?: unknown;
}
export function drawableStorageFormat(
  formats: StorageFormats,
  requested: string = DrawableFormat.RGBA8,
): number {
  if (requested === DrawableFormat.RGB565) return formats.RGB565;
  if (requested === DrawableFormat.RGBA8)
    return typeof formats.blitFramebuffer === "function"
      ? (formats.RGBA8 ?? formats.RGBA4)
      : formats.RGBA4;
  throw new Error(`Unsupported EAGL drawable color format ${requested}.`);
}
