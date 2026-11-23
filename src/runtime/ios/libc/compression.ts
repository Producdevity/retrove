import type { GuestArguments } from "../objc/host";
import { crc32, crcTable } from "../../formats/crc32";
import { read32, write32, type GuestMemory, type Heap } from "../../memory/guest-memory";
import {
  ZStream,
  inflateInit2,
  inflate,
  inflateEnd,
  deflateInit2,
  deflate,
  deflateEnd,
} from "../../../../web/vendor/pako-zlib.mjs";

const ZlibCode = {
  Ok: 0,
  StreamEnd: 1,
  NeedDict: 2,
  StreamError: -2,
  DataError: -3,
  BufError: -5,
} as const;
const Z_FINISH = 4;
const Z_DEFAULT_COMPRESSION = -1;
const Z_DEFLATED = 8;
const MAX_WINDOW_BITS = 15;
const DEFAULT_MEM_LEVEL = 8;
const Z_DEFAULT_STRATEGY = 0;
const CHUNK = 65_536;
const YIELD_INTERVAL_MS = 16;
const WORD_BYTES = 4;
const Argument = { Dest: 0, Length: 1, Source: 2, SourceSize: 3 } as const;
const Crc = { Initial: 0, Source: 1, Length: 2 } as const;

interface Transfer {
  readonly cpu: GuestMemory;
  readonly signal: AbortSignal | undefined;
  readonly dest: number;
  readonly source: number;
  readonly sourceSize: number;
  readonly capacity: number;
  readonly room: number;
  readonly compressing: boolean;
}

interface Progress {
  produced: number;
}

// Large cooked packages can take multiple frames to process. Each operation
// remains a single call from the guest's perspective.
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function pump(transfer: Transfer, stream: ZStream, progress: Progress): Promise<number> {
  const { cpu, signal, dest, source, sourceSize, capacity, room, compressing } = transfer;
  const output = new Uint8Array(Math.min(CHUNK, room));
  let loaded = 0,
    yielded = performance.now();
  for (;;) {
    signal?.throwIfAborted();
    if (!stream.avail_in && loaded < sourceSize) {
      const size = Math.min(sourceSize - loaded, CHUNK);
      stream.input = cpu.read(source + loaded, size);
      stream.next_in = 0;
      stream.avail_in = size;
      loaded += size;
    }
    stream.output = output;
    stream.next_out = 0;
    stream.avail_out = Math.min(CHUNK, room - progress.produced);
    const flush = compressing && loaded === sourceSize ? Z_FINISH : 0;
    const inputBefore = stream.total_in;
    let code = compressing ? deflate(stream, flush) : inflate(stream, flush);
    if (stream.next_out) {
      if (capacity) cpu.write(dest + progress.produced, output.subarray(0, stream.next_out));
      progress.produced += stream.next_out;
    }
    if (code === ZlibCode.Ok && !stream.next_out && stream.total_in === inputBefore)
      code = ZlibCode.BufError;
    if (code === ZlibCode.StreamEnd) return ZlibCode.Ok;
    if (code === ZlibCode.NeedDict) return ZlibCode.DataError;
    if (code === ZlibCode.BufError && !compressing && (!capacity || progress.produced < capacity))
      return ZlibCode.DataError;
    if (code !== ZlibCode.Ok) return code;
    if (performance.now() - yielded > YIELD_INTERVAL_MS) {
      await yieldToBrowser();
      yielded = performance.now();
    }
  }
}

async function transform(
  cpu: GuestMemory,
  signal: AbortSignal | undefined,
  arg: GuestArguments,
  compressing: boolean,
): Promise<number> {
  const dest = arg(Argument.Dest),
    lengthPtr = arg(Argument.Length),
    source = arg(Argument.Source),
    sourceSize = arg(Argument.SourceSize);
  if (!lengthPtr) return ZlibCode.StreamError;
  const capacity = read32(cpu, lengthPtr);
  write32(cpu, lengthPtr, 0);
  if ((!source && sourceSize) || (!dest && (compressing || capacity))) return ZlibCode.StreamError;

  const stream = new ZStream();
  const init = compressing
    ? deflateInit2(
        stream,
        Z_DEFAULT_COMPRESSION,
        Z_DEFLATED,
        MAX_WINDOW_BITS,
        DEFAULT_MEM_LEVEL,
        Z_DEFAULT_STRATEGY,
      )
    : inflateInit2(stream, MAX_WINDOW_BITS);
  if (init !== ZlibCode.Ok) return init;
  // uncompress2 uses one scratch output byte when the caller passes zero capacity.
  const room = !compressing && !capacity ? 1 : capacity;
  const progress: Progress = { produced: 0 };
  try {
    return await pump(
      { cpu, signal, dest, source, sourceSize, capacity, room, compressing },
      stream,
      progress,
    );
  } finally {
    write32(cpu, lengthPtr, capacity ? progress.produced : 0);
    if (compressing) deflateEnd(stream);
    else inflateEnd(stream);
  }
}

async function checksum(
  cpu: GuestMemory,
  signal: AbortSignal | undefined,
  arg: GuestArguments,
): Promise<number> {
  let crc = arg(Crc.Initial) >>> 0;
  const source = arg(Crc.Source),
    length = arg(Crc.Length);
  if (!source) return 0;
  let yielded = performance.now();
  for (let offset = 0; offset < length; offset += CHUNK) {
    signal?.throwIfAborted();
    crc = crc32(crc, cpu.read(source + offset, Math.min(CHUNK, length - offset)));
    if (performance.now() - yielded > YIELD_INTERVAL_MS) {
      await yieldToBrowser();
      yielded = performance.now();
    }
  }
  return crc;
}

export function compressionImports(
  cpu: GuestMemory,
  heap: Pick<Heap, "alloc">,
  signal?: AbortSignal,
): Record<
  "_compress" | "_uncompress" | "_crc32" | "_get_crc_table",
  (arg: GuestArguments) => number | Promise<number>
> {
  let tableAddress = 0;
  return {
    _compress: (arg) => transform(cpu, signal, arg, true),
    _uncompress: (arg) => transform(cpu, signal, arg, false),
    _crc32: (arg) => checksum(cpu, signal, arg),
    _get_crc_table: () => {
      if (!tableAddress) {
        const data = new DataView(new ArrayBuffer(crcTable.byteLength));
        for (let i = 0; i < crcTable.length; i++)
          data.setUint32(i * WORD_BYTES, crcTable[i] ?? 0, true);
        tableAddress = heap.alloc(data.byteLength);
        if (!tableAddress) throw new Error("Guest heap exhausted allocating zlib CRC table");
        cpu.write(tableAddress, new Uint8Array(data.buffer));
      }
      return tableAddress;
    },
  };
}
