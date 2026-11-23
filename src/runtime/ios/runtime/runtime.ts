import { createCPU, type GuestCPU } from "../../cpu/cpu";
import { ExecutionBudget } from "../../cpu/execution-budget";
import { ownCpuEnabled } from "../../cpu/translation/settings";
import { translationAppKey } from "../../cpu/translation/translation-data";
import { Heap } from "../../memory/guest-memory";
import type { LoadedImage, Startup } from "../macho/load";
import { parseMachO, type MachOImage } from "../macho/macho";
import type { IpaArchive } from "../package/ipa";
import { appProfile } from "../profiles/app-manifest";
import { prepareApplication } from "../profiles/index";
import { resolveScheduling } from "../threads/scheduling";
import { threadImports } from "../threads/threads";
import { GuestExit } from "./fault";
import { collectFunctions, frameworkLayer, type FrameworkLayer } from "./framework-imports";
import {
  graphicsWorker,
  systemLayer,
  type ImportContext,
  type PreparedApplication,
  type Resources,
  type SystemLayer,
} from "./guest-imports";
import { GuestReport } from "./guest-report";
import { GuestRunner } from "./guest-runner";
import { HostCalls } from "./host-calls";
import { HostGates, RETURN } from "./host-gates";
import { lazyBinder, linkGuest } from "./link";
import { resolveOptions, type ResolvedOptions, type RuntimeOptions } from "./options";
import { RunState } from "./run-state";
import { hex, label } from "./snapshot";

export type { RuntimeOptions };
export interface GuestResult {
  readonly exitStatus: number | undefined;
  readonly calls: number;
}
const Register = { Sp: 13 } as const;
/** Initializers between progress reports. */
const INITIALIZER_MILESTONE = 128;

interface Executable {
  readonly prepared: PreparedApplication;
  readonly image: MachOImage;
  readonly cpu: GuestCPU;
}
interface Linked {
  readonly context: ImportContext;
  readonly system: SystemLayer;
  readonly frameworks: FrameworkLayer;
  readonly calls: HostCalls;
  readonly load: LoadedImage;
  readonly startup: Startup;
  readonly unresolved: number;
}

/** Reads, patches and parses the executable, then starts the CPU that will run it. */
async function openExecutable(
  ipa: IpaArchive,
  options: ResolvedOptions,
  report: GuestReport,
): Promise<Executable> {
  const { signal, diagnostic } = options,
    { state } = report;
  report.milestone("Read executable", { path: label(ipa.executablePath) });
  signal?.throwIfAborted();
  let bytes = await ipa.readExecutable();
  const prepared = await prepareApplication(ipa, bytes, diagnostic);
  bytes = prepared.bytes;
  signal?.throwIfAborted();
  report.milestone("Parse ARM Mach-O", { executableBytes: bytes.length });
  const image = parseMachO(bytes);
  state.parts.image = image;
  const unique = new Set(image.imports.filter((b) => b.mode !== "weak").map((b) => b.name));
  state.link = {
    entry: image.entry,
    imports: unique.size,
    executableBytes: bytes.length,
    segmentCount: image.segments.length,
    dylibCount: image.dylibs.length,
  };
  report.milestone("Initialize ARM WebAssembly CPU", {
    entry: hex(image.entry),
    imports: unique.size,
  });
  const cpu = await createCPU({
    budget: ExecutionBudget.Blocks,
    cpu: ownCpuEnabled() ? "own" : "unicorn",
    translationProfile: await translationAppKey(ipa.info?.["CFBundleIdentifier"]),
  });
  state.parts.cpu = cpu;
  signal?.throwIfAborted();
  return { prepared, image, cpu };
}

/** Builds every host import over a fresh heap and links the executable against them. */
async function assemble(
  ipa: IpaArchive,
  options: ResolvedOptions,
  report: GuestReport,
  executable: Executable,
  resources: Resources,
): Promise<Linked> {
  const { cpu, image, prepared } = executable,
    { parts } = report.state;
  report.milestone("Map segments and bind imports");
  const heap = new Heap(cpu);
  parts.heap = heap;
  const gates = new HostGates(report.state.importMetrics);
  const threads = threadImports(cpu, heap, RETURN, {
    scheduling: resolveScheduling(appProfile(ipa.info ?? {}).entry?.scheduling),
  });
  parts.threads = threads;
  const calls = new HostCalls(cpu, threads, gates.stubs, report);
  const runner = new GuestRunner(cpu, threads, report, calls, gates.stubs, image, options.signal);
  threads.connect(runner.step, runner.nested);
  const context: ImportContext = {
    ...{ ipa, options, report, cpu, heap, image, gates, threads, runner, prepared, resources },
  };
  const system = systemLayer(context);
  const remoteGraphics = await graphicsWorker(context);
  const frameworks = frameworkLayer(context, system, remoteGraphics);
  const { funcs, words } = collectFunctions(context, system, frameworks, remoteGraphics);
  let load: LoadedImage | undefined;
  funcs.set("_longjmp", system.jumps.longjmp);
  funcs.set(
    "dyld_stub_binder",
    lazyBinder(context, () => load),
  );
  const linked = linkGuest(context, { system, frameworks, funcs, words, calls });
  load = linked.load;
  runner.mainLoop = {
    dispatch: frameworks.dispatch,
    sounds: frameworks.sounds,
    queues: system.queues,
  };
  return {
    ...{ context, system, frameworks, calls, load },
    ...{ startup: linked.startup, unresolved: linked.unsupported.length },
  };
}

