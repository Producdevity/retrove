import { expect, test } from "vite-plus/test";
import { writeArchiveFile } from "./file-writer";

function fixture(failAt?: "write" | "close" | "rename") {
  const files = new Map<string, Uint8Array>([["save", Uint8Array.of(9)]]);
  const temporary = "save.unique.tmp";
  const host = {
    unique: () => "unique",
    open: async (path: string, flags: number) => {
      expect(flags).toBe(0xa01);
      files.set(path, new Uint8Array());
      return 3;
    },
    write: async (_: number, bytes: Uint8Array) => {
      if (failAt === "write") return -1;
      const prior = files.get(temporary) ?? new Uint8Array(),
        result = new Uint8Array(prior.length + 1);
      result.set(prior);
      result.set(bytes.subarray(0, 1), prior.length);
      files.set(temporary, result);
      return 1;
    },
    close: async () => (failAt === "close" ? -1 : 0),
    rename: async (source: string, destination: string) => {
      if (failAt === "rename") return -1;
      const bytes = files.get(source);
      if (!bytes) throw Error("Missing temporary file");
      files.set(destination, bytes);
      files.delete(source);
      return 0;
    },
    remove: async (path: string) => {
      files.delete(path);
      return 0;
    },
  };
  return { host, files };
}
test("archive writes handle partial writes and install the complete file", async () => {
  const { host, files } = fixture();
  expect(await writeArchiveFile(host, "save", Uint8Array.of(1, 2, 3))).toBe(true);
  expect(files).toEqual(new Map([["save", Uint8Array.of(1, 2, 3)]]));
});
for (const phase of ["write", "close", "rename"] as const)
  test(`archive ${phase} failure preserves the previous save and removes temporary data`, async () => {
    const { host, files } = fixture(phase);
    expect(await writeArchiveFile(host, "save", Uint8Array.of(1, 2, 3))).toBe(false);
    expect(files).toEqual(new Map([["save", Uint8Array.of(9)]]));
  });
