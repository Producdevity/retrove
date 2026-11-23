import type { DiagnosticSink } from "../ios/libc/files/types";
import type { GuestMemory } from "../memory/guest-memory";
import { installFixedFunction } from "./fixed-function/imports";
import type { GraphicsContext } from "./gl-parameters";
import { installBuffers } from "./gles/buffers";
import { GlesContext, type GlesFunction, type GlesHeap, type GlesOptions } from "./gles/context";
import { installFramebuffers } from "./gles/framebuffers";
import { installObjects } from "./gles/objects";
import { installPrograms } from "./gles/programs";
import { installQueries } from "./gles/queries";
import { installStateCalls } from "./gles/state-calls";
import { installTextures } from "./gles/textures";
import { installUniforms } from "./gles/uniforms";
import { installVertex } from "./gles/vertex";

export type { GlesFunction, GlesHeap, GlesOptions };

/** The guest's OpenGL ES 2 imports, backed by one WebGL context. */
export function glesImports(
  cpu: GuestMemory,
  heap: GlesHeap,
  getContext: () => GraphicsContext | null,
  diagnostic?: DiagnosticSink,
  options: GlesOptions = {},
): Record<string, GlesFunction> {
  const host = new GlesContext(cpu, heap, getContext, diagnostic, options);
  installStateCalls(host);
  installQueries(host);
  installObjects(host);
  installBuffers(host);
  installPrograms(host);
  installUniforms(host);
  installVertex(host);
  installTextures(host);
  installFramebuffers(host);
  options.onClose?.(
    installFixedFunction({
      api: host.api,
      gl: () => host.gl(),
      currentAPI: host.currentAPI,
      currentContext: host.currentContext,
      boundArray: () => host.array,
      read: (pointer, bytes) => cpu.read(pointer, bytes),
      write: (pointer, bytes) => cpu.write(pointer, bytes),
      string: (value) => heap.string(value),
      error: (code) => host.setError(code),
    }),
  );
  return host.api;
}