/** Installs the Objective-C metadata and reports the classes and selectors Retrove lacks. */
function installObjc(report: GuestReport, linked: Linked): void {
  const { diagnostic, signal } = linked.context.options,
    { objc } = linked.frameworks,
    { state } = report;
  signal?.throwIfAborted();
  report.milestone("Install Objective-C metadata", {
    initializers: linked.load.initializers.length,
    unresolvedImports: linked.unresolved,
  });
  objc.install(linked.context.image);
  const missing = objc.coverage();
  state.link = {
    ...state.link,
    unimplementedClasses: missing.classes.length,
    unimplementedSelectors: missing.selectors.length,
  };
  if (missing.classes.length || missing.selectors.length)
    diagnostic(
      "debug",
      "coverage",
      "Unimplemented classes and selectors",
      "Classes (" +
        missing.classes.length +
        "): " +
        missing.classes.join(", ") +
        "\n\nSelectors (" +
        missing.selectors.length +
        "):\n" +
        missing.selectors.join("\n"),
    );
}

/** Runs the initializers and the entry point, then the guest's exit handlers. */
async function execute(report: GuestReport, linked: Linked): Promise<GuestResult> {
  const { runner, cpu, options } = linked.context,
    { load, startup } = linked,
    { objc } = linked.frameworks,
    { state } = report;
  try {
    cpu.setReg(Register.Sp, runner.baseSP);
    report.milestone("Objective-C +load");
    await objc.start();
    for (const [i, pc] of load.initializers.entries()) {
      state.phase = "initializer " + (i + 1) + "/" + load.initializers.length + " at " + hex(pc);
      if (i % INITIALIZER_MILESTONE === 0) report.milestone(state.phase);
      await runner.call(pc, startup.args);
      state.completedInitializers++;
    }
    report.milestone("Application entry at " + hex(load.entry));
    const thread = load.entryKind === "thread";
    state.exitStatus = (await runner.call(load.entry, thread ? [] : startup.args, thread)) | 0;
  } catch (e) {
    if (!(e instanceof GuestExit)) throw e;
    state.exitStatus = e.status;
  }
  const { exitStatus } = state;
  report.milestone("Run exit handlers", { exitStatus });
  const { finalizers } = linked.system.sys;
  for (let fn = finalizers.pop(); fn; fn = finalizers.pop()) await runner.call(fn.pc, [fn.arg]);
  state.phase = "Guest exited";
  options.report(report.snapshot(true));
  options.diagnostic(
    exitStatus === 0 ? "info" : "error",
    "guest",
    "Guest exited with status " + exitStatus,
    { exitStatus, calls: state.calls },
  );
  return { exitStatus, calls: state.calls };
}

/** Reports the run's first fault; a fault at a deferred import's page names that import. */
function failure(options: ResolvedOptions, report: GuestReport, error: unknown): unknown {
  const { signal, diagnostic } = options;
  report.captureFault(error);
  const fault = report.state.firstFault;
  if (fault) {
    const message = signal?.aborted ? "Guest stopped" : fault.fault.message;
    diagnostic(signal?.aborted ? "info" : "error", "guest", message, {
      phase: fault.phase,
      pc: fault.registers["pc"],
      lr: fault.registers["lr"],
      threadId: fault.threadId,
      fault: fault.fault,
    });
    if (fault.fault.symbol)
      return new Error(message + " [" + fault.fault.symbol + "]", { cause: error });
  }
  return error;
}

async function release(state: RunState, resources: Resources): Promise<void> {
  const { al, objc, audio, threads, cpu } = state.parts;
  try {
    resources.closeGraphics?.();
    al?.close();
    objc?.close();
    resources.sounds?.close();
    resources.queues?.close();
    audio?.close();
    await resources.closeAudioFiles?.();
    await resources.closeFiles?.();
  } finally {
    try {
      threads?.close();
    } finally {
      cpu?.close();
    }
  }
}

/** Runs an iOS application's executable until it exits, faults or `signal` stops it. */
export async function runGuest(
  ipa: IpaArchive,
  runtimeOptions: RuntimeOptions = {},
): Promise<GuestResult> {
  const options = resolveOptions(runtimeOptions);
  const state = new RunState(),
    report = new GuestReport(state, options.report, options.diagnostic),
    resources: Resources = {};
  const stopHeartbeat = report.heartbeat();
  try {
    const executable = await openExecutable(ipa, options, report);
    const linked = await assemble(ipa, options, report, executable, resources);
    installObjc(report, linked);
    linked.context.runner.begin(linked.startup);
    const { cpu } = executable;
    if ("hostHandler" in cpu) cpu.hostHandler = linked.calls.hostInPlace;
    return await execute(report, linked);
  } catch (error) {
    throw failure(options, report, error);
  } finally {
    stopHeartbeat();
    await release(state, resources);
  }
}
