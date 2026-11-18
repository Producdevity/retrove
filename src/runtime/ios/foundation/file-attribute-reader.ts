import type { FileStat } from "../libc/file-metadata";
import { Argument, type FoundationHost, type HostResult } from "../objc/host";

const FileType = {
  Mask: 0o170000,
  Directory: 0o040000,
  Regular: 0o100000,
  Link: 0o120000,
} as const;
const PERMISSION_BITS = 0o7777;
const ERROR_DOMAIN = "NSPOSIXErrorDomain";
const TYPE_NAMES = new Map<number, string>([
  [FileType.Directory, "NSFileTypeDirectory"],
  [FileType.Regular, "NSFileTypeRegular"],
  [FileType.Link, "NSFileTypeSymbolicLink"],
]);

interface ReaderHost extends Pick<FoundationHost, "method" | "text" | "write"> {
  /** The file's status, or the errno from stat(2). */
  stat(path: string): Promise<Required<FileStat> | number>;
  property(value: unknown): number;
  error(code: number, domain: string): number;
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
}

/** The NSFileManager attribute dictionary for a stat(2) result. */
export function fileAttributes(stat: Required<FileStat>): Record<string, unknown> {
  return {
    NSFileType: TYPE_NAMES.get(stat.mode & FileType.Mask) ?? "NSFileTypeUnknown",
    NSFileSize: stat.size,
    NSFileModificationDate: new Date(stat.modified),
    NSFileCreationDate: new Date(stat.created),
    NSFilePosixPermissions: stat.mode & PERMISSION_BITS,
    NSFileReferenceCount: stat.links,
    NSFileSystemNumber: stat.device,
    NSFileSystemFileNumber: stat.inode,
  };
}

export function installFileAttributeReader(host: ReaderHost): void {
  const read = async (path: number, errorOutput: number) => {
    const stat = await host.stat(host.text(path));
    if (typeof stat !== "number") return host.property(fileAttributes(stat));
    if (errorOutput) host.write(errorOutput, host.error(stat, ERROR_DOMAIN));
    return 0;
  };
  host.method("NSFileManager", false, "attributesOfItemAtPath:error:", (_, args) =>
    read(args(Argument.First), args(Argument.Second)),
  );
  host.method("NSFileManager", false, "fileAttributesAtPath:traverseLink:", (_, args) =>
    read(args(Argument.First), 0),
  );
  const field = (selector: string, key: string, unbox: string) =>
    host.method("NSDictionary", false, selector, async (self) => {
      const value = await host.send(self, "objectForKey:", [host.property(key)]);
      return typeof value === "number" && value ? host.send(value, unbox) : 0;
    });
  field("fileSize", "NSFileSize", "unsignedLongLongValue");
  field("fileModificationDate", "NSFileModificationDate", "self");
  field("fileCreationDate", "NSFileCreationDate", "self");
  field("fileType", "NSFileType", "self");
  field("filePosixPermissions", "NSFilePosixPermissions", "unsignedLongValue");
}
