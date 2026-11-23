import { guestBindings } from "../../graphics/guest-bindings";
import { guestErrorCheck } from "../../graphics/guest-error-check";
import { GuestLayout } from "../../memory/guest-layout";
import { read32, write32 } from "../../memory/guest-memory";
import { vfpBuiltins } from "../compiler-rt/vfp";
import { guestLibc } from "../libc/guest-libc";
import type { Binding } from "../macho/fixups";
import { loadMachO, prepareStartup, type LoadedImage, type MachOMemory } from "../macho/load";
import { initialized } from "../objc/runtime-types";
import { guestMutexFunctions } from "../threads/guest-mutex";
import type { FrameworkLayer, GraphicsWords } from "./framework-imports";
import type { ImportContext, SystemLayer } from "./guest-imports";
import type { HostCalls } from "./host-calls";
import { GATE_BYTES, GATES, RETURN, type HostFunction } from "./host-gates";
import { hex, label } from "./snapshot";

const ARM_GATE_LOOP = 0xeafffffe;
const GATE_WORD = 4;
const READ_EXECUTE = 5;
const READ_WRITE = 3;
const STACK_TOP = GuestLayout.StackTop;
const STACK_SIZE = GuestLayout.StackTop - GuestLayout.StackBottom;
const Register = { Ip: 12, Sp: 13 } as const;
const BINDER_OFFSET = 4;
const BINDER_FRAME = 8;
/** Unmapped pages for unresolved eager imports, so a dereference faults at its first use. */
const DEFERRED_BASE = 0x80000000;
const DEFERRED_PAGE = 4096;
const MAX_DEFERRED = 65536;
const LISTED_UNSUPPORTED = 40;

type Functions = Map<string, HostFunction | undefined>;
interface Layers {
  readonly system: SystemLayer;
  readonly frameworks: FrameworkLayer;
  readonly funcs: Functions;
  readonly words: GraphicsWords;
  readonly calls: HostCalls;
}

/** dyld's lazy binder: binds the slot the stub names, then jumps to its target. */
export function lazyBinder(context: ImportContext, loaded: () => LoadedImage | undefined) {
  const { cpu } = context;
  return () => {
    const sp = cpu.getReg(Register.Sp),
      offset = read32(cpu, sp + BINDER_OFFSET),
      binding = initialized(loaded(), "load").lazyTargets.get(offset);
    if (!binding?.target) throw Error("No dyld lazy binding at stream offset " + hex(offset));
    write32(cpu, binding.slot, binding.value);
    cpu.setReg(Register.Sp, sp + BINDER_FRAME);
    cpu.setReg(Register.Ip, binding.target);
    return { jump: binding.target };
  };
}

/** The import gates and the main stack; a missed import trap stays at its own address until the bounded CPU slice ends. */
function mapGates(context: ImportContext, calls: HostCalls): void {
  const { cpu } = context;
  cpu.map(GATES, GATE_BYTES, READ_EXECUTE);
  const gateCode = new Uint8Array(GATE_BYTES);
  const gateView = new DataView(gateCode.buffer);
  for (let i = 0; i < gateCode.length; i += GATE_WORD) gateView.setUint32(i, ARM_GATE_LOOP, true);
  cpu.write(GATES, gateCode);
  cpu.map(STACK_TOP - STACK_SIZE, STACK_SIZE, READ_WRITE);
  cpu.trapRange(GATES, RETURN - 1, (_, at) => {
    calls.pending = at;
  });
}

/** ARM leaves that run hot libc, VFP, mutex and GL routines in guest code. */
function nativeLeaves(context: ImportContext, funcs: Functions, words: GraphicsWords) {
  const { cpu, heap, gates } = context,
    { hostGate } = gates;
  const libSystem = (name: string) => hostGate({ name, library: "libSystem" }, funcs.get(name));
  const libc = guestLibc(cpu, heap, {
    memcpy: libSystem("_memcpy"),
    memset: libSystem("_memset"),
    divide: libSystem("___umodsi3"),
  });
  const vfp = vfpBuiltins(cpu, heap);
  const mutexes = guestMutexFunctions(cpu, heap, {
    budget: cpu.budget,
    lock: libSystem("_pthread_mutex_lock"),
    unlock: libSystem("_pthread_mutex_unlock"),
  });
  const getError = funcs.get("_glGetError");
  const errorCheck =
    words.errorFlag && getError
      ? guestErrorCheck(
          cpu,
          heap,
          words.errorFlag,
          hostGate({ name: "_glGetError", library: "OpenGLES" }, getError),
        )
      : 0;
  const gl = (name: string) => hostGate({ name, library: "OpenGLES" }, funcs.get(name));
  const bindings =
    words.bindingShadow &&
    funcs.get("_glBindBuffer") &&
    funcs.get("_glActiveTexture") &&
    funcs.get("_glBindTexture")
      ? guestBindings(cpu, heap, words.bindingShadow, {
          bindBuffer: gl("_glBindBuffer"),
          activeTexture: gl("_glActiveTexture"),
          bindTexture: gl("_glBindTexture"),
        })
      : new Map<string, number>();
  return { libc, vfp, mutexes, bindings, errorCheck };
}

