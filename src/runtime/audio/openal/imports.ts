import { AL, ALError, OpenALError } from "./constants";
import { bufferImports } from "./buffers";
import { AL_ENUM_VALUES } from "./enum-names";
import { deviceImports } from "./devices";
import { sourceImports } from "./sources";
import { listenerImports } from "./listener";
import { OpenALRuntime, type ALFunction, type OpenALHost } from "./runtime";
export function openAL(host: OpenALHost) {
  const runtime = new OpenALRuntime(host);
  const funcs: Record<string, ALFunction> = {};
  for (const [name, fn] of Object.entries(deviceImports(runtime)))
    funcs[name] = (args) => {
      try {
        return fn(args);
      } catch (error) {
        if (!(error instanceof OpenALError)) throw error;
        runtime.deviceError ||= error.code;
        return 0;
      }
    };
  for (const [name, fn] of Object.entries({
    ...bufferImports(runtime),
    ...sourceImports(runtime),
    ...listenerImports(runtime),
  }))
    funcs[name] = runtime.bind(fn);
  funcs._alGetError = () => {
    const context = runtime.contexts.get(runtime.current),
      error = context?.error || runtime.error;
    if (context) context.error = 0;
    runtime.error = 0;
    return error;
  };
  funcs._alGetString = runtime.bind((args) => {
    switch (args(0)) {
      case AL.Vendor:
        return host.string("Retrove");
      case AL.Version:
        return host.string("1.1");
      case AL.Renderer:
        return host.string("Web Audio");
      case AL.Extensions:
        return host.string("");
      default:
        runtime.context.error ||= ALError.InvalidEnum;
        return 0;
    }
  });
  funcs._alIsExtensionPresent = () => 0;
  funcs._alGetEnumValue = runtime.bind((args) => {
    const pointer = args(0);
    const value = pointer ? AL_ENUM_VALUES.get(host.text(pointer)) : undefined;
    if (value === undefined) runtime.context.error ||= ALError.InvalidValue;
    return value ?? 0;
  });
  for (const name of ["_alGetProcAddress", "_alcGetProcAddress"])
    funcs[name] = (args) => {
      const pointer = args(name === "_alGetProcAddress" ? 0 : 1);
      if (!pointer) return 0;
      const symbol = "_" + host.text(pointer),
        fn = funcs[symbol];
      return fn ? host.gate(symbol, fn) : 0;
    };
  const calls = new Map<string, number>();
  for (const [name, fn] of Object.entries(funcs))
    funcs[name] = (args) => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return fn(args);
    };
  return {
    funcs,
    close: () => runtime.close(),
    snapshot: () => ({
      calls: Object.fromEntries(calls),
      devices: runtime.devices.size,
      contexts: runtime.contexts.size,
      buffers: [...runtime.devices.values()].reduce(
        (count, device) => count + device.buffers.size,
        0,
      ),
      sources: [...runtime.contexts.values()].reduce(
        (count, context) => count + context.sources.size,
        0,
      ),
    }),
  };
}
