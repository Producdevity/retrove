import { defaultRuneLocale, stringImports } from "./strings";
import { formatImports } from "./format-imports";
import { write32, type GuestMemory, type Heap } from "../../memory/guest-memory";
import type { BacktraceImage } from "./backtrace";
import { backtraceImports } from "./backtrace";
import { calendarImports } from "./calendar";
import { darwinAlgorithms } from "./darwin-algorithms";
import { TASK, darwinSystem } from "./darwin-system";
import { fileImports, type FileImports } from "./files";
import type { BundleArchive, DiagnosticSink } from "./files/types";
import type { ScanFiles } from "./scan";
import { guestZlibStreams, type HostGate } from "./guest-zlib";
import { LoopbackSocket } from "./loopback-network";
import { networkImports, type DescriptorTable } from "./network";
import { scanImports } from "./scan";
import { virtualMemoryImports } from "./vm";
import { allocationImports, byteImports, stringBlockImports } from "./system/memory-imports";
import { errorImports } from "./system/error-imports";
import { localeImports } from "./system/locale-imports";
import { atomicImports, lifecycleImports, signalImports } from "./system/process-imports";
import { timeImports } from "./system/time-imports";
import type { CallGuest, Finalizer, SystemCpu, SystemImport } from "./system/types";
import type { GuestArguments } from "../objc/host";
import type { GuestImport } from "./guest-imports";

export type { CallGuest, Finalizer, SystemCpu, SystemImport } from "./system/types";

const STACK_GUARD_MASK = 0xffffff00;

export interface SystemImports {
  readonly data: Map<string, number>;
  readonly funcs: Record<string, SystemImport>;
  readonly finalizers: Finalizer[];
  readonly setMetadata: FileImports["setMetadata"];
  readonly closeFiles: FileImports["closeFiles"];
}

function guestWord(
  cpu: GuestMemory,
  heap: Heap,
  data: Map<string, number>,
  name: string,
  value: number,
): number {
  const pointer = heap.zero(Uint32Array.BYTES_PER_ELEMENT);
  write32(cpu, pointer, value);
  data.set(name, pointer);
  return pointer;
}

function socketTable(files: FileImports): DescriptorTable {
  return {
    get(fd) {
      const file = files.descriptors.get(fd);
      if (!file) return undefined;
      return {
        ...(file.device instanceof LoopbackSocket ? { device: file.device } : {}),
        ...(file.nonblocking === undefined ? {} : { nonblocking: file.nonblocking }),
      };
    },
    exists: (fd) => files.descriptors.exists(fd),
    install: (device) => files.descriptors.install(device),
    close: (fd) => files.descriptors.close(fd),
  };
}

function scanFiles(files: FileImports): ScanFiles {
  const call = async (name: string, a: GuestArguments): Promise<unknown> => files[name]?.(a);
  const count = async (name: string, a: GuestArguments): Promise<number> => {
    const value = await call(name, a);
    if (typeof value !== "number") throw new Error(`Guest ${name} returned no count`);
    return value;
  };
  return {
    _ftell: (a) => count("_ftell", a),
    _fread: (a) => count("_fread", a),
    _fseek: (a) => call("_fseek", a),
  };
}

function executableName(ipa: BundleArchive): string | undefined {
  const name = ipa.info?.CFBundleExecutable;
  return typeof name === "string" ? name : undefined;
}

/** The libSystem C runtime imports one guest app resolves against. */
export function systemImports(
  cpu: SystemCpu,
  heap: Heap,
  ipa: BundleArchive,
  log: (message: string) => void,
  threadID: () => number = () => 1,
  diagnostic: DiagnosticSink | undefined,
  missingAsset: ((path: string) => void) | undefined,
  hostGate: HostGate,
  callGuest: CallGuest,
  image?: BacktraceImage,
): SystemImports {
  const data = new Map<string, number>();
  const errno = heap.zero(Uint32Array.BYTES_PER_ELEMENT);
  const guard = crypto.getRandomValues(new Uint32Array(1));
  guestWord(cpu, heap, data, "___stack_chk_guard", (guard[0] ?? 0) & STACK_GUARD_MASK);
  guestWord(cpu, heap, data, "_mach_task_self_", TASK);
  data.set("__DefaultRuneLocale", defaultRuneLocale(cpu, heap));
  const locale = localeImports(cpu, heap);
  const files = fileImports(cpu, ipa, heap, errno, log, undefined, diagnostic, missingAsset, data);
  const finalizers: Finalizer[] = [];
  const ownFiles: Record<string, GuestImport> = files;
  const formatFiles = {
    writeBytes: (fd: number, bytes: Uint8Array) => files.writeBytes(fd, bytes),
    _fwrite: async (a: GuestArguments): Promise<number> => {
      const written = await ownFiles._fwrite?.(a);
      if (typeof written !== "number") throw new Error("Guest fwrite returned a non-number");
      return written;
    },
  };
  const funcs: Record<string, SystemImport> = {
    ...virtualMemoryImports(cpu, errno),
    ...darwinSystem(cpu, heap, errno),
    ...darwinAlgorithms(cpu, callGuest),
    ...scanImports(cpu, heap, scanFiles(files)),
    ...backtraceImports(cpu, heap, errno, image, executableName(ipa)),
    ...networkImports(cpu, heap, errno, socketTable(files)),
    ...calendarImports(cpu, heap, errno, threadID),
    ...allocationImports(cpu, heap),
    ...errorImports(cpu, heap, errno, files),
    ...byteImports(cpu),
    ...stringImports(cpu, errno),
    ...guestZlibStreams(cpu, heap, hostGate),
    ...stringBlockImports(cpu, heap),
    ...signalImports(cpu, errno, callGuest),
    ...locale,
    ...atomicImports(cpu),
    ...timeImports(cpu),
    ...lifecycleImports(threadID, finalizers, cpu),
    ...formatImports(cpu, heap, errno, formatFiles, log),
    ...ownFiles,
  };
  const copy = funcs._memcpy;
  const checkedCopy = funcs.___memcpy_chk;
  if (copy) funcs._memmove = copy;
  if (checkedCopy) funcs.___memmove_chk = checkedCopy;
  return {
    data,
    funcs,
    finalizers,
    setMetadata: (...args) => files.setMetadata(...args),
    closeFiles: () => files.closeFiles(),
  };
}
