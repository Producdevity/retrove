import { floatBits, floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import { AL, ALError, MAX_SOURCES, OpenALError } from "./constants";
import { Source } from "./source";
import type { ALFunction, OpenALRuntime } from "./runtime";
import { setInteger, setScalar, setVector, sourceValue } from "./properties";
const Argument = { Source: 0, Parameter: 1, Value: 2, Y: 3, Z: 4 } as const;
const VectorIndex = { X: 0, Y: 1, Z: 2 } as const;
export function sourceImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const host = runtime.host;
  return {
    _alGenSources: (args) => {
      const count = args(0) | 0;
      if (runtime.context.sources.size + count > MAX_SOURCES)
        throw new OpenALError(ALError.OutOfMemory);
      for (const [index, name] of runtime.names(count).entries()) {
        const source = new Source(runtime.device.output);
        if (runtime.context.suspended) source.suspend();
        runtime.context.sources.set(name, source);
        host.writeWord(args(1) + index * WORD_BYTES, name);
      }
    },
    _alDeleteSources: (args) => {
      const count = args(0) | 0;
      if (count < 0) throw new OpenALError(ALError.InvalidValue);
      const names = Array.from({ length: count }, (_, index) =>
        host.readWord(args(1) + index * WORD_BYTES),
      );
      for (const name of names) runtime.source(name);
      for (const name of names) {
        runtime.source(name).stopVoices();
        runtime.context.sources.delete(name);
      }
    },
    _alIsSource: (args) => Number(runtime.context.sources.has(args(0))),
    _alSourcePlay: (args) => runtime.source(args(0)).play(),
    _alSourcePause: (args) => runtime.source(args(0)).pause(),
    _alSourceStop: (args) => runtime.source(args(0)).stop(),
    _alSourceRewind: (args) => runtime.source(args(0)).rewind(),
    _alSourcei: (args) =>
      setInteger(runtime, runtime.source(args(0)), args(1), args(Argument.Value) | 0),
    _alSourcef: (args) =>
      setScalar(runtime.source(args(0)), args(1), floatFromBits(args(Argument.Value))),
    _alSource3f: (args) =>
      setVector(runtime.source(args(0)), args(1), [
        floatFromBits(args(Argument.Value)),
        floatFromBits(args(Argument.Y)),
        floatFromBits(args(Argument.Z)),
      ]),
    _alSourcefv: (args) => {
      const name = args(1),
        vector = name === AL.Position || name === AL.Direction || name === AL.Velocity;
      const bytes = host.read(args(Argument.Value), (vector ? VectorIndex.Z + 1 : 1) * WORD_BYTES),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const source = runtime.source(args(0));
      if (vector)
        setVector(source, name, [
          view.getFloat32(0, true),
          view.getFloat32(WORD_BYTES, true),
          view.getFloat32(VectorIndex.Z * WORD_BYTES, true),
        ]);
      else setScalar(source, name, view.getFloat32(0, true));
    },
    _alGetSourcei: (args) =>
      host.writeWord(
        args(Argument.Value),
        Math.trunc(sourceValue(runtime.source(args(0)), args(1))),
      ),
    _alGetSourcef: (args) =>
      host.writeWord(
        args(Argument.Value),
        floatBits(sourceValue(runtime.source(args(0)), args(1))),
      ),
    ...queueImports(runtime),
  };
}
function queueImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const host = runtime.host;
  return {
    _alSourceQueueBuffers: (args) => {
      const source = runtime.source(args(0)),
        count = args(1) | 0;
      if (count < 0) throw new OpenALError(ALError.InvalidValue);
      if (!count) return;
      const names = Array.from({ length: count }, (_, index) =>
        host.readWord(args(Argument.Value) + index * WORD_BYTES),
      );
      source.append(names.map((name) => ({ name, pcm: runtime.buffer(name) })));
    },
    _alSourceUnqueueBuffers: (args) => {
      const source = runtime.source(args(0)),
        count = args(1) | 0;
      if (count < 0) throw new OpenALError(ALError.InvalidValue);
      if (!count) return;
      for (const [index, buffer] of source.unqueue(count).entries())
        host.writeWord(args(Argument.Value) + index * WORD_BYTES, buffer.name);
    },
  };
}
