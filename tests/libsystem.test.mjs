import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {systemImports} from '../web/libsystem.mjs';
import {Heap, read32, write32} from '../src/runtime/memory/guest-memory.ts';
import {stringImports} from '../web/strings.mjs';

function pageFixture() {
  const bytes = new Uint8Array(4096), base = 0x10000000;
  const cpu = {
    map() {},
    read(address, size) {
      assert.ok(address >= base && address + size <= base + bytes.length, 'read outside mapped page');
      return bytes.subarray(address - base, address - base + size);
    },
    write(address, source) { bytes.set(source, address - base); }
  };
  return {bytes, base, cpu, heap: new Heap(cpu)};
}

test('bounded Darwin C strings and checked copies respect the source and output bounds', () => {
  const {bytes, base, cpu} = pageFixture();
  const funcs = stringImports(cpu);
  const call = (name, ...args) => funcs[name](i => args[i]);
  const src = base + 4093, dest = base + 1;
  cpu.write(src, Uint8Array.of(65, 66, 67));
  assert.equal(call('_strncpy', dest, src, 3), dest);
  assert.deepEqual([...cpu.read(dest, 4)], [65, 66, 67, 0]);
  assert.equal(call('_strncmp', src, dest, 3), 0);
  assert.throws(() => call('___strncpy_chk', dest, src, 3, 2), /destination/);
  assert.equal(call('_memchr', src, 67, 3), src + 2);
  assert.equal(call('_strrchr', dest, 0), dest + 3);
  bytes[4] = 0;
  assert.equal(call('_strchr', dest, 66), dest + 1);
  assert.equal(call('_strncpy', dest, 0, 0), dest);
});

test('ARM Darwin wide strings compare signed 32-bit wchar_t and return guest pointers', () => {
  const {base, cpu} = pageFixture();
  const funcs = stringImports(cpu), call = (name, ...args) => funcs[name](i => args[i]);
  const text = base + 100, needle = base + 200, output = base + 300;
  [0x41, 0x41, 0x42, 0x79, 0].forEach((c, i) => write32(cpu, text + 4*i, c));
  [0x41, 0x42, 0].forEach((c, i) => write32(cpu, needle + 4*i, c));
  assert.equal(call('_wcsstr', text, needle), text + 4);
  assert.equal(call('_wcslen', text), 4);
  assert.equal(call('_wcschr', text, 0), text + 16);
  call('_wcscpy', output, needle);
  call('_wcscat', output, needle);
  assert.equal(call('_wcslen', output), 4);
  write32(cpu, needle, 0xffffffff);
  assert.equal(call('_wcscmp', text, needle), 1);
  assert.equal(call('_wcscmp', needle, text), -1);
});

test('default rune locale layout, CF wall clock, Mach waits and OSAtomic follow the native interfaces', () => {
  const {cpu, heap} = pageFixture();
  const {funcs, data} = systemImports(cpu, heap, {info: {}, bundlePath: 'Game.app'}, () => {});
  const call = (name, ...args) => funcs[name](i => args[i]);
  const locale = data.get('__DefaultRuneLocale');
  assert.equal(new TextDecoder().decode(cpu.read(locale, 12)), 'RuneMagANONE');
  assert.equal(read32(cpu, locale + 48), 0xfffd);
  assert.equal(read32(cpu, locale + 52 + 4*65) & 0x1ffff, 0x1890a);
  assert.equal(read32(cpu, locale + 1076 + 4*65), 97);
  assert.equal(read32(cpu, locale + 2100 + 4*97), 65);
  const b = new DataView(new ArrayBuffer(8));
  b.setBigUint64(0, call('_CFAbsoluteTimeGetCurrent'), true);
  assert.ok(Math.abs(b.getFloat64(0, true) - (Date.now()/1000 - 978307200)) < 1);
  assert.equal(call('_mach_wait_until', 1, 0), 0);
  assert.equal(call('_mach_wait_until', 0xffffffff, 0xffffffff).wait(), undefined);
  const cell = heap.zero(4);
  write32(cpu, cell, 0xffffffff);
  assert.equal(call('_OSAtomicAdd32Barrier', 2, cell), 1);
  assert.equal(call('_OSAtomicCompareAndSwap32Barrier', 2, 9, cell), 0);
  assert.equal(call('_OSAtomicCompareAndSwapPtrBarrier', 1, 9, cell), 1);
  assert.equal(read32(cpu, cell), 9);
});

