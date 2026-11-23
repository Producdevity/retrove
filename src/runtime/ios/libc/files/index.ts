import type { GuestMemory } from "../../../memory/guest-memory";
import { SaveStorage } from "../../../storage/save-storage";
import type { FileMetadata } from "../../foundation/file-attributes";
import type { GuestHeap, GuestImport } from "../guest-imports";
import { FIRST_FILE_DESCRIPTOR, Open } from "./constants";
import { closeDirectory, directoryImports } from "./directory-imports";
import { descriptorImports } from "./descriptor-imports";
import { FileError } from "./errno";
import { FileSystem } from "./file-system";
import { setMetadata } from "./namespace";
import { streamIoImports } from "./stream-io-imports";
import { streamLifecycleImports } from "./stream-imports";
import { installStandardStreams, writeBytes } from "./streams";
import { closeDescriptor } from "./transfer";
import type { BundleArchive, DescriptorDevice, DiagnosticSink, OpenFile } from "./types";

export type { BundleArchive, DescriptorDevice, DiagnosticSink, OpenFile } from "./types";

export interface DescriptorTable {
  get(fd: number): OpenFile | undefined;
  close(fd: number): Promise<number>;
  exists(fd: number): boolean;
  install(device: DescriptorDevice): number;
}
export interface FileServices {
  setMetadata(path: string, update: FileMetadata): Promise<number>;
  writeBytes(fd: number, bytes: Uint8Array): Promise<number>;
  descriptors: DescriptorTable;
  closeFiles(): Promise<void>;
}
export type FileImports = Record<string, GuestImport> & FileServices;

function hasServices(value: Record<string, GuestImport>): value is FileImports {
  return "closeFiles" in value;
}

function defaultStorage(ipa: BundleArchive): SaveStorage {
  const identifier = ipa.info?.CFBundleIdentifier;
  return new SaveStorage(
    typeof identifier === "string" && identifier ? identifier : ipa.bundlePath,
  );
}

function services(fs: FileSystem): FileServices {
  return {
    async setMetadata(path, update) {
      const pointer = fs.heap.string(path);
      try {
        await setMetadata(fs, pointer, update);
        return 0;
      } catch (error) {
        if (error instanceof FileError) return error.errno;
        throw error;
      } finally {
        fs.heap.free(pointer);
      }
    },
    writeBytes: (fd, bytes) => writeBytes(fs, fd, bytes),
    descriptors: {
      get: (fd) => fs.fds.get(fd),
      close: (fd) => closeDescriptor(fs, fd),
      exists: (fd) => fs.fds.has(fd) || (fd < FIRST_FILE_DESCRIPTOR && !fs.closedStandard.has(fd)),
      install: (device) => {
        const fd = fs.nextDescriptor++;
        fs.fds.set(fd, { device, mode: Open.ReadWrite, offset: 0, append: false });
        return fd;
      },
    },
    async closeFiles() {
      try {
        for (const fd of [...fs.fds.keys()]) if (fs.fds.has(fd)) await closeDescriptor(fs, fd);
      } finally {
        for (const handle of fs.directoryStreams.keys()) closeDirectory(fs, handle);
        await fs.storage.close();
      }
    },
  };
}

/** libc file and stdio imports over the bundle, the save storage and the guest descriptor table. */
export function fileImports(
  cpu: GuestMemory,
  ipa: BundleArchive,
  heap: GuestHeap,
  errno: number,
  log: (message: string) => void,
  storage: SaveStorage = defaultStorage(ipa),
  diagnostic?: DiagnosticSink,
  missingAsset?: (path: string) => void,
  data?: Map<string, number>,
): FileImports {
  const fs = new FileSystem(cpu, ipa, heap, errno, log, storage, diagnostic, missingAsset);
  if (data) installStandardStreams(fs, data);
  const funcs: Record<string, GuestImport> = {
    ...descriptorImports(fs),
    ...directoryImports(fs),
    ...streamLifecycleImports(fs),
    ...streamIoImports(fs),
  };
  for (const [name, value] of Object.entries(services(fs)))
    Object.defineProperty(funcs, name, { value });
  if (!hasServices(funcs)) throw new Error("File services were not installed.");
  return funcs;
}
