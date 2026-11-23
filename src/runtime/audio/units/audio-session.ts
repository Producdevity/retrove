import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../../ios/objc/host";
import { tag } from "../files/audio-file-format";
import { AudioStatus, SessionStatus, stopSources } from "./audio-state";
import type { AudioImport, AudioRuntime, Session } from "./audio-state";
import { streamView } from "./audio-stream";

const DEFAULT_RATE = 44100;
const DEFAULT_QUANTUM = 1024;
const MIN_RATE = 8000;
const MAX_RATE = 192000;
const WORD_BYTES = 4;
const WIDE_BYTES = 8;
const ROUTE_CHANGE_REASON = 4;
const Argument = { Property: 0, Size: 1, Data: 2 } as const;
const Initialize = { Callback: 2, Ref: 3 } as const;
const Listener = { Property: 0, Callback: 1, Ref: 2 } as const;
const CATEGORIES = ["ambi", "solo", "medi", "plar"].map(tag);
const LISTENED = ["roch", "died", "aiav"].map(tag);
const Event = { Interruption: 1, Resumed: 0 } as const;

type SessionKey = "rate" | "duration" | "category" | "mix" | "duck";
type ScalarType = "Float64" | "Float32" | "Uint32";
interface SessionSpec {
  key: SessionKey | null;
  type: ScalarType;
  size: number;
}
interface SessionListener {
  property: number;
  callback: number;
  ref: number;
}
type SessionEvent = { interruption: number } | { property: number };
interface AudioSessionHost {
  audioSessionNotification(name: string, key: string, value: number): Promise<unknown>;
  audioReasonDictionary(name: string, value: number): number | Promise<number>;
}

const SPECS = new Map<number, SessionSpec>(
  (
    [
      ["hwsr", { key: "rate", type: "Float64", size: WIDE_BYTES }],
      ["iobd", { key: "duration", type: "Float32", size: WORD_BYTES }],
      ["acat", { key: "category", type: "Uint32", size: WORD_BYTES }],
      ["cmix", { key: "mix", type: "Uint32", size: WORD_BYTES }],
      ["duck", { key: "duck", type: "Uint32", size: WORD_BYTES }],
      ["aiav", { key: null, type: "Uint32", size: WORD_BYTES }],
      ["chic", { key: null, type: "Uint32", size: WORD_BYTES }],
      // A browser tab never shares the session with another app's audio.
      ["othr", { key: null, type: "Uint32", size: WORD_BYTES }],
    ] as const
  ).map(([name, spec]) => [tag(name), spec]),
);

function readScalar(view: DataView, type: ScalarType): number {
  switch (type) {
    case "Float64":
      return view.getFloat64(0, true);
    case "Float32":
      return view.getFloat32(0, true);
    case "Uint32":
      return view.getUint32(0, true);
  }
}
function writeScalar(view: DataView, type: ScalarType, value: number): void {
  switch (type) {
    case "Float64":
      return view.setFloat64(0, value, true);
    case "Float32":
      return view.setFloat32(0, value, true);
    case "Uint32":
      return view.setUint32(0, value, true);
  }
}

function acceptable(key: SessionKey, value: number): number {
  if (
    (key === "rate" && (!Number.isFinite(value) || value < MIN_RATE || value > MAX_RATE)) ||
    (key === "duration" && (!Number.isFinite(value) || value <= 0 || value > 1)) ||
    ((key === "mix" || key === "duck") && value > 1)
  )
    return AudioStatus.Parameter;
  if (key === "duck" && value) return SessionStatus.BadProperty;
  if (key === "category" && !CATEGORIES.includes(value)) return SessionStatus.BadCategory;
  return 0;
}

function writeSession(
  runtime: AudioRuntime,
  args: GuestArguments,
  spec: SessionSpec,
  key: SessionKey,
): number {
  const { type, size } = spec;
  if (args(Argument.Size) !== size) return SessionStatus.BadSize;
  const value = readScalar(streamView(runtime.cpu.read(args(Argument.Data), size)), type);
  const status = acceptable(key, value);
  if (status) return status;
  runtime.session[key] = value;
  return 0;
}

function readSession(runtime: AudioRuntime, args: GuestArguments, spec: SessionSpec): number {
  const { cpu, session } = runtime,
    { key, type, size } = spec;
  if (read32(cpu, args(Argument.Size)) < size) return SessionStatus.BadSize;
  const bytes = new Uint8Array(size);
  writeScalar(streamView(bytes), type, key === null ? 0 : session[key]);
  cpu.write(args(Argument.Data), bytes);
  write32(cpu, args(Argument.Size), size);
  return 0;
}

