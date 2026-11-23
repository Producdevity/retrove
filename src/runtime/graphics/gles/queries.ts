import { WORD_BYTES } from "../../ios/abi/scalars";
import { hasBlit, type GraphicsContext } from "../gl-parameters";
import { words2 } from "./arguments";
import { Gles, PVRTC_FORMATS } from "./constants";
import type { GlesContext } from "./context";
import { writeNumber, type NumberKind } from "./data";
import { numericList, pvrtcSupported } from "./extensions";

const VERSION_TEXT = "OpenGL ES 2.0 WebGL";
const SHADING_LANGUAGE_TEXT = "OpenGL ES GLSL ES 1.00";
const NATIVE_EXTENSIONS = [
  "GL_APPLE_framebuffer_multisample",
  "GL_OES_rgb8_rgba8",
  "GL_OES_vertex_half_float",
];
const TEXTURE_EXTENSIONS = ["GL_IMG_texture_compression_pvrtc", "GL_EXT_texture_format_BGRA8888"];
const QUERIES: readonly (readonly [string, NumberKind])[] = [
  ["GetIntegerv", "int"],
  ["GetFloatv", "float"],
  ["GetBooleanv", "boolean"],
];

function extensionText(gl: GraphicsContext): string {
  const names = ["GL_OES_mapbuffer"];
  if (gl.getExtension("OES_standard_derivatives")) names.push("GL_OES_standard_derivatives");
  if (hasBlit(gl)) names.push(...NATIVE_EXTENSIONS);
  if (hasBlit(gl) || gl.getExtension("OES_element_index_uint"))
    names.push("GL_OES_element_index_uint");
  if (hasBlit(gl) || gl.getExtension("OES_texture_half_float"))
    names.push("GL_OES_texture_half_float");
  names.push(...TEXTURE_EXTENSIONS);
  return names.join(" ");
}

function stringAnswer(gl: GraphicsContext, name: number): string | undefined {
  switch (name) {
    case Gles.Version:
      return VERSION_TEXT;
    case Gles.ShadingLanguageVersion:
      return SHADING_LANGUAGE_TEXT;
    case Gles.Extensions:
      return extensionText(gl);
    case Gles.Vendor:
    case Gles.Renderer:
      return String(gl.getParameter(name));
    default:
      return undefined;
  }
}

function parameterAnswer(gl: GraphicsContext, name: number): unknown {
  if (name === Gles.NumCompressedTextureFormats || name === Gles.CompressedTextureFormats) {
    pvrtcSupported(gl);
    const reported = numericList(gl.getParameter(Gles.CompressedTextureFormats)) ?? [];
    const formats = [...new Set([...reported, ...PVRTC_FORMATS])];
    return name === Gles.NumCompressedTextureFormats ? formats.length : formats;
  }
  if (name === Gles.MaxSamplesApple && !hasBlit(gl)) return 0;
  return gl.getParameter(name);
}

function elements(answer: unknown): unknown[] {
  const typed = numericList(answer);
  if (typed) return typed;
  return Array.isArray(answer) ? answer.map((entry: unknown) => entry) : [answer];
}

/** glGetString and the glGet*v queries, which answer with driver values or object names. */
export function installQueries(host: GlesContext): void {
  const strings = new Map<number, number>();
  host.bind("GetString", (a) => {
    const name = a(0);
    if (!strings.has(name)) {
      const text = stringAnswer(host.gl(), name);
      if (text === undefined) return 0;
      strings.set(name, host.heap.string(text));
    }
    return strings.get(name);
  });
  for (const [name, kind] of QUERIES) {
    host.bind(name, (a) => {
      const [parameter, pointer] = words2(a);
      elements(parameterAnswer(host.gl(), parameter)).forEach((value, index) => {
        const word =
          value === null || typeof value === "object" ? host.handles.any(value) : Number(value);
        writeNumber(
          host.cpu,
          pointer + (kind === "boolean" ? index : WORD_BYTES * index),
          word,
          kind,
        );
      });
    });
  }
}
