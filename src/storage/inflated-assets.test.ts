import { describe, expect, it } from "vite-plus/test";
import { InflatedAssets, inflatedAssetName, type AssetDirectory } from "./inflated-assets";

const KEY = "0b1d2f3a-4c5d-4e6f-8a7b-9c0d1e2f3a4b";
const notFound = () => new DOMException("missing", "NotFoundError");

/** A minimal origin private file system: directories of committed files. */
function fakeStorage(options: { quota?: number } = {}) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let writes = 0;
  const directory = (prefix: string): AssetDirectory => ({
    getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
    getFileHandle: async (name: string, open?: { create?: boolean }) => {
      const path = prefix + name;
      if (!files.has(path) && !open?.create) throw notFound();
      if (!files.has(path)) files.set(path, new Uint8Array());
      return {
        getFile: async () => new File([files.get(path) ?? new Uint8Array()], name),
        createWritable: async () => {
          writes++;
          const chunks: Uint8Array[] = [];
          return new WritableStream<Uint8Array>({
            write(chunk) {
              chunks.push(chunk);
              if (chunks.reduce((sum, item) => sum + item.length, 0) > (options.quota ?? Infinity))
                throw new DOMException("full", "QuotaExceededError");
            },
            close() {
              files.set(path, new Uint8Array(chunks.flatMap((chunk) => [...chunk])));
            },
          });
        },
      };
    },
    removeEntry: async (name: string) => {
      if (!files.delete(prefix + name)) throw notFound();
    },
  });
  return {
    storage: { getDirectory: async () => directory("") },
    files,
    writes: () => writes,
  };
}
const entry = { path: "Payload/Game.app/Level.pkg", size: 4, crc: 0x1234 };
const contents = () =>
  Promise.resolve(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    }),
  );

describe("inflated assets", () => {
  it("only applies to archives stored under their key", () => {
    const { storage } = fakeStorage();
    expect(InflatedAssets.for(new File([], KEY), storage)).toBeDefined();
    expect(InflatedAssets.for(new File([], "Game.ipa"), storage)).toBeUndefined();
    expect(InflatedAssets.for(new Blob([]), storage)).toBeUndefined();
    expect(InflatedAssets.for(new File([], KEY), undefined)).toBeUndefined();
  });
  it("inflates once beside the archive and reuses the stored copy", async () => {
    const fake = fakeStorage();
    const assets = InflatedAssets.for(new File([], KEY), fake.storage);
    const [first, second] = await Promise.all([
      assets?.blob(entry, contents),
      assets?.blob(entry, contents),
    ]);
    expect(new Uint8Array(await (first ?? new Blob()).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(second?.size).toBe(4);
    const again = InflatedAssets.for(new File([], KEY), fake.storage);
    expect((await again?.blob(entry, contents))?.size).toBe(4);
    expect(fake.writes()).toBe(1);
    expect([...fake.files.keys()]).toEqual([
      `retrove-archives/${KEY}.assets/${inflatedAssetName(entry)}`,
    ]);
  });
  it("falls back when storage is full and removes the partial copy", async () => {
    const fake = fakeStorage({ quota: 2 });
    const assets = InflatedAssets.for(new File([], KEY), fake.storage);
    expect(await assets?.blob(entry, contents)).toBeUndefined();
    expect(fake.files.size).toBe(0);
  });
});
