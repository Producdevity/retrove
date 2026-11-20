import { expect, test } from "vite-plus/test";
import { sha256 } from "./digest";
import { stateLayout } from "./layout";
import { translate } from "./translate";

const Code = 0x8000;
const SharedImportBytes = 3;
/** ARM: arithmetic and loads/stores (0x8000), then an LDREX/STREX increment with DMB (0x8020). */
const arm = [
  0xe0800001, 0xe5820000, 0xe5923004, 0xe3500000, 0x03a00001, 0xe1d210b2, 0xe5c21009, 0xe12fff1e,
  0xe1912f9f, 0xe0822000, 0xe1813f92, 0xe3530000, 0x1afffffa, 0xf57ff05b, 0xe1a00002, 0xe12fff1e,
];
/** Thumb: the same two functions, with an IT block and an immediate-offset LDREX/STREX. */
const thumb = [
  0x60101840, 0x3004f8d2, 0xbf082800, 0x47702001, 0x2f01e851, 0xe8414402, 0x2b002301, 0xf3bfd1f8,
  0x46108f5b, 0x00004770,
];
const layout = stateLayout(
  0x1000,
  { arena: 0x10000, mask: 0x3fff_ffff },
  { base: 0x410000, start: Code, end: Code + 0x100 },
);
function emit(words: readonly number[], start: number, end: number, shared?: boolean) {
  const view = new DataView(new ArrayBuffer(4 * words.length));
  words.forEach((word, k) => view.setUint32(4 * k, word, true));
  return translate({
    functions: [{ start, end }],
    readWord: (address) =>
      address >= Code && address + 4 <= Code + view.byteLength
        ? view.getUint32(address - Code, true)
        : undefined,
    isCode: (address) => address >= Code && address < Code + view.byteLength,
    entries: [],
    stopPC: 1,
    layout,
    labelAddress: () => 0,
    ...(shared === undefined ? {} : { shared }),
  }).wasm;
}
/**
 * Sizes and SHA-256 of unshared modules, pinned at module format 4 (the single-threaded translator's
 * output plus the `env.host` import and its dispatcher check).
 */
const Before = [
  [
    "arm plain",
    arm,
    Code,
    Code + 32,
    1137,
    "3b950eca01c875685e3a188fd846a90e9ff3afb49b4a245e09d49b2698030efe",
  ],
  [
    "arm exclusive",
    arm,
    Code + 32,
    Code + 64,
    1072,
    "e40cc6e417bc4b733a235c12ed5d6e7e5c0e73bbb30514c38e3db9ef5a12d77b",
  ],
  [
    "thumb plain",
    thumb,
    Code | 1,
    Code + 16,
    1121,
    "bb4f0272328ae56cab76159826f33abeb0d68fedb3502b25082490064732c624",
  ],
  [
    "thumb exclusive",
    thumb,
    (Code + 16) | 1,
    Code + 38,
    1072,
    "1234af8ad05381ec39dd4c75f8415ad990b1646348225a2f863b7038d0ec80de",
  ],
] as const;

test.each(Before)(
  "unshared %s modules keep their pinned bytes",
  async (_, words, start, end, bytes, digest) => {
    for (const shared of [undefined, false]) {
      const wasm = emit(words, start, end, shared);
      expect([wasm.length, await sha256(wasm)]).toEqual([bytes, digest]);
    }
  },
);
test("shared modules differ only where exclusives and barriers need atomics", async () => {
  const [plain, exclusive] = Before;
  const unchanged = emit(plain[1], plain[2], plain[3], true);
  const atomic = emit(exclusive[1], exclusive[2], exclusive[3], true);
  // The shared memory import only adds its maximum, 65536 pages as a 3-byte LEB128.
  expect(unchanged.length).toBe(plain[4] + SharedImportBytes);
  expect(atomic.length).toBeGreaterThan(exclusive[4] + SharedImportBytes);
  expect(await sha256(atomic)).not.toBe(exclusive[5]);
});
