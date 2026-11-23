import { Gauge, gauges } from "../../../diagnostics/gauges";
import { readString, write32, type GuestMemory } from "../../../memory/guest-memory";
import { BundleBlocks } from "../../../storage/bundle-blocks";
import type { SaveStorage } from "../../../storage/save-storage";
import type { SaveStores } from "../../../storage/stores";
import type { GuestHeap, GuestImport } from "../guest-imports";
import { buildBundleIndex, type BundleDirectories } from "./bundle-index";
import {
  FIRST_FILE_DESCRIPTOR,
  LOOKUP_PATH_LIMIT,
  LOOKUP_SAMPLE_LIMIT,
  SAVE_ROOTS,
} from "./constants";
import { Errno, FileError, raise } from "./errno";
import { parentPath, resolvePath } from "./paths";
import type {
  BundleArchive,
  DiagnosticSink,
  DirectoryStream,
  GuestStream,
  LargeAsset,
  Located,
  OpenFile,
} from "./types";

export type FileHandler = GuestImport;

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "QuotaExceededError"
  );
}

/** The descriptor tables, working directory and save storage shared by every libc file call. */
export class FileSystem {
  readonly fds = new Map<number, OpenFile>();
  readonly streams = new Map<number, GuestStream>();
  readonly directoryStreams = new Map<number, DirectoryStream>();
  readonly largeAssets = new Map<string, LargeAsset>();
  readonly closedStandard = new Set<number>();
  readonly blocks = new BundleBlocks((delta) => gauges.add(Gauge.FileCacheBytes, delta));
  readonly bundleDirectory: string;
  currentDirectory: string;
  nextDescriptor = FIRST_FILE_DESCRIPTOR;
  temporaryName = 0;
  #bundleDirectories: BundleDirectories | undefined;
  readonly #seenLookups = new Set<string>();

  constructor(
    readonly cpu: GuestMemory,
    readonly ipa: BundleArchive,
    readonly heap: GuestHeap,
    readonly errno: number,
    readonly log: (message: string) => void,
    readonly storage: SaveStorage,
    readonly diagnostic: DiagnosticSink | undefined,
    readonly missingAsset: ((path: string) => void) | undefined,
  ) {
    this.bundleDirectory = `/${ipa.bundlePath}`;
    this.currentDirectory = this.bundleDirectory;
  }

  setErrno(code: number): void {
    write32(this.cpu, this.errno, code);
  }

  fail(code: number, result: number | bigint = -1): number | bigint {
    this.setErrno(code);
    return result;
  }

  async run<Result>(
    mode: IDBTransactionMode,
    action: (stores: SaveStores) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.storage.run(mode, action);
    } catch (error) {
      if (error instanceof FileError) throw error;
      if (isQuotaError(error)) raise(Errno.NoSpace);
      this.log(`Save storage error: ${errorMessage(error)}`);
      return raise(Errno.Io);
    }
  }

  private recordLookup(operation: string, address: number, code: number): void {
    if (this.#seenLookups.size >= LOOKUP_SAMPLE_LIMIT) return;
    let path: string;
    try {
      path = readString(this.cpu, address).slice(0, LOOKUP_PATH_LIMIT);
    } catch {
      path = "<unreadable path>";
    }
    const key = `${operation}:${code}:${path}`;
    if (this.#seenLookups.has(key)) return;
    this.#seenLookups.add(key);
    this.diagnostic?.("warn", "files", "Guest file lookup failed", {
      operation,
      path,
      errno: code,
    });
    if (this.#seenLookups.size === LOOKUP_SAMPLE_LIMIT)
      this.diagnostic?.(
        "info",
        "files",
        `Reached the ${LOOKUP_SAMPLE_LIMIT} distinct lookup failure sample limit`,
      );
  }

  /** Runs a guest call, turning file errors into errno and the fallback result. */
  checked(fn: FileHandler, fallback: number | bigint = -1, operation?: string): GuestImport {
    return async (a) => {
      try {
        return await fn(a);
      } catch (error) {
        if (!(error instanceof FileError)) throw error;
        if (this.diagnostic && operation) this.recordLookup(operation, a(0), error.errno);
        return this.fail(error.errno, fallback);
      }
    };
  }

  locate(address: number): Located {
    return resolvePath(
      readString(this.cpu, address),
      this.ipa,
      this.currentDirectory,
      this.bundleDirectory,
    );
  }

  writable(address: number): string {
    const located = this.locate(address);
    if (located.home === undefined) raise(Errno.ReadOnly);
    if (!located.home || SAVE_ROOTS.has(located.home)) raise(Errno.Perm);
    return located.home;
  }

  async requireParent(paths: SaveStores["paths"], path: string): Promise<void> {
    const item = await paths.get(parentPath(path));
    if (!item) raise(Errno.NoEntry);
    if (!item.dir) raise(Errno.NotDirectory);
  }

  bundleIndex(): BundleDirectories {
    this.#bundleDirectories ??= buildBundleIndex(this.ipa);
    return this.#bundleDirectories;
  }

  bundleIsDir(path: string): boolean {
    return this.bundleIndex().has(path);
  }

  missingBundlePath(path: string): never {
    this.missingAsset?.(path);
    return raise(Errno.NoEntry);
  }

  fdFor(fd: number): OpenFile {
    return this.fds.get(fd) ?? raise(Errno.BadDescriptor);
  }

  streamFor(pointer: number): GuestStream {
    return this.streams.get(pointer) ?? raise(Errno.BadDescriptor);
  }

  isStandard(fd: number): boolean {
    return fd < FIRST_FILE_DESCRIPTOR && !this.fds.has(fd) && !this.closedStandard.has(fd);
  }
}
