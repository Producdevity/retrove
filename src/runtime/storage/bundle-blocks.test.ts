import { expect, test } from "vite-plus/test";
import { BundleBlocks, type BlockSource } from "./bundle-blocks";

const BLOCK = 16;
const source = (size: number) => {
  const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251),
    reads: [number, number][] = [];
  const blob: BlockSource = {
    size,
    slice: (start, end) => {
      reads.push([start, end]);
      return { arrayBuffer: async () => bytes.slice(start, end).buffer };
    },
  };
  return { bytes, reads, blob };
};
const collect = async (blocks: BundleBlocks, blob: BlockSource, offset: number, count: number) => {
  const out = new Uint8Array(count);
  const read = await blocks.read("pkg", blob, offset, count, (done, bytes) => out.set(bytes, done));
  return out.subarray(0, read);
};

test("scattered reads come from cached aligned blocks", async () => {
  const { bytes, reads, blob } = source(BLOCK * 8),
    blocks = new BundleBlocks(() => {}, BLOCK * 8, BLOCK);
  expect(await collect(blocks, blob, 5, 4)).toEqual(bytes.subarray(5, 9));
  expect(await collect(blocks, blob, 40, 4)).toEqual(bytes.subarray(40, 44));
  expect(await collect(blocks, blob, 9, 10)).toEqual(bytes.subarray(9, 19));
  expect(await collect(blocks, blob, 1, 2)).toEqual(bytes.subarray(1, 3));
  expect(reads).toEqual([
    [0, BLOCK],
    [BLOCK * 2, BLOCK * 3],
    [BLOCK, BLOCK * 2],
  ]);
});

test("reads stop at the end of the source", async () => {
  const { bytes, blob } = source(BLOCK + 3),
    blocks = new BundleBlocks(() => {}, BLOCK * 4, BLOCK);
  expect(await collect(blocks, blob, BLOCK - 2, 10)).toEqual(bytes.subarray(BLOCK - 2));
  expect(await collect(blocks, blob, BLOCK + 5, 4)).toHaveLength(0);
});

test("the least recently used blocks leave once the budget is full", async () => {
  const { reads, blob } = source(BLOCK * 8),
    tracked: number[] = [],
    blocks = new BundleBlocks((delta) => tracked.push(delta), BLOCK * 2, BLOCK);
  await collect(blocks, blob, 0, 1);
  await collect(blocks, blob, BLOCK, 1);
  await collect(blocks, blob, 0, 1);
  await collect(blocks, blob, BLOCK * 2, 1);
  await collect(blocks, blob, 0, 1);
  await collect(blocks, blob, BLOCK, 1);
  expect(blocks.bytes).toBe(BLOCK * 2);
  expect(tracked.reduce((sum, delta) => sum + delta, 0)).toBe(BLOCK * 2);
  expect(reads.map(([start]) => start)).toEqual([0, BLOCK, BLOCK * 2, BLOCK]);
});
