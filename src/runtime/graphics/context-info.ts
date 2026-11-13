type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;
function parameter(context: GraphicsContext, name: number): string | undefined {
  const value: unknown = context.getParameter(name);
  return typeof value === "string" ? value : undefined;
}
export function graphicsContextInfo(context: GraphicsContext) {
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  return {
    version: parameter(context, context.VERSION),
    vendor: parameter(context, debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR),
    renderer: parameter(context, debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
    shadingLanguage: parameter(context, context.SHADING_LANGUAGE_VERSION),
    width: context.drawingBufferWidth,
    height: context.drawingBufferHeight,
  };
}