function sessionProperty(runtime: AudioRuntime, args: GuestArguments, write: boolean): number {
  if (!runtime.session.ready) return SessionStatus.NotInitialized;
  const spec = SPECS.get(args(Argument.Property)),
    pointer = args(Argument.Data);
  if (!spec) return SessionStatus.BadProperty;
  if (write) {
    if (spec.key === null) return SessionStatus.BadProperty;
    return pointer ? writeSession(runtime, args, spec, spec.key) : AudioStatus.Parameter;
  }
  return pointer && args(Argument.Size) ? readSession(runtime, args, spec) : AudioStatus.Parameter;
}

export function setSessionActive(runtime: AudioRuntime, enabled: boolean): number {
  if (runtime.rendering) return AudioStatus.Rendering;
  runtime.session.active = enabled;
  if (!enabled)
    for (const unit of runtime.units.values()) {
      const started = unit.started;
      stopSources(unit);
      unit.started = started;
      unit.time = 0;
      unit.frame = 0;
    }
  return 0;
}

export function newSession(): Session {
  return {
    ready: false,
    active: true,
    rate: DEFAULT_RATE,
    duration: DEFAULT_QUANTUM / DEFAULT_RATE,
    category: tag("solo"),
    mix: 0,
    duck: 0,
    interruptionCallback: 0,
    ref: 0,
  };
}

async function deliver(
  runtime: AudioRuntime,
  listeners: ReadonlyMap<string, SessionListener>,
  host: AudioSessionHost,
  event: SessionEvent,
): Promise<void> {
  const { session } = runtime;
  const { callGuest, heap, cpu } = runtime;
  if ("interruption" in event) {
    if (session.interruptionCallback)
      await callGuest(session.interruptionCallback, [session.ref, event.interruption]);
    await host.audioSessionNotification(
      "AVAudioSessionInterruptionNotification",
      "AVAudioSessionInterruptionTypeKey",
      event.interruption,
    );
    return;
  }
  const route = event.property === tag("roch");
  let slot = 0;
  try {
    if (route) {
      await host.audioSessionNotification(
        "AVAudioSessionRouteChangeNotification",
        "AVAudioSessionRouteChangeReasonKey",
        0,
      );
      const legacy = await host.audioReasonDictionary("OutputDeviceDidChange_Reason", 0);
      slot = heap.alloc(WORD_BYTES);
      write32(cpu, slot, legacy);
    }
    for (const listener of listeners.values())
      if (listener.property === event.property)
        await callGuest(listener.callback, [
          listener.ref,
          event.property,
          route ? ROUTE_CHANGE_REASON : 0,
          slot,
        ]);
  } finally {
    if (slot) heap.free(slot);
  }
}

export function audioSession(runtime: AudioRuntime) {
  const { session } = runtime;
  const events: SessionEvent[] = [],
    listeners = new Map<string, SessionListener>();
  let observed: AudioContext | undefined,
    interrupted = false,
    routeListening = false,
    sending = false;
  const onState = () => {
    const state: string | undefined = observed?.state;
    if (state === "interrupted" && !interrupted) {
      interrupted = true;
      events.push({ interruption: Event.Interruption });
    }
    if (state === "running" && interrupted) {
      interrupted = false;
      events.push({ interruption: Event.Resumed });
    }
    if (state === "closed") events.push({ property: tag("died") });
  };
  const onRoute = () => events.push({ property: tag("roch") });
  function observe(): void {
    observed ??= runtime.getAudioContext() ?? undefined;
    observed?.addEventListener?.("statechange", onState);
    if (!routeListening) {
      globalThis.navigator?.mediaDevices?.addEventListener?.("devicechange", onRoute);
      routeListening = true;
    }
  }
  const funcs: Record<string, AudioImport> = {
    _AudioSessionInitialize: (args) => {
      if (session.ready) return SessionStatus.Initialized;
      session.ready = true;
      session.interruptionCallback = args(Initialize.Callback);
      session.ref = args(Initialize.Ref);
      observe();
      return 0;
    },
    _AudioSessionSetProperty: (args) => sessionProperty(runtime, args, true),
    _AudioSessionGetProperty: (args) => sessionProperty(runtime, args, false),
    _AudioSessionAddPropertyListener: (args) => {
      const property = args(Listener.Property),
        callback = args(Listener.Callback),
        ref = args(Listener.Ref);
      if (!callback) return AudioStatus.Parameter;
      if (!LISTENED.includes(property)) return SessionStatus.BadProperty;
      if (!session.ready) return SessionStatus.NotInitialized;
      listeners.set([property, callback, ref].join("/"), { property, callback, ref });
      return 0;
    },
    _AudioSessionSetActive: (args) =>
      session.ready ? setSessionActive(runtime, !!args(0)) : SessionStatus.NotInitialized,
  };
  return {
    funcs,
    async pump(host: AudioSessionHost): Promise<void> {
      if (sending || !events.length) return;
      sending = true;
      try {
        for (const event of events.splice(0)) await deliver(runtime, listeners, host, event);
      } finally {
        sending = false;
      }
    },
    close(): void {
      observed?.removeEventListener?.("statechange", onState);
      if (routeListening)
        globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", onRoute);
      listeners.clear();
    },
  };
}
