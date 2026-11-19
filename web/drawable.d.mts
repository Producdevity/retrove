import type { DrawablePlacement } from "../src/runtime/graphics/drawable-placement";

type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;
export const FULL_DISPLAY: DrawablePlacement;
export interface DrawableRenderer {
  /** The storage size, or undefined when no renderbuffer was allocated. */
  allocate(
    target: number,
    drawable: number,
    colorFormat: string,
    size: { readonly width: number; readonly height: number } | null | undefined,
  ): { readonly width: number; readonly height: number } | undefined;
  present(target: number, placement: (drawable: number) => DrawablePlacement): number;
}
export function drawableRenderer(context: () => GraphicsContext): DrawableRenderer;
