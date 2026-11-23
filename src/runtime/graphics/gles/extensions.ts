import type { GraphicsContext } from "../gl-parameters";

/** Enables PVRTC support where the browser has it; false when textures need decoding. */
export function pvrtcSupported(gl: GraphicsContext): boolean {
  return Boolean(
    gl.getExtension("WEBGL_compressed_texture_pvrtc") ||
    gl.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc"),
  );
}

/** The elements of an array-like answer from getParameter, or undefined for anything else. */
export function numericList(value: unknown): number[] | undefined {
  if (
    value instanceof Float32Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Uint16Array ||
    value instanceof Int16Array ||
    value instanceof Uint8Array ||
    value instanceof Int8Array
  )
    return Array.from(value);
  return undefined;
}
