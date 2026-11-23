import { openAL } from "../../audio/openal/imports";
import { WebAudioOutput } from "../../audio/openal/output";
import { audioQueues } from "../../audio/queue/audio-queue";
import { audioImports } from "../../audio/units/audio";
import type { GuestCPU } from "../../cpu/cpu";
import { LOCAL_IMPORT_NAMES } from "../../cpu/worker/local-imports";
import { threadPlacement } from "../../cpu/worker/placement";
import { cxxImports } from "../../cxx/cxx";
import { startRemoteGraphics } from "../../graphics/remote/remote-graphics";
import { read32, readString, write32, type Heap } from "../../memory/guest-memory";
import { nonlocalJumps } from "../libc/nonlocal-jump";
import { systemImports } from "../libc/libsystem";
import type { MachOImage } from "../macho/macho";
import type { IpaArchive } from "../package/ipa";
import type { prepareApplication } from "../profiles/index";
import { initialized } from "../objc/runtime-types";
import type { GuestThreads } from "../threads/threads";
import type { GuestReport } from "./guest-report";
import type { GuestRunner } from "./guest-runner";
import type { HostGates } from "./host-gates";
import type { ResolvedOptions } from "./options";

export type PreparedApplication = Awaited<ReturnType<typeof prepareApplication>>;

/** What the runtime closes when the run ends, in the order it built them. */
export interface Resources {
  closeFiles?: () => unknown;
  queues?: { close(): void };
  sounds?: { close(): void };
  closeAudioFiles?: () => unknown;
  closeGraphics?: () => void;
}
export interface ImportContext {
  readonly ipa: IpaArchive;
  readonly options: ResolvedOptions;
  readonly report: GuestReport;
  readonly cpu: GuestCPU;
  readonly heap: Heap;
  readonly image: MachOImage;
  readonly gates: HostGates;
  readonly threads: GuestThreads;
  readonly runner: GuestRunner;
  readonly prepared: PreparedApplication;
  readonly resources: Resources;
}

/** libSystem, setjmp, C++, audio and OpenAL imports, and the profile's thread placement. */
export function systemLayer(context: ImportContext) {
  const { cpu, heap, ipa, options, report, gates, threads, runner, image, resources } = context,
    { parts } = report.state,
    { audioContext, diagnostic } = options,
    { hostGate } = gates,
    { nested } = runner;
  const jumps = nonlocalJumps(cpu, heap, threads);
  threads.nativeFunctions.set("_setjmp", jumps.save);
  const sys = systemImports(
    cpu,
    heap,
    ipa,
    options.log,
    threads.funcs._pthread_self,
    diagnostic,
    report.missingAsset,
    hostGate,
    nested,
    image,
  );
  const cxx = cxxImports(cpu, heap, threads.funcs._pthread_self, {
    threads,
    nested,
    hostGate,
    objc: () => initialized(parts.objc, "objc"),
  });
  resources.closeFiles = sys.closeFiles;
  const queues = audioQueues(cpu, heap, nested, audioContext);
  resources.queues = queues;
  const audio = audioImports(cpu, heap, nested, audioContext);
  parts.audio = audio;
  const al = openAL({
    read: (p, n) => cpu.read(p, n),
    readWord: (p) => read32(cpu, p),
    writeWord: (p, v) => write32(cpu, p, v),
    text: (p) => readString(cpu, p),
    string: (s) => heap.string(s),
    allocate: (n) => heap.zero(n),
    free: (p) => heap.free(p),
    output: () => {
      const context = audioContext();
      return !context || context.state === "closed" ? null : new WebAudioOutput(context);
    },
    gate: (name, fn) => hostGate({ name, library: "OpenAL" }, fn),
  });
  parts.al = al;
  const { workers } = cpu;
  if (workers && context.prepared.threads)
    workers.placement = threadPlacement(context.prepared.threads, image, (p) => read32(cpu, p));
  if (workers)
    workers.localGates = () =>
      [...gates.stubs]
        .filter(([, host]) => LOCAL_IMPORT_NAMES.has(host.binding.name))
        .map(([gate, host]) => [gate, host.binding.name] as const);
  return { jumps, sys, cxx, queues, audio, al };
}
export type SystemLayer = ReturnType<typeof systemLayer>;

/** With worker threads, the app's graphics thread runs where the WebGL context lives. */
export async function graphicsWorker(context: ImportContext) {
  const { cpu, heap, options, threads, prepared, report } = context;
  const remoteGraphics = await startRemoteGraphics({
    workers: cpu.workers,
    rules: prepared.threads,
    display: options.offscreenGraphics,
    heap,
    idle: (promise) => threads.idle(promise),
    diagnostic: options.diagnostic,
  });
  report.state.parts.remoteGraphics = remoteGraphics;
  if (remoteGraphics && cpu.workers) {
    const { parts } = report.state;
    cpu.workers.graphicsState = () => {
      const objc = initialized(parts.objc, "objc");
      return [objc.graphicsAPI(), objc.graphicsContext()];
    };
  }
  return remoteGraphics;
}
