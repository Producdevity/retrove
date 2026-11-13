import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMachO, loadMachO, prepareStartup } from '../web/macho.mjs';

function makeFixture({ bind = [], lazy = [], weak = [], rebase = [], exports = [],
  initializer = 0x4300, cryptid = 0, thread = false } = {}) {
  const bytes = new Uint8Array(8192), d = new DataView(bytes.buffer);
  const enc = new TextEncoder();
  const put = (at, n) => d.setUint32(at, n, true);
  let at = 28, count = 0;
  function command(type, length) {
    const loc = at;
    put(loc, type); put(loc + 4, length); at += length; count++;
    return loc;
  }
  function seg(name, address, size, offset, fsize, prot, init = false) {
    const p = command(1, 56 + (init ? 68 : 0));
    bytes.set(enc.encode(name), p + 8);
    for (const [i, n] of [address, size, offset, fsize, prot, prot, Number(init), 0].entries()) put(p + 24 + i * 4, n);
    if (init) {
      bytes.set(enc.encode('__mod_init_func'), p + 56);
      bytes.set(enc.encode(name), p + 72);
      for (const [i, n] of [address, 4, offset, 2, 0, 0, 9].entries()) put(p + 88 + i * 4, n);
    }
    return p;
  }
  seg('__PAGEZERO', 0, 0x4000, 0, 0, 0);
  seg('__TEXT', 0x4000, 4096, 0, 4096, 5);
  const data = seg('__DATA', 0x5000, 4096, 4096, 4096, 3, true);
  const entry = command(thread ? 5 : 0x80000028, thread ? 84 : 24);
  if (thread) { put(entry + 8, 1); put(entry + 12, 17); put(entry + 76, 0x4300); put(entry + 80, 0x20); }
  else put(entry + 8, 0x301);
  const encCmd = command(0x21, 20); put(encCmd + 16, cryptid);
  const libCmd = command(0xc, 48); put(libCmd + 8, 24); bytes.set(enc.encode('/usr/lib/libSystem.B'), libCmd + 24);
  const dyld = command(0x80000022, 48);
  let link = 0x1800;
  for (const [n, stream] of [[8, rebase], [16, bind], [24, weak], [32, lazy], [40, exports]]) {
    put(dyld + n, link); put(dyld + n + 4, stream.length); bytes.set(stream, link); link += stream.length;
  }
  put(0, 0xfeedface); put(4, 12); put(8, 9); put(12, 2); put(16, count); put(20, at - 28);
  put(0x1000, initializer); put(0x300, 0xe12fff1e);
  return { bytes, data, put };
}
function guest() {
  const mem = new Uint8Array(0x10000), d = new DataView(mem.buffer);
  return {
    mappings: [],
    map(...args) { this.mappings.push(args); },
    write(at, bytes) { mem.set(bytes, at); },
    read32(at) { return d.getUint32(at, true); },
    write32(at, val) { d.setUint32(at, val, true); },
    readText(at) { return new TextDecoder().decode(mem.subarray(at, mem.indexOf(0, at))); },
  };
}
function sym(s, flags = 0) { return [0x40 | flags, ...new TextEncoder().encode(s), 0]; }

