import { parsePlist } from "../../formats/plist/index";
import { parseStat, STAT_BYTES } from "../libc/file-metadata";
import { writeArchiveFile } from "./archives/file-writer";
import { installDirectoryEnumerator } from "./directory-enumerator";
import { ERROR_INSTANCE_BYTES, installErrors } from "./errors";
import { installFileAttributeReader } from "./file-attribute-reader";
import { installFileAttributes } from "./file-attributes";
import { installDataURLReaders } from "./file-url-readers";
import { archiveWriter, installDataReads, installDataWrites } from "./files/data-files";
import { HostFiles } from "./files/host-files";
import { installDirectoryMethods } from "./files/manager-directories";
import { installItemMethods } from "./files/manager-items";
import { installPathMethods } from "./files/manager-paths";
import type { FileManagerHost, FileObjects } from "./files/types";
import { installPropertyListSerialization } from "./property-list-serialization";
import { installDictionaryFiles } from "./property-lists";
import {
  installInferredStringFiles,
  installStringFiles,
  installStringWrites,
} from "./string-files";
import { installUrlResources } from "./url-resources";

export type { FileManagerHost, FileObjects } from "./files/types";
const DATA_POINTER_OFFSET = 4;
const DATA_LENGTH_OFFSET = 8;

function installFileManager(files: HostFiles): void {
  const { host } = files;
  host.hostClass("NSFileManager", "NSObject");
  host.hostClass("NSError", "NSObject", ERROR_INSTANCE_BYTES);
  installErrors({
    ...host,
    send: (self, selector, args) => files.sendNumber(self, selector, args),
    dictionary: () => host.property({}),
  });
  host.method(
    "NSFileManager",
    true,
    "defaultManager",
    () => (files.manager ??= host.alloc(files.className("NSFileManager"))),
  );
}

function installAttributes(files: HostFiles): void {
  const { host } = files;
  const { cpu, heap } = host;
  installFileAttributes({
    ...host,
    error: files.makeError,
    setMetadata: (path, update) => host.sys.setMetadata(path, update),
  });
  installFileAttributeReader({
    ...host,
    error: files.makeError,
    stat: async (path) => {
      const scratch = heap.zero(STAT_BYTES),
        pointer = heap.string(path);
      try {
        return (await files.invoke("_stat", pointer, scratch)) === 0
          ? parseStat(cpu.read(scratch, STAT_BYTES))
          : files.errno();
      } finally {
        heap.free(pointer);
        heap.free(scratch);
      }
    },
  });
  installUrlResources({
    ...host,
    stat: async (path) => ((await files.stat(host.utf8(path), 0)) ? 0 : files.errno()),
    error: files.makeError,
  });
}

function installFileReaders(files: HostFiles): FileObjects["contents"] {
  const { host } = files;
  const { cpu, heap } = host;
  const writer = archiveWriter(files);
  const contents = (path: number): Promise<Uint8Array | undefined> => files.contents(path);
  const stringFiles = {
    ...host,
    contents,
    errno: () => files.errno(),
    decode: host.decodeText,
    initialize: (pointer: number, value: string) => host.makeString(value, pointer),
    error: files.makeError,
    writeFile: (path: string, bytes: Uint8Array) => writeArchiveFile(writer, path, bytes),
  };
  for (const install of [installStringFiles, installInferredStringFiles, installStringWrites])
    install(stringFiles);
  installDataURLReaders({
    ...stringFiles,
    initialize: (pointer, bytes) => {
      const block = heap.alloc(Math.max(1, bytes.length));
      try {
        cpu.write(block, bytes);
        return host.dataFrom(block, bytes.length, pointer);
      } finally {
        heap.free(block);
      }
    },
  });
  installPropertyListSerialization({
    ...host,
    error: files.makeError,
    parse: parsePlist,
    bytes: (pointer) => {
      if (!host.isKind(pointer, "NSData")) throw new Error("Expected NSData property list");
      return cpu.read(
        host.read(pointer + DATA_POINTER_OFFSET),
        host.read(pointer + DATA_LENGTH_OFFSET),
      );
    },
  });
  installDictionaryFiles({
    ...host,
    contents,
    parse: parsePlist,
    send: (self, selector, args) => files.sendNumber(self, selector, args),
  });
  installDataReads(files);
  return contents;
}

/** NSFileManager and libc share one filesystem, including current directory and saves. */
export function fileManager(host: FileManagerHost): FileObjects {
  const files = new HostFiles(host);
  installFileManager(files);
  installAttributes(files);
  installPathMethods(files);
  installDirectoryMethods(files);
  installDirectoryEnumerator({
    ...host,
    list: (path) => files.listDirectory(path),
    classNamed: (name) => files.className(name),
  });
  const contents = installFileReaders(files);
  installItemMethods(files);
  const writer = archiveWriter(files);
  installDataWrites(files, writer);
  return {
    contents,
    error: files.makeError,
    writeArchive: (path, bytes) => writeArchiveFile(writer, host.text(path), bytes),
  };
}
