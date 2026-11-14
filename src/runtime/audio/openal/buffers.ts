import { AL, ALError, MAX_BUFFER_BYTES, OpenALError } from "./constants";
import { decodePCM, pcmBits, pcmBytes } from "./pcm";
import { EMPTY_PCM, type ALFunction, type OpenALRuntime } from "./runtime";
import { WORD_BYTES } from "../../ios/abi/scalars";
const Upload = { Buffer: 0, Format: 1, Data: 2, Size: 3, Rate: 4 } as const;
export function bufferImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const host = runtime.host;
  return {
    _alGenBuffers: (args) => {
      const names = runtime.names(args(0) | 0);
      for (const [index, name] of names.entries()) {
        runtime.device.buffers.set(name, EMPTY_PCM);
        host.writeWord(args(1) + index * WORD_BYTES, name);
      }
    },
    _alDeleteBuffers: (args) => {
      const count = args(0) | 0;
      if (count < 0) throw new OpenALError(ALError.InvalidValue);
      const names = Array.from({ length: count }, (_, index) =>
        host.readWord(args(1) + index * WORD_BYTES),
      );
      for (const name of names)
        if (name) {
          runtime.buffer(name);
          if (runtime.referenced(name)) throw new OpenALError(ALError.InvalidOperation);
        }
      for (const name of names) runtime.device.buffers.delete(name);
    },
    _alIsBuffer: (args) => Number(args(0) === 0 || runtime.device.buffers.has(args(0))),
    _alBufferData: (args) => {
      const name = args(Upload.Buffer),
        size = args(Upload.Size) | 0;
      runtime.buffer(name);
      if (runtime.referenced(name)) throw new OpenALError(ALError.InvalidOperation);
      if (size < 0) throw new OpenALError(ALError.InvalidValue);
      if (size > MAX_BUFFER_BYTES) throw new OpenALError(ALError.OutOfMemory);
      const bytes = args(Upload.Data) ? host.read(args(Upload.Data), size) : new Uint8Array(size);
      runtime.device.buffers.set(
        name,
        decodePCM(args(Upload.Format), bytes, args(Upload.Rate) | 0),
      );
    },
    _alGetBufferi: (args) => {
      const pcm = runtime.buffer(args(0));
      let value: number;
      switch (args(1)) {
        case AL.Frequency:
          value = pcm.rate;
          break;
        case AL.Bits:
          value = pcmBits(pcm);
          break;
        case AL.Channels:
          value = pcm.channels.length;
          break;
        case AL.Size:
          value = pcmBytes(pcm);
          break;
        default:
          throw new OpenALError(ALError.InvalidEnum);
      }
      host.writeWord(args(Upload.Data), value);
    },
  };
}
