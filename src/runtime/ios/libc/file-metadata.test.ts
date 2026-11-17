import { expect, test } from "vite-plus/test";
import { direntBytes, statBytes, virtualInode } from "./file-metadata";

test("stat records use the ARMv7 Darwin layout", () => {
  const view = new DataView(
    statBytes({ device: 1, inode: 7n, mode: 0o100644, size: 1025, modified: 1500, created: 250 })
      .buffer,
  );
  expect(view.getUint16(4, true)).toBe(0o100644);
  expect(view.getBigUint64(8, true)).toBe(7n);
  expect([view.getInt32(36, true), view.getUint32(40, true)]).toEqual([1, 500_000_000]);
  expect(view.getInt32(52, true)).toBe(0);
  expect(view.getBigInt64(60, true)).toBe(1025n);
  expect(view.getBigInt64(68, true)).toBe(3n);
});

test("directory records are 4-byte aligned and reject long names", () => {
  const record = direntBytes({ name: "save", dir: false, inode: 9 }, 2);
  expect(record?.length).toBe(28);
  expect(record?.[20]).toBe(8);
  expect(direntBytes({ name: "x".repeat(1024), dir: true, inode: 1 }, 0)).toBeNull();
});

test("virtual inodes are stable and marked", () => {
  expect(virtualInode("/a")).toBe(virtualInode("/a"));
  expect(virtualInode("/a") >> 63n).toBe(1n);
});
