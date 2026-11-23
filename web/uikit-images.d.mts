import type { RasterContext } from "../src/runtime/graphics/core-graphics/raster";
/** UIImage, UIImageView and layer rendering over the page. */
export interface UiImages {
  render(window: number): Promise<void>;
  close(): void;
  removeView(view: number): void;
  size(pointer: number): [number, number];
  drawImage(
    pointer: number,
    context: RasterContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}
export function uiImages(host: Readonly<Record<string, unknown>>): UiImages;
