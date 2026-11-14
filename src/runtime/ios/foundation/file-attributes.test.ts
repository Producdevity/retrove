import { expect, test, vi } from "vite-plus/test";
import { doubleBits } from "../abi/scalars";
import type { HostMethod } from "../objc/host";
import { installFileAttributes, type FileMetadata } from "./file-attributes";
function fixture() {
  const methods = new Map<string, HostMethod>();
  const entries = new Map<number, ReadonlyArray<readonly [number, number]>>();
  const strings = new Map([
    [1, "NSFileModificationDate"],
    [2, "NSFilePosixPermissions"],
    [3, "NSFileCreationDate"],
    [4, "NSFileUnsupported"],
    [10, "/Documents/theme.dat"],
  ]);
  const written = new Map<number, number>();
  const setMetadata = vi.fn((_path: string, _metadata: FileMetadata) => Promise.resolve(0));
  const error = vi.fn((code: number, _domain: string) => code);
  installFileAttributes({
    method: (_class, _static, selector, method) => methods.set(selector, method),
    text: (pointer) => strings.get(pointer) ?? "",
    write: (pointer, value) => {
      written.set(pointer, value);
    },
    entries: (pointer) => entries.get(pointer) ?? [],
    isKind: (pointer, type) =>
      type === "NSDictionary"
        ? entries.has(pointer)
        : type === "NSNumber"
          ? pointer === 22
          : type === "NSDate" && (pointer === 21 || pointer === 23),
    send: (pointer) =>
      Promise.resolve(
        pointer === 21 ? doubleBits(315532800.125) : pointer === 23 ? doubleBits(-0.5) : 0o640,
      ),
    setMetadata,
    error,
  });
  return {
    entries,
    setMetadata,
    error,
    written,
    async set(pointer: number, errorPointer = 99) {
      const method = methods.get("setAttributes:ofItemAtPath:error:");
      if (!method) throw new Error("File attributes method was not installed.");
      return method(0, (index) => [pointer, 10, errorPointer][index] ?? 0);
    },
  };
}
test("file dates and permissions are decoded before one metadata update, preserving a successful error pointer", async () => {
  const x = fixture();
  x.entries.set(30, [
    [1, 21],
    [2, 22],
    [3, 23],
  ]);
  x.written.set(99, 123);
  expect(await x.set(30)).toBe(1);
  expect(x.setMetadata).toHaveBeenCalledWith("/Documents/theme.dat", {
    modified: 315532800125,
    created: -500,
    permissions: 0o640,
  });
  expect(x.written.get(99)).toBe(123);
});
test("invalid and unsupported attributes fail without changing the file", async () => {
  const x = fixture();
  x.entries.set(30, [
    [1, 21],
    [4, 22],
  ]);
  expect(await x.set(30)).toBe(0);
  expect(x.error).toHaveBeenLastCalledWith(45, "NSPOSIXErrorDomain");
  x.entries.set(30, [[1, 22]]);
  expect(await x.set(30)).toBe(0);
  expect(x.written.get(99)).toBe(22);
  expect(x.setMetadata).not.toHaveBeenCalled();
});
test("filesystem failures are returned as NSError and nil error outputs are safe", async () => {
  const x = fixture();
  x.entries.set(30, []);
  x.setMetadata.mockResolvedValue(30);
  expect(await x.set(30)).toBe(0);
  expect(x.error).toHaveBeenCalledWith(30, "NSPOSIXErrorDomain");
  x.error.mockClear();
  expect(await x.set(30, 0)).toBe(0);
  expect(x.error).not.toHaveBeenCalled();
});
