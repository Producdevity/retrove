import { ALC, ALCError, MAX_SOURCES } from "./constants";
import type { ALFunction, OpenALRuntime } from "./runtime";
import { WORD_BYTES } from "../../ios/abi/scalars";
const QueryArgument = { Size: 2, Output: 3 } as const;
const DEVICE_NAME = "Retrove Web Audio";
export function deviceImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const host = runtime.host;
  return {
    _alcOpenDevice: () => {
      const output = host.output();
      if (!output) return 0;
      const pointer = runtime.opaque();
      runtime.devices.set(pointer, { output, buffers: new Map(), error: 0 });
      return pointer;
    },
    _alcCloseDevice: (args) => {
      const pointer = args(0),
        device = runtime.devices.get(pointer);
      if (!device) {
        runtime.deviceError ||= ALCError.InvalidDevice;
        return 0;
      }
      if ([...runtime.contexts.values()].some((context) => context.device === pointer)) return 0;
      runtime.devices.delete(pointer);
      host.free(pointer);
      return 1;
    },
    _alcCreateContext: (args) => {
      const device = args(0);
      if (!runtime.devices.has(device)) {
        runtime.deviceError ||= ALCError.InvalidDevice;
        return 0;
      }
      const pointer = runtime.opaque();
      runtime.contexts.set(pointer, { device, sources: new Map(), suspended: false, error: 0 });
      return pointer;
    },
    _alcDestroyContext: (args) => runtime.destroyContext(args(0)),
    _alcMakeContextCurrent: (args) => {
      const pointer = args(0);
      if (pointer && !runtime.contexts.has(pointer)) {
        runtime.deviceError ||= ALCError.InvalidContext;
        return 0;
      }
      runtime.current = pointer;
      return 1;
    },
    _alcGetCurrentContext: () => runtime.current,
    _alcGetContextsDevice: (args) => runtime.contexts.get(args(0))?.device ?? 0,
    _alcProcessContext: (args) => processing(runtime, args(0), false),
    _alcSuspendContext: (args) => processing(runtime, args(0), true),
    _alcGetError: (args) => {
      const device = runtime.devices.get(args(0)),
        error = device?.error || runtime.deviceError;
      if (device) device.error = 0;
      runtime.deviceError = 0;
      return error;
    },
    _alcIsExtensionPresent: () => 0,
    ...queryImports(runtime),
  };
}
function processing(runtime: OpenALRuntime, pointer: number, suspended: boolean): void {
  const context = runtime.contexts.get(pointer);
  if (!context) {
    runtime.deviceError ||= ALCError.InvalidContext;
    return;
  }
  if (context.suspended === suspended) return;
  context.suspended = suspended;
  for (const source of context.sources.values())
    if (suspended) source.suspend();
    else source.resume();
}
function deviceParameter(
  runtime: OpenALRuntime,
  device: number,
  name: number,
): readonly number[] | undefined {
  const attributes = [
    ALC.Frequency,
    runtime.devices.get(device)?.output.rate ?? 0,
    ALC.MonoSources,
    MAX_SOURCES,
    ALC.StereoSources,
    MAX_SOURCES,
    0,
  ];
  switch (name) {
    case ALC.MajorVersion:
    case ALC.MinorVersion:
      return [1];
    case ALC.Frequency:
      return [runtime.devices.get(device)?.output.rate ?? 0];
    case ALC.Refresh:
    case ALC.Sync:
      return [0];
    case ALC.MonoSources:
    case ALC.StereoSources:
      return [MAX_SOURCES];
    case ALC.AttributesSize:
      return [attributes.length];
    case ALC.AllAttributes:
      return attributes;
    default:
      runtime.deviceError ||= ALCError.InvalidEnum;
      return undefined;
  }
}

function queryImports(runtime: OpenALRuntime): Record<string, ALFunction> {
  const host = runtime.host;
  return {
    _alcGetString: (args) => {
      switch (args(1)) {
        case ALC.DefaultDevice:
        case ALC.Device:
          return host.string(DEVICE_NAME);
        case ALC.Extensions:
          return host.string("");
        default:
          runtime.deviceError ||= ALCError.InvalidEnum;
          return 0;
      }
    },
    _alcGetIntegerv: (args) => {
      if ((args(QueryArgument.Size) | 0) < 1 || !args(QueryArgument.Output)) {
        runtime.deviceError ||= ALCError.InvalidValue;
        return;
      }
      const values = deviceParameter(runtime, args(0), args(1));
      if (!values) return;
      if ((args(QueryArgument.Size) | 0) < values.length) {
        runtime.deviceError ||= ALCError.InvalidValue;
        return;
      }
      values.forEach((value, index) =>
        host.writeWord(args(QueryArgument.Output) + index * WORD_BYTES, value),
      );
    },
  };
}
