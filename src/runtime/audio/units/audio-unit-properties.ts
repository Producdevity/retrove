import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../../ios/objc/host";
import { AudioStatus, withUnit } from "./audio-state";
import type { AudioRuntime, OutputUnit } from "./audio-state";
import { parseStream, STREAM_BYTES } from "./audio-stream";

const Property = { Stream: 8, Frames: 14, Callback: 23, IO: 2003 } as const;
const Scope = { Global: 0, Input: 1, Output: 2 } as const;
const Argument = { Id: 1, Scope: 2, Element: 3, Data: 4, Size: 5 } as const;
const WORD_BYTES = 4;
const CALLBACK_BYTES = 8;
const MIN_FRAMES = 64;
const MAX_FRAMES = 16384;

function propertySize(property: number, scope: number): number {
  switch (property) {
    case Property.Stream:
      return scope === Scope.Input || scope === Scope.Output ? STREAM_BYTES : AudioStatus.BadScope;
    case Property.Frames:
      return scope === Scope.Global ? WORD_BYTES : AudioStatus.BadScope;
    case Property.Callback:
      return scope === Scope.Global || scope === Scope.Input
        ? CALLBACK_BYTES
        : AudioStatus.BadScope;
    case Property.IO:
      return scope === Scope.Output ? WORD_BYTES : AudioStatus.BadScope;
    default:
      return AudioStatus.InvalidProperty;
  }
}

function writeProperty(
  runtime: AudioRuntime,
  unit: OutputUnit,
  args: GuestArguments,
  size: number,
): number {
  const { cpu } = runtime;
  const property = args(Argument.Id),
    scope = args(Argument.Scope),
    pointer = args(Argument.Data);
  if (unit.work) return AudioStatus.ReadOnlyWhileInitialized;
  if (args(Argument.Size) !== size) return AudioStatus.BadSize;
  if (property === Property.Stream) {
    if (scope !== Scope.Input) return AudioStatus.BadScope;
    const raw = cpu.read(pointer, size),
      format = parseStream(raw);
    if (!format) return AudioStatus.BadFormat;
    unit.raw = raw;
    unit.format = format;
  } else if (property === Property.Callback) {
    unit.callback = read32(cpu, pointer);
    unit.ref = read32(cpu, pointer + WORD_BYTES);
  } else if (property === Property.Frames) {
    const frames = read32(cpu, pointer);
    if (frames < MIN_FRAMES || frames > MAX_FRAMES) return AudioStatus.BadSize;
    unit.maximum = frames;
  } else if (read32(cpu, pointer) !== 1) return AudioStatus.BadSize;
  return 0;
}

function readProperty(
  runtime: AudioRuntime,
  unit: OutputUnit,
  args: GuestArguments,
  size: number,
): number {
  const { cpu } = runtime;
  const property = args(Argument.Id),
    pointer = args(Argument.Data),
    sizePointer = args(Argument.Size);
  if (read32(cpu, sizePointer) < size) return AudioStatus.BadSize;
  if (property === Property.Stream) cpu.write(pointer, unit.raw);
  else if (property === Property.Callback) {
    write32(cpu, pointer, unit.callback);
    write32(cpu, pointer + WORD_BYTES, unit.ref);
  } else write32(cpu, pointer, property === Property.Frames ? unit.maximum : 1);
  write32(cpu, sizePointer, size);
  return 0;
}

export function unitProperty(runtime: AudioRuntime, args: GuestArguments, write: boolean): number {
  return withUnit(runtime, args, (unit) => {
    const property = args(Argument.Id),
      scope = args(Argument.Scope),
      pointer = args(Argument.Data);
    if (args(Argument.Element) !== 0) return AudioStatus.BadElement;
    if (!pointer || (!write && !args(Argument.Size))) return AudioStatus.Parameter;
    const size = propertySize(property, scope);
    if (size < 0) return size;
    return write
      ? writeProperty(runtime, unit, args, size)
      : readProperty(runtime, unit, args, size);
  });
}
