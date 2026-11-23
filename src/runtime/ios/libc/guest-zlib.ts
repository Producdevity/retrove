import type { GuestArguments } from "../objc/host";
import { read32, write32, type GuestMemory, type Heap } from "../../memory/guest-memory";

const PAGE = 4096;
const Z_STREAM_ERROR = -2;
const Z_VERSION_ERROR = -6;
const Z_STREAM_BYTES = 56;
const VERSION_FIRST_CHAR = 49;
/** z_stream from Darwin ARM32 stores zalloc, zfree and opaque at these offsets. */
const ZStreamField = { Alloc: 32, Free: 36, Opaque: 40 } as const;
const Argument = { Stream: 0, Count: 1, Size: 2 } as const;
const INFLATE_VERSION_ARGUMENT = 2;
const DEFLATE_VERSION_ARGUMENT = 6;
const FunctionNames = [
  "inflateInit2_",
  "deflateInit2_",
  "inflate",
  "deflate",
  "inflateEnd",
  "deflateEnd",
] as const;

export interface ZlibCpu extends GuestMemory {
  protect(address: number, size: number, permissions: number): void;
}
export type HostGate = (
  descriptor: { readonly library: string; readonly name: string },
  implementation: (args: GuestArguments) => number | void,
) => number;
type ZlibResult = number | { readonly jump: number };

export function guestZlibStreams(
  cpu: ZlibCpu,
  heap: Pick<Heap, "alloc" | "free" | "zero">,
  hostGate: HostGate,
): Record<string, (a: GuestArguments) => Promise<ZlibResult>> {
  let installed: Promise<Record<string, number>> | undefined;
  async function install(): Promise<Record<string, number>> {
    const { base64, segments, relocations, entries } =
      await import("../../../../web/vendor/zlib-arm.mjs");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const base = heap.alloc(bytes.length, PAGE);
    if (!base) throw new Error("Guest heap exhausted loading zlib");
    const view = new DataView(bytes.buffer);
    for (const at of relocations) view.setUint32(at, base + view.getUint32(at, true), true);
    cpu.write(base, bytes);
    for (const [offset, length, permissions] of segments)
      cpu.protect(base + offset, length, permissions);
    return Object.fromEntries(
      Object.entries(entries).map(([name, offset]) => [name, base + offset]),
    );
  }
  function defaults(stream: number): void {
    if (!read32(cpu, stream + ZStreamField.Alloc)) {
      const allocate = (args: GuestArguments) =>
        heap.zero(args(Argument.Count) * args(Argument.Size));
      write32(
        cpu,
        stream + ZStreamField.Alloc,
        hostGate({ library: "libz", name: "zcalloc" }, allocate),
      );
      write32(cpu, stream + ZStreamField.Opaque, 0);
    }
    if (!read32(cpu, stream + ZStreamField.Free)) {
      const release = (args: GuestArguments) => heap.free(args(Argument.Count));
      write32(
        cpu,
        stream + ZStreamField.Free,
        hostGate({ library: "libz", name: "zcfree" }, release),
      );
    }
  }
  const funcs: Record<string, (a: GuestArguments) => Promise<ZlibResult>> = {};
  for (const name of FunctionNames) {
    funcs[`_${name}`] = async (a) => {
      const entries = await (installed ??= install());
      if (name === "inflateInit2_" || name === "deflateInit2_") {
        const version =
          name === "inflateInit2_" ? INFLATE_VERSION_ARGUMENT : DEFLATE_VERSION_ARGUMENT;
        if (
          !a(version) ||
          a(version + 1) !== Z_STREAM_BYTES ||
          cpu.read(a(version), 1)[0] !== VERSION_FIRST_CHAR
        )
          return Z_VERSION_ERROR;
        if (!a(Argument.Stream)) return Z_STREAM_ERROR;
        defaults(a(Argument.Stream));
      }
      const jump = entries[name];
      if (jump === undefined) throw new Error(`Guest zlib lacks ${name}`);
      return { jump };
    };
  }
  return funcs;
}
