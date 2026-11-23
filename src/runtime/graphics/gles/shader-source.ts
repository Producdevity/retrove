import { read32, readString } from "../../memory/guest-memory";
import { WORD_BYTES } from "../../ios/abi/scalars";
import { signed, words4 } from "./arguments";
import type { GlesContext } from "./context";
import { sourceBytes } from "./data";

const decoder = new TextDecoder();
const DERIVATIVES = "GL_OES_standard_derivatives";
const DERIVATIVE_BLOCK =
  /^#define USE_DERIVATIVES 0\r?\n#ifdef GL_OES_standard_derivatives\r?\n\t#extension GL_OES_standard_derivatives : enable\r?\n\t#undef USE_DERIVATIVES\r?\n\t#define USE_DERIVATIVES 1\r?\n#endif\r?\n/m;
const VERSION_HEADER = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*#version[^\n]*\n/;

/**
 * BioShock places its optional extension after declarations. GLSL ES
 * requires the directive before declarations and after any #version line.
 */
function hoistDerivatives(source: string): string {
  const block = DERIVATIVE_BLOCK.exec(source);
  if (!block) return source;
  const insertion = VERSION_HEADER.exec(source)?.[0].length || 0;
  if (block.index <= insertion) return source;
  return (
    source.slice(0, insertion) +
    block[0] +
    source.slice(insertion, block.index) +
    source.slice(block.index + block[0].length)
  );
}

export function installShaderSource(
  host: GlesContext,
  shader: (handle: number) => WebGLShader,
): void {
  host.bind("ShaderSource", (a) => {
    const [handle, count, strings, lengths] = words4(a);
    const parts: string[] = [];
    for (let index = 0; index < signed(count); index++) {
      const pointer = read32(host.cpu, strings + WORD_BYTES * index);
      const length = lengths ? signed(read32(host.cpu, lengths + WORD_BYTES * index)) : -1;
      parts.push(
        length < 0
          ? readString(host.cpu, pointer)
          : decoder.decode(sourceBytes(host.cpu, pointer, length)),
      );
    }
    let joined = parts.join("");
    if (joined.includes(DERIVATIVES)) {
      host.gl().getExtension("OES_standard_derivatives");
      joined = hoistDerivatives(joined);
    }
    host.gl().shaderSource(shader(handle), joined);
  });
}
