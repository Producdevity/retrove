export type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;
export type Quad<T = number> = [T, T, T, T];
type HandleType<T> = abstract new (...args: never) => T;

/** WebGL 2 contexts carry blitFramebuffer; the checks below follow the context, not the class. */
export function hasBlit(gl: GraphicsContext): gl is WebGL2RenderingContext {
  return "blitFramebuffer" in gl && typeof gl.blitFramebuffer === "function";
}

export function objectParameter<T extends object>(
  gl: GraphicsContext,
  name: number,
  type: HandleType<T>,
): T | null {
  const value: unknown = gl.getParameter(name);
  return value instanceof type ? value : null;
}

export function anyObjectParameter(gl: GraphicsContext, name: number): object | null {
  const value: unknown = gl.getParameter(name);
  return typeof value === "object" ? value : null;
}

export function numberParameter(gl: GraphicsContext, name: number): number {
  const value: unknown = gl.getParameter(name);
  return typeof value === "number" ? value : 0;
}

export function floatQuadParameter(gl: GraphicsContext, name: number): Quad {
  const value: unknown = gl.getParameter(name);
  const [first = 0, second = 0, third = 0, fourth = 0] =
    value instanceof Float32Array ? Array.from(value) : [];
  return [first, second, third, fourth];
}

export function integerQuadParameter(gl: GraphicsContext, name: number): Quad {
  const value: unknown = gl.getParameter(name);
  const [first = 0, second = 0, third = 0, fourth = 0] =
    value instanceof Int32Array ? Array.from(value) : [];
  return [first, second, third, fourth];
}

export function booleanQuadParameter(gl: GraphicsContext, name: number): Quad<boolean> {
  const value: unknown = gl.getParameter(name);
  const [first = false, second = false, third = false, fourth = false] = Array.isArray(value)
    ? value.map(Boolean)
    : [];
  return [first, second, third, fourth];
}
