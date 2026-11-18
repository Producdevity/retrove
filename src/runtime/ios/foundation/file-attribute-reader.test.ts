import { expect, test } from "vite-plus/test";
import { parseStat, statBytes } from "../libc/file-metadata";
import type { HostMethod } from "../objc/host";
import { fileAttributes, installFileAttributeReader } from "./file-attribute-reader";

const REGULAR_FILE = 0o100644;
const NO_SUCH_FILE = 2;

test("a stat result becomes NSFileManager's attribute dictionary", () => {
  const stat = parseStat(
    statBytes({ device: 1, inode: 7, mode: REGULAR_FILE, size: 4096, modified: 1_500_000_000_250 }),
  );
  expect(fileAttributes(stat)).toEqual({
    NSFileType: "NSFileTypeRegular",
    NSFileSize: 4096,
    NSFileModificationDate: new Date(1_500_000_000_250),
    NSFileCreationDate: new Date(1_500_000_000_250),
    NSFilePosixPermissions: 0o644,
    NSFileReferenceCount: 1,
    NSFileSystemNumber: 1,
    NSFileSystemFileNumber: 7n,
  });
});

test("a missing file returns nil and an NSPOSIXErrorDomain error", async () => {
  const methods = new Map<string, HostMethod>();
  const written = new Map<number, number>();
  const errors: [number, string][] = [];
  installFileAttributeReader({
    method: (_class, _static, selector, method) => methods.set(selector, method),
    text: () => "/Documents/missing",
    write: (pointer, value) => void written.set(pointer, value),
    stat: () => Promise.resolve(NO_SUCH_FILE),
    property: () => 1,
    error: (code, domain) => (errors.push([code, domain]), 77),
    send: () => Promise.resolve(0),
  });
  const attributes = methods.get("attributesOfItemAtPath:error:");
  expect(await attributes?.(0, (index) => [5, 99][index] ?? 0)).toBe(0);
  expect(errors).toEqual([[NO_SUCH_FILE, "NSPOSIXErrorDomain"]]);
  expect(written.get(99)).toBe(77);
});
