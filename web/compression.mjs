import {crc32, crcTable} from './crc32.mjs';
import {read32, write32} from './memory.mjs';
import {ZStream, inflateInit2, inflate, inflateEnd, deflateInit2, deflate, deflateEnd} from './vendor/pako-zlib.mjs';

const OK = 0, STREAM_END = 1, NEED_DICT = 2, STREAM_ERROR = -2, DATA_ERROR = -3, BUF_ERROR = -5;
const CHUNK = 65536;

export function compressionImports(cpu, heap, signal) {
  let tableAddress = 0;

  // Large cooked packages can take multiple frames to process. Each operation
  // remains a single call from the guest's perspective.
  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

  async function transform(arg, compressing) {
    const dest = arg(0), lengthPtr = arg(1), source = arg(2), sourceSize = arg(3);
    if (!lengthPtr) return STREAM_ERROR;
    const capacity = read32(cpu, lengthPtr);
    write32(cpu, lengthPtr, 0);
    if ((!source && sourceSize) || (!dest && (compressing || capacity))) return STREAM_ERROR;

    const stream = new ZStream();
    const init = compressing ? deflateInit2(stream, -1, 8, 15, 8, 0) : inflateInit2(stream, 15);
    if (init !== OK) return init;
    // uncompress2 uses one scratch output byte when the caller passes zero capacity.
    const room = !compressing && !capacity ? 1 : capacity;
    const output = new Uint8Array(Math.min(CHUNK, room));
    let loaded = 0, produced = 0, yielded = performance.now();
    try {
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
        stream.avail_out = Math.min(CHUNK, room - produced);
        const flush = compressing && loaded === sourceSize ? 4 : 0;
        const inputBefore = stream.total_in;
        let code = compressing ? deflate(stream, flush) : inflate(stream, flush);
        if (stream.next_out) {
          if (capacity) cpu.write(dest + produced, output.subarray(0, stream.next_out));
          produced += stream.next_out;
        }
        if (code === OK && !stream.next_out && stream.total_in === inputBefore) code = BUF_ERROR;
        if (code === STREAM_END) return OK;
        if (code === NEED_DICT) return DATA_ERROR;
        if (code === BUF_ERROR && !compressing && (!capacity || produced < capacity)) return DATA_ERROR;
        if (code !== OK) return code;

        if (performance.now() - yielded > 16) {
          await yieldToBrowser();
          yielded = performance.now();
        }
      }
    } finally {
      write32(cpu, lengthPtr, capacity ? produced : 0);
      if (compressing) deflateEnd(stream);
      else inflateEnd(stream);
    }
  }

  return {
    _compress: arg => transform(arg, true),
    _uncompress: arg => transform(arg, false),
    _crc32: async arg => {
      let crc = arg(0) >>> 0;
      const source = arg(1), length = arg(2);
      if (!source) return 0;
      let yielded = performance.now();
      for (let offset = 0; offset < length; offset += CHUNK) {
        signal?.throwIfAborted();
        crc = crc32(crc, cpu.read(source + offset, Math.min(CHUNK, length - offset)));
        if (performance.now() - yielded > 16) {
          await yieldToBrowser();
          yielded = performance.now();
        }
      }
      return crc;
    },
    _get_crc_table: () => {
      if (!tableAddress) {
        const data = new DataView(new ArrayBuffer(crcTable.byteLength));
        for (let i = 0; i < crcTable.length; i++) data.setUint32(i * 4, crcTable[i], true);
        tableAddress = heap.alloc(data.byteLength);
        if (!tableAddress) throw Error('Guest heap exhausted allocating zlib CRC table');
        cpu.write(tableAddress, new Uint8Array(data.buffer));
      }
      return tableAddress;
    },
  };
}