test('aligned Darwin allocations remain freeable and their alignment padding is reused', () => {
  const {heap, cpu} = pageFixture();
  const {funcs} = systemImports(cpu, heap, {info: {}, bundlePath: 'Game.app'}, () => {});
  const out = heap.zero(4), before = heap.next;
  const alloc = (align, bytes) => funcs._posix_memalign(i => [out, align, bytes][i]);
  assert.equal(alloc(256, 24), 0);
  const p = read32(cpu, out);
  assert.equal(p % 256, 0);
  assert.equal(heap.live.get(p), 32);
  assert.equal(alloc(3, 24), 22);
  assert.equal(read32(cpu, out), p);
  assert.equal(alloc(32, 0xffffffff), 12);
  assert.equal(read32(cpu, out), p);
  heap.free(p);
  assert.equal(heap.alloc(16), before);
  assert.equal(heap.alloc(16, 64) % 64, 0);
});

test('strtoul handles base prefixes, sign, saturation and byte end pointers', () => {
  const {base, cpu, heap} = pageFixture();
  const errno = heap.zero(4), end = heap.zero(4);
  const funcs = stringImports(cpu, errno);
  function parse(input, radix, wide = false) {
    const p = heap.string(input);
    const result = funcs[wide ? '_strtoull' : '_strtoul'](i => [p, end, radix][i]);
    return [result, read32(cpu, end) - p];
  }
  assert.deepEqual(parse(' +0xAFz', 0), [175, 6]);
  assert.deepEqual(parse('-1!', 10), [0xffffffff, 2]);
  assert.deepEqual(parse('0x!', 16), [0, 1]);
  assert.deepEqual(parse('  +x', 0), [0, 0]);
  assert.deepEqual(parse('00078', 0), [7, 4]);
  assert.deepEqual(parse('4294967296', 10), [0xffffffff, 10]);
  assert.equal(read32(cpu, errno), 34);
  assert.deepEqual(parse('abc', 1), [0, 0]);
  assert.equal(read32(cpu, errno), 22);
  assert.deepEqual(parse('ffffffffffffffff0', 16, true), [0xffffffffffffffffn, 17]);
  [32, 48, 120, 66, 0].forEach((c, i) => write32(cpu, base + 1024 + 4*i, c));
  assert.equal(funcs._wcstoul(i => [base + 1024, end, 0][i]), 11);
  assert.equal(read32(cpu, end), base + 1040);
});

test('strtod preserves binary64 precision, signed zero, exponents and C-locale end pointers', () => {
  const {cpu, heap} = pageFixture(), errno = heap.zero(4), end = heap.zero(4);
  const funcs = stringImports(cpu, errno), value = new DataView(new ArrayBuffer(8));
  const parse = s => {
    const p = heap.string(s);
    const bits = funcs._strtod(i => [p, end][i]);
    value.setBigUint64(0, bits, true);
    return [value.getFloat64(0, true), read32(cpu, end) - p];
  };
  assert.deepEqual(parse('  -0x1.8p2/'), [-6, 10]);
  assert.deepEqual(parse('+2.5e-2px'), [0.025, 7]);
  assert.deepEqual(parse('-0'), [-0, 2]);
  assert.deepEqual(parse('none'), [0, 0]);
  assert.deepEqual(parse('1e+'), [1, 1]);
  assert.deepEqual(parse('0x1.00000000000008p0'), [1, 20]);
  assert.deepEqual(parse('0x1.00000000000008001p0'), [1 + Number.EPSILON, 23]);
  assert.deepEqual(parse('0x1p-1074'), [Number.MIN_VALUE, 9]);
  assert.deepEqual(parse('-Infinity'), [-Infinity, 9]);
  assert.ok(Number.isNaN(parse('nan(payload)')[0]));
});
