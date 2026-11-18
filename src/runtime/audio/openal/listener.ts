import { floatBits, WORD_BYTES } from "../../ios/abi/scalars";
import { AL, ALError, OpenALError, type Vector3 } from "./constants";
import type { ALFunction, OpenALRuntime } from "./runtime";

/** The listener of one OpenAL context; orientation is "at" then "up". */
export interface ListenerState {
  gain: number;
  position: Vector3;
  velocity: Vector3;
  orientation: readonly [number, number, number, number, number, number];
}
const VECTOR_FLOATS = 3;
const ORIENTATION_FLOATS = 6;
const Arg = { Parameter: 0, Value: 1, Y: 2, Z: 3 } as const;
export function defaultListener(): ListenerState {
  return { gain: 1, position: [0, 0, 0], velocity: [0, 0, 0], orientation: [0, 0, -1, 0, 1, 0] };
}

function floats(runtime: OpenALRuntime, pointer: number, count: number): number[] {
  const bytes = runtime.host.read(pointer, count * WORD_BYTES),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: count }, (_, index) => view.getFloat32(index * WORD_BYTES, true));
}
function finite(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value))) throw new OpenALError(ALError.InvalidValue);
}
function set(runtime: OpenALRuntime, name: number, values: readonly number[]): void {
  finite(values);
  const listener = runtime.context.listener;
  const [x = 0, y = 0, z = 0] = values;
  switch (name) {
    case AL.Gain:
      if (x < 0) throw new OpenALError(ALError.InvalidValue);
      listener.gain = x;
      break;
    case AL.Position:
      listener.position = [x, y, z];
      break;
    case AL.Velocity:
      listener.velocity = [x, y, z];
      break;
    case AL.Orientation: {
      const [ax = 0, ay = 0, az = -1, ux = 0, uy = 1, uz = 0] = values;
      listener.orientation = [ax, ay, az, ux, uy, uz];
      break;
    }
    default:
      throw new OpenALError(ALError.InvalidEnum);
  }
  runtime.device.output.listener?.(listener);
}
function get(runtime: OpenALRuntime, name: number): readonly number[] {
  const listener = runtime.context.listener;
  switch (name) {
    case AL.Gain:
      return [listener.gain];
    case AL.Position:
      return listener.position;
    case AL.Velocity:
      return listener.velocity;
    case AL.Orientation:
      return listener.orientation;
    default:
      throw new OpenALError(ALError.InvalidEnum);
  }
}
const count = (name: number) =>
  name === AL.Orientation ? ORIENTATION_FLOATS : name === AL.Gain ? 1 : VECTOR_FLOATS;

export function listenerImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const scalar = (args: Parameters<ALFunction>[0], index: number) => {
    const view = new DataView(new ArrayBuffer(WORD_BYTES));
    view.setUint32(0, args(index), true);
    return view.getFloat32(0, true);
  };
  const write = (pointer: number, values: readonly number[]) =>
    values.forEach((value, index) =>
      runtime.host.writeWord(pointer + index * WORD_BYTES, floatBits(value)),
    );
  return {
    _alListenerf: (args) => set(runtime, args(Arg.Parameter), [scalar(args, Arg.Value)]),
    _alListener3f: (args) =>
      set(
        runtime,
        args(Arg.Parameter),
        [Arg.Value, Arg.Y, Arg.Z].map((i) => scalar(args, i)),
      ),
    _alListenerfv: (args) =>
      set(
        runtime,
        args(Arg.Parameter),
        floats(runtime, args(Arg.Value), count(args(Arg.Parameter))),
      ),
    _alGetListenerf: (args) =>
      write(args(Arg.Value), get(runtime, args(Arg.Parameter)).slice(0, 1)),
    _alGetListener3f: (args) =>
      get(runtime, args(Arg.Parameter))
        .slice(0, VECTOR_FLOATS)
        .forEach((value, index) => write(args(Arg.Value + index), [value])),
    _alGetListenerfv: (args) => write(args(Arg.Value), get(runtime, args(Arg.Parameter))),
  };
}
