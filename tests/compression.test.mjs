import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {crc32, deflateSync, inflateSync} from 'node:zlib';
import {compressionImports} from '../web/compression.mjs';
import {read32, write32} from '../src/runtime/memory/guest-memory.ts';

const SRC = 0x1000, DEST = 0x80000, LENGTH = 0x20;
function guest() {
  const bytes = new Uint8Array(2 * 1024 * 1024);
  const cpu = {
    read(p, n) { assert.ok(n <= 65536); return bytes.slice(p, p + n); },
    write(p, chunk) { assert.ok(chunk.length <= 65536); bytes.set(chunk, p); },
  };
  const funcs = compressionImports(cpu, {alloc: () => 128});
  const call = (name, ...args) => funcs[name](i => args[i] ?? 0);
  async function transform(name, input, size) {
    bytes.set(input, SRC);
    bytes.fill(0xee, DEST, DEST + size + 1);
    write32(cpu, LENGTH, size);
    const result = await call(name, DEST, LENGTH, SRC, input.length);
    const length = read32(cpu, LENGTH);
    assert.ok(length <= size);
    assert.equal(bytes[DEST + size], 0xee);
    return {result, data: Buffer.from(bytes.slice(DEST, DEST + length))};
  }
  return {call, transform, bytes, cpu};
}

test('one-shot zlib compression and decompression interoperate with native zlib across chunks', async () => {
  const {transform} = guest();
  const bytes = Buffer.alloc(265103);
  let n = 1;
  for (let i = 0; i < bytes.length; i++) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    bytes[i] = n >>> 24;
  }
  const packed = await transform('_compress', bytes, bytes.length + 256);
  assert.equal(packed.result, 0);
  assert.deepEqual(inflateSync(packed.data), bytes);
  const native = deflateSync(bytes);
  const unpacked = await transform('_uncompress', Buffer.concat([native, Buffer.from('unused trailer')]), bytes.length);
  assert.equal(unpacked.result, 0);
  assert.deepEqual(unpacked.data, bytes);
  const short = await transform('_compress', bytes, 21594);
  assert.equal(short.result, -5);
  assert.deepEqual(short.data, packed.data.subarray(0, 21594));
  const exact = await transform('_compress', bytes, packed.data.length);
  assert.equal(exact.result, 0);
  assert.deepEqual(exact.data, packed.data);
});

test('one-shot zlib reports output capacity and truncated stream errors with partial output', async () => {
  const {transform} = guest();
  const plain = Buffer.from('BioShock'), compressed = deflateSync(plain);
  const cases = [
    [compressed, 2, -5, plain.subarray(0, 2)],
    [compressed.subarray(0, -1), plain.length + 1, -3, plain],
    [compressed.subarray(0, -1), plain.length, -5, plain],
    [compressed, 0, -3, Buffer.alloc(0)],
    [deflateSync(Buffer.alloc(0)), 0, 0, Buffer.alloc(0)],
    [Buffer.from('invalid'), 32, -3, Buffer.alloc(0)],
    [Buffer.alloc(0), 32, -3, Buffer.alloc(0)]
  ];
  for (const [input, size, result, data] of cases)
    assert.deepEqual(await transform('_uncompress', input, size), {result, data});
  assert.deepEqual(await transform('_compress', Buffer.alloc(0), 0), {result:-5, data:Buffer.alloc(0)});
});

test('zlib CRC supports incremental updates, null buffers, and a stable little-endian guest table', async () => {
  const {call, bytes, cpu} = guest();
  const data = Buffer.alloc(7 * 65536, 52);
  bytes.set(data, SRC);
  const middle = 88902;
  const first = await call('_crc32', 0, SRC, middle);
  assert.equal(await call('_crc32', first, SRC + middle, data.length - middle), crc32(data));
  assert.equal(await call('_crc32', first, SRC, 0), first);
  assert.equal(await call('_crc32', first, 0, 7), 0);
  const table = call('_get_crc_table');
  assert.equal(call('_get_crc_table'), table);
  assert.equal(read32(cpu, table), 0);
  assert.equal(read32(cpu, table + 4), 0x77073096);
  assert.equal(read32(cpu, table + 255 * 4), 0x2d02ef8d);
});
