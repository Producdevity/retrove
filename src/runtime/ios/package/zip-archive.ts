import { readDirectory, type CentralEntry } from "./zip-directory";
import { assetReader } from "./zip-assets";
import { payloadReaders } from "./zip-payload";
import type { Diagnostic, ZipArchive, ZipEntry } from "./zip-types";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function indexEntries(found: readonly CentralEntry[]): {
  entries: Map<string, ZipEntry>;
  directories: Set<string>;
} {
  const entries = new Map<string, ZipEntry>(),
    directories = new Set<string>();
  for (const { rawPath: raw, ...fields } of found) {
    const rawPath = utf8.decode(raw);
    const isDir = rawPath.endsWith("/");
    const path = isDir ? rawPath.slice(0, -1) : rawPath;
    const entry: ZipEntry = {
      path,
      modified: fields.modified,
      flags: fields.flags,
      method: fields.method,
      crc: fields.crc,
      compressedSize: fields.compressedSize,
      size: fields.size,
      offset: fields.offset,
    };
    if (
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw Error(`Unsafe ZIP path: ${path}`);
    }
    if (entries.has(path) || (!isDir && directories.has(path))) {
      throw Error(`Duplicate ZIP path: ${path}`);
    }
    if (isDir) {
      directories.add(path);
      continue;
    }
    entries.set(path, Object.freeze(entry));
  }
  return { entries, directories };
}

export async function openZip(blob: Blob, diagnostic?: Diagnostic): Promise<ZipArchive> {
  const { directory, found } = await readDirectory(blob, diagnostic);
  const { entries, directories } = indexEntries(found);
  const readers = payloadReaders(blob, entries, directory);
  return {
    entries,
    directories,
    has: (path) => entries.has(path),
    compressedBlob: readers.compressedBlob,
    assetBlob: assetReader(blob, readers, diagnostic),
    stream: readers.stream,
    read: readers.read,
  };
}