/** Maps the executable and binds every import to native code, guest data, a host gate or a deferred page. */
function loadImage(context: ImportContext, layers: Layers, memory: MachOMemory): LoadedImage {
  const { image, threads, gates, report } = context,
    { sys, cxx } = layers.system,
    { objc, dispatch, cg } = layers.frameworks,
    { deferred } = report.state;
  const native = nativeLeaves(context, layers.funcs, layers.words);
  return loadMachO(image, memory, (b: Binding) => {
    const data =
      native.libc.get(b.name) ??
      native.bindings.get(b.name) ??
      native.vfp.get(b.name) ??
      native.mutexes.get(b.name) ??
      threads.nativeFunctions.get(b.name) ??
      sys.data.get(b.name) ??
      cxx.data.get(b.name) ??
      objc.resolveData(b.name) ??
      dispatch.data.get(b.name) ??
      cg.data.get(b.name) ??
      ((b.name === "_glGetError" && native.errorCheck) || undefined);
    if (data !== null && data !== undefined) return data;
    const fn = layers.funcs.get(b.name);
    if (!fn && b.weak) return null;
    // Lazy slots are callable. Unknown eager symbols may instead be data. Give
    // each a unique unmapped page so a dereference faults at the first use.
    if (!fn && b.mode !== "lazy") {
      let page = deferred.get(b.name);
      if (page === undefined) {
        if (deferred.size >= MAX_DEFERRED) throw Error("Too many unresolved eager imports");
        page = DEFERRED_BASE + deferred.size * DEFERRED_PAGE;
        deferred.set(b.name, page);
      }
      return page;
    }
    return gates.hostGate(b, fn);
  });
}

/** Links the executable into guest memory and lays out the startup stack. */
export function linkGuest(context: ImportContext, layers: Layers) {
  const { cpu, heap, ipa, gates, report, prepared, options } = context,
    { state } = report,
    { diagnostic } = options;
  const memory: MachOMemory = {
    map: (address, size, permissions) => cpu.map(address, size, permissions),
    write: (address, bytes) => cpu.write(address, bytes),
    read32: (p) => read32(cpu, p),
    write32: (p, v) => write32(cpu, p, v),
  };
  mapGates(context, layers.calls);
  const load = loadImage(context, layers, memory);
  state.parts.remoteGraphics?.publishGates(gates.stubs);
  // Host kernels replace hot guest routines for the interpreter; translated code runs the
  // originals faster than a round trip that copies their buffers (BioShock: 21 to 30 FPS).
  const hooks = prepared.native?.({ cpu, heap }) ?? 0;
  if (hooks) diagnostic("info", "profile", `Installed ${hooks} guest fast paths`);
  if (cpu.method !== "translated")
    prepared.install?.({
      cpu,
      heap,
      gate: (name, fn) => gates.hostGate({ name, library: "Retrove" }, fn),
    });
  const startup = prepareStartup(memory, STACK_TOP, "/" + ipa.executablePath);
  const unsupported = [
    ...new Set(
      [...gates.stubs.values()]
        .filter((s) => !s.fn)
        .map((s) => s.binding.name)
        .concat([...state.deferred.keys()]),
    ),
  ].sort();
  state.link = {
    ...state.link,
    initializers: load.initializers.length,
    unsupportedCount: unsupported.length,
    unsupported: unsupported.slice(0, LISTED_UNSUPPORTED).map(label),
  };
  if (unsupported.length)
    diagnostic(
      "debug",
      "linker",
      "Unresolved imports in this executable",
      unsupported.map(label).join("\n"),
    );
  return { load, startup, unsupported };
}
