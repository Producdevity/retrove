import { audioFiles } from "../../audio/files/audio-file";
import { systemSounds } from "../../audio/system-sound";
import { coreGraphics } from "../../graphics/core-graphics/coregraphics";
import { remoteDrawable } from "../../graphics/drawable";
import { glesImports } from "../../graphics/gles";
import type { RemoteGraphics } from "../../graphics/remote/remote-graphics";
import { read32 } from "../../memory/guest-memory";
import { guestSqlite } from "../../sqlite/sqlite";
import { guestFiles } from "../../sqlite/guest-files";
import { commonCrypto } from "../crypto/commoncrypto";
import { compressionImports } from "../libc/compression";
import { objcImports } from "../objc/objc";
import type { GuestArguments } from "../objc/host";
import type { ObjcRuntime } from "../objc/runtime-api";
import type { ObjcExceptionRuntime, PageGraphics } from "../objc/runtime-types";
import type { CoreGraphicsObjc } from "../../graphics/core-graphics/quartz-objects";
import type { CxxImports } from "../../cxx/cxx";
import { dispatchImports } from "../threads/dispatch";
import { registerValue } from "../threads/thread-types";
import type { ImportContext, SystemLayer } from "./guest-imports";
import type { HostFunction } from "./host-gates";
import { renderCounts } from "./snapshot";

function isHostFunction(value: unknown): value is HostFunction {
  return typeof value === "function";
}
function isCloser(value: unknown): value is () => unknown {
  return typeof value === "function";
}

/** C++ unwinding for Objective-C throws; present whenever the C++ imports have an unwinder. */
function exceptionRuntime(cxx: CxxImports): { cxx?: ObjcExceptionRuntime } {
  const { objcType, throwObjC } = cxx;
  return objcType && throwObjC ? { cxx: { objcType, throwObjC } } : {};
}
/** The Objective-C services Core Graphics reads CFData and strings through. */
function quartzHost(objc: ObjcRuntime): CoreGraphicsObjc {
  const word =
    (name: string) =>
    (args: GuestArguments): number => {
      const fn = objc.funcs[name];
      if (!fn) throw new TypeError(`objc.funcs.${name} is not a function`);
      return registerValue(fn(args));
    };
  return {
    currentThreadId: objc.currentThreadId,
    funcs: {
      _CFDataGetBytePtr: word("_CFDataGetBytePtr"),
      _CFDataGetLength: word("_CFDataGetLength"),
    },
    retainObject: objc.retainObject,
    releaseObject: objc.releaseObject,
    stringText: objc.stringText,
  };
}