test('maps a fixed-address image; resolves normal, weak and lazy bindings before initializers', () => {
  const image = parseMachO(makeFixture({
    bind: [0x11, ...sym('_puts'), 0x72, 4, 0x90, ...sym('_optional', 1), 0x90, 0],
    lazy: [0x11, ...sym('_f'), 0x72, 12, 0x60, 0x7e, 0x90, 0, 0x11, ...sym('_g'), 0x72, 16, 0x53, 0x90, 0],
    rebase: [0x11, 0x22, 0, 0x51, 0],
    weak: [...sym('_local'), 0x72, 20, 0x90, 0],
    exports: [0, 1, ...new TextEncoder().encode('_local'), 0, 10, 3, 4, 0x80, 6, 0],
  }).bytes);
  assert.deepEqual(image.rebases, [0x5000]);
  const memory = guest();
  const loaded = loadMachO(image, memory, binding => {
    assert.equal(binding.library, '/usr/lib/libSystem.B');
    return { _puts: 0x6000, _f: 0xff02, _g: 0x6000 }[binding.name];
  });
  assert.deepEqual(loaded, { entry: 0x4301, entryKind: 'main', initializers: [0x4300],
    lazyTargets:new Map([[0,{slot:0x500c,target:0xff00,value:0xff00}],[11,{slot:0x5010,target:0x6000,value:0xfec}]]) });
  assert.deepEqual(memory.mappings, [[0x4000, 4096, 5], [0x5000, 4096, 3]]);
  assert.deepEqual([4, 8, 12, 16, 20].map(i => memory.read32(0x5000 + i)), [0x6000, 0, 0xff00, 0xfec, 0x4300]);
});
test('reads a fat binary and preserves ARM thread state Thumb mode', () => {
  const { bytes } = makeFixture({ thread: true });
  const fat = new Uint8Array(4096 + bytes.length), d = new DataView(fat.buffer);
  d.setUint32(0, 0xcafebabe); d.setUint32(4, 1); d.setUint32(8, 12); d.setUint32(12, 9); d.setUint32(16, 4096);
  d.setUint32(20, bytes.length); d.setUint32(24, 12); fat.set(bytes, 4096);
  const image = parseMachO(fat);
  assert.equal(image.entry, 0x4301); assert.equal(image.entryKind, 'thread');
});
test('honors Apple ld64 backward address deltas encoded as 64-bit unsigned LEB', () => {
  const image = parseMachO(makeFixture({
    bind: [0x11, ...sym('_a'), 0x72, 0x10, 0x90, 0x80, 0xf8, ...Array(8).fill(0xff), 1, 0x90, 0],
  }).bytes);
  assert.deepEqual(image.imports.map(b => b.address), [0x5010, 0x500c]);
});
test('rejects encrypted images, malformed ranges and invalid initializers', () => {
  assert.throws(() => parseMachO(makeFixture({ cryptid: 1 }).bytes), /encrypted/);
  const f = makeFixture(); f.put(f.data + 32, 0x80000000);
  assert.throws(() => parseMachO(f.bytes), /invalid/);
  assert.throws(() => parseMachO(makeFixture({ bind: [0x11, ...sym('_a'), 0x72, 0x80, 0x20, 0x90, 0] }).bytes), /outside segment/);
  assert.throws(() => loadMachO(parseMachO(makeFixture({ initializer: 0x5000 }).bytes), guest(), () => null), /initializer/);
  const m = guest();
  assert.throws(() => loadMachO(parseMachO(makeFixture({ bind: [0x11, ...sym('_a'), 0x72, 8, 0x90, 0] }).bytes), m, () => null), /unresolved import/);
  assert.deepEqual(m.mappings, []);
});
test('builds valid process argument and raw-stack pointers', () => {
  const m = guest(), path = '/BioShock.app/BioShock';
  const { args, rawStack } = prepareStartup(m, 0xf000, path);
  assert.equal(rawStack % 16, 0);
  assert.equal(m.read32(rawStack), 1);
  assert.equal(m.readText(m.read32(args[1])), path);
  assert.equal(m.read32(args[1] + 4), 0);
  assert.equal(m.read32(args[2]), 0);
  assert.equal(m.readText(m.read32(args[3])), path);
});

test('fault symbolication selects the nearest named definition in the same section', () => {
  const f = makeFixture(), d = new DataView(f.bytes.buffer);
  const end = 28 + d.getUint32(20, true);
  f.put(16, d.getUint32(16, true) + 1); f.put(20, end - 28 + 24);
  for (const [i, value] of [2, 24, 0x1900, 3, 0x1940, 16].entries()) f.put(end + i * 4, value);
  f.bytes.set(new TextEncoder().encode('\0_start\0_other\0'), 0x1940);
  for (const [i, [name, type, section, address]] of [[1, 0x0f, 1, 0x5000], [8, 0x0e, 2, 0x5002], [8, 0x2e, 1, 0x5002]].entries()) {
    const p = 0x1900 + i * 12;
    f.put(p, name); f.bytes[p+4] = type; f.bytes[p+5] = section; f.put(p+8, address);
  }
  const image = parseMachO(f.bytes);
  assert.deepEqual(image.symbolAt(0x5003), {name: '_start', offset: 2});
  assert.equal(image.symbolAt(0x3000), undefined);
});