/** The Objective-C runtime with the frameworks over it: Core Graphics, sounds, audio files and dispatch. */
export function frameworkLayer(
  context: ImportContext,
  system: SystemLayer,
  remoteGraphics: RemoteGraphics | undefined,
) {
  const { cpu, heap, ipa, options, report, gates, threads, runner, resources } = context,
    { parts } = report.state,
    { audioContext, diagnostic } = options,
    { nested } = runner,
    { sys, cxx, audio } = system;
  const graphics: () => PageGraphics = remoteGraphics
    ? () => ({ canvas: remoteGraphics.canvas, worker: true })
    : options.graphics;
  const objc = objcImports(cpu, heap, ipa, graphics, nested, options.signal, runner.service, {
    threads,
    sys,
    audio,
    audioOutput: audioContext,
    ...(options.mediaHost ? { mediaHost: options.mediaHost } : {}),
    ...(options.needsMovieResume ? { needsMovieResume: options.needsMovieResume } : {}),
    diagnostic,
    hostGate: gates.hostGate,
    ...exceptionRuntime(cxx),
    ...(remoteGraphics
      ? { drawable: (geometry) => remoteDrawable(remoteGraphics.command, geometry, diagnostic) }
      : {}),
    onLifecycle: report.milestone,
    glPresented: () => renderCounts(report.state).presentedFrames > 0,
    onPresent: report.present,
  });
  parts.objc = objc;
  const cg = coreGraphics(cpu, heap, quartzHost(objc), {
    readFile: guestFiles(cpu, heap, sys).readFile,
  });
  objc.attachCoreGraphics(cg);
  const sounds = systemSounds(cpu, ipa, audioContext, (url) => objc.fileURLPath(url), nested);
  resources.sounds = sounds;
  const fileAudio = audioFiles(cpu, heap, nested, {
    path: (url) => objc.fileURLPath(url),
    errno: () => {
      const error = sys.funcs["___error"];
      if (!error) throw new TypeError("sys.funcs.___error is not a function");
      return read32(cpu, registerValue(error(() => 0)));
    },
    allocate: (n) => heap.alloc(n),
    free: (p) => heap.free(p),
    string: (s) => heap.string(s),
    read: (p, n) => cpu.read(p, n),
    word: (p) => read32(cpu, p),
    invoke: async (name, args) => {
      const fn = sys.funcs[name];
      if (!fn) throw new TypeError(`sys.funcs.${name} is not a function`);
      const value = await fn((i) => args[i] ?? 0);
      return typeof value === "bigint" ? value : registerValue(value);
    },
  });
  const close: unknown = Object.getOwnPropertyDescriptor(fileAudio, "close")?.value;
  if (isCloser(close)) resources.closeAudioFiles = close;
  const dispatch = dispatchImports(cpu, heap, threads, nested, objc, gates.hostGate);
  objc.setDispatch(dispatch);
  return { objc, cg, sounds, fileAudio, dispatch };
}
export type FrameworkLayer = ReturnType<typeof frameworkLayer>;

/** Every host import by name; a later table's entry replaces an earlier one's. */
function hostFunctions(tables: readonly object[]): Map<string, HostFunction | undefined> {
  const funcs = new Map<string, HostFunction | undefined>();
  for (const table of tables)
    for (const [name, value] of Object.entries(table))
      funcs.set(name, isHostFunction(value) ? value : undefined);
  return funcs;
}

export interface GraphicsWords {
  /** The guest word glGetError's fast path reads, or zero. */
  errorFlag: number;
  /** The guest words the bind fast paths read, or zero. */
  bindingShadow: number;
}

/** The import table the linker binds, with the GL fast paths' shared words. */
export function collectFunctions(
  context: ImportContext,
  system: SystemLayer,
  frameworks: FrameworkLayer,
  remoteGraphics: RemoteGraphics | undefined,
): { funcs: Map<string, HostFunction | undefined>; words: GraphicsWords } {
  const { cpu, heap, options, threads, runner, resources } = context,
    { sys, cxx, audio, al, queues } = system,
    { objc, dispatch, cg, sounds, fileAudio } = frameworks;
  const words: GraphicsWords = { errorFlag: 0, bindingShadow: 0 };
  const state = (): readonly [number, number] => [objc.graphicsAPI(), objc.graphicsContext()];
  const funcs = hostFunctions([
    sys.funcs,
    cxx.funcs,
    objc.funcs,
    threads.funcs,
    dispatch.funcs,
    cg.funcs,
    audio.funcs,
    al.funcs,
    queues.funcs,
    sounds.funcs,
    fileAudio,
    commonCrypto(cpu, heap),
    compressionImports(cpu, heap, options.signal),
    guestSqlite(cpu, heap, sys, runner.nested, options.diagnostic),
    remoteGraphics
      ? remoteGraphics.imports(cpu, state)
      : glesImports(cpu, heap, options.graphics, options.diagnostic, {
          currentAPI: objc.graphicsAPI,
          currentContext: objc.graphicsContext,
          onClose: (close) => {
            resources.closeGraphics = close;
          },
          onErrorFlag: (address) => {
            words.errorFlag = address;
          },
          onBindingShadow: (address) => {
            words.bindingShadow = address;
          },
        }),
  ]);
  if (remoteGraphics) {
    words.errorFlag = remoteGraphics.errorFlag;
    words.bindingShadow = remoteGraphics.bindingShadow;
  }
  return { funcs, words };
}
