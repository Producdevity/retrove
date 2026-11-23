import assert from 'node:assert/strict';
import {test, vi} from 'vite-plus/test';
import {systemImports} from '../src/runtime/ios/libc/libsystem.ts';
import {cxxImports} from '../src/runtime/cxx/cxx.ts';
import {bufferImports} from '../src/runtime/ios/libc/format-imports.ts';
import {GuestView} from '../src/runtime/graphics/remote/guest-view.ts';
import {Forward, LOCAL_IMPORT_NAMES, localImports} from '../src/runtime/cpu/worker/local-imports.ts';
import {read32, write32} from '../src/runtime/memory/guest-memory.ts';

const SPAN = 0x10000, SCRATCH = 0x8000;
const encoder = new TextEncoder();

/** The same guest memory twice: plain bytes for the main-thread import, a shared Wasm view for the worker's. */
function pair() {
  const bytes = new Uint8Array(SPAN);
  const main = {read: (p, n) => bytes.slice(p, p + n), write: (p, b) => bytes.set(b, p)};
  const memory = new WebAssembly.Memory({initial: 1, maximum: 1, shared: true});
  const local = new GuestView(memory, 0, SPAN - 1);
  let next = SCRATCH;
  const alloc = n => { const p = next; next += Math.ceil(n / 4) * 4; return p; };
  const heap = {alloc, zero: n => alloc(n), free() {}, string: s => { const b = encoder.encode(s + '\0'), p = alloc(b.length); main.write(p, b); return p; }};
  const {funcs} = systemImports(main, heap, {info: {}, bundlePath: 'Game.app'}, () => {});
  const worker = localImports(local, {id: 7, timeOrigin: performance.timeOrigin});
  const both = (address, data) => { main.write(address, data); local.write(address, data); };
  return {
    main, local, both, funcs, worker, cxx: cxxImports(main, heap).funcs,
    run: (name, ...args) => funcs[name](i => args[i]),
    runLocal: (name, ...args) => worker.get(name)(i => args[i]),
    equal: (from = 0, to = SCRATCH) => assert.deepEqual(local.read(from, to - from), main.read(from, to - from)),
  };
}
const bytesOf = (...text) => encoder.encode(text.join('') + '\0');
function wide(...chars) {
  const out = new Uint8Array(4 * (chars.length + 1)), view = new DataView(out.buffer);
  chars.forEach((c, i) => view.setUint32(4 * i, c, true));
  return out;
}

test('every new local import has a worker implementation', () => {
  const {worker} = pair();
  const named = ['___sincosf_stret', '_CFAbsoluteTimeGetCurrent', '_gettimeofday', '_OSAtomicAdd32Barrier',
    '_OSAtomicCompareAndSwap32Barrier', '_OSAtomicCompareAndSwapPtrBarrier', '_atof', '_wcspbrk',
    ...Object.keys(bufferImports(pair().main))];
  for (const name of named) {
    assert.ok(LOCAL_IMPORT_NAMES.has(name), name);
    assert.ok(worker.has(name), name);
  }
});

test('___sincosf_stret writes the same sine and cosine words as the main thread', () => {
  const t = pair(), floats = new DataView(new ArrayBuffer(4));
  for (const angle of [0, 0.5, -1.25, 3.1415927, 1e6, -0, NaN, Infinity, 1e-30]) {
    floats.setFloat32(0, angle, true);
    const word = floats.getUint32(0, true), result = 0x1000;
    assert.equal(t.runLocal('___sincosf_stret', result, word), t.cxx.___sincosf_stret(i => [result, word][i]));
    t.equal();
  }
});

test('wall clock imports match the main thread', () => {
  vi.useFakeTimers();
  try {
    const t = pair();
    for (const now of [1_700_000_123_456, 978_307_200_000, 1_999]) {
      vi.setSystemTime(now);
      assert.equal(t.runLocal('_CFAbsoluteTimeGetCurrent'), t.run('_CFAbsoluteTimeGetCurrent'));
      assert.equal(t.runLocal('_gettimeofday', 0x2000, 0), t.run('_gettimeofday', 0x2000, 0));
      t.equal();
      assert.equal(t.runLocal('_gettimeofday', 0, 0x2100), t.run('_gettimeofday', 0, 0x2100));
    }
    assert.equal(read32(t.local, 0x2000), 1);
    assert.equal(read32(t.local, 0x2004), 999_000);
  } finally {
    vi.useRealTimers();
  }
});

test('OSAtomic word operations match the main thread and are atomic on the shared view', () => {
  const t = pair(), cell = 0x1000;
  for (const [initial, expected, replacement] of [[5, 5, 9], [5, 6, 9], [0xffffffff, 0xffffffff, 0], [0x80000000, 0x80000000, 1]]) {
    for (const name of ['_OSAtomicCompareAndSwap32Barrier', '_OSAtomicCompareAndSwapPtrBarrier']) {
      t.both(cell, new Uint8Array(4)); write32(t.main, cell, initial); write32(t.local, cell, initial);
      assert.equal(t.runLocal(name, expected, replacement, cell), t.run(name, expected, replacement, cell), name);
      t.equal();
    }
  }
  for (const [initial, delta] of [[1, 2], [0xffffffff, 2], [0x7fffffff, 1], [3, 0xffffffff]]) {
    write32(t.main, cell, initial); write32(t.local, cell, initial);
    assert.equal(t.runLocal('_OSAtomicAdd32Barrier', delta, cell), t.run('_OSAtomicAdd32Barrier', delta, cell));
    t.equal();
  }
  assert.equal(t.local.compareExchange32(cell, read32(t.local, cell), 4), read32(t.main, cell));
  assert.throws(() => t.local.add32(cell + 1, 1), /aligned/);
});

test('_atof matches the main thread and forwards the cases that set errno', () => {
  const t = pair(), source = 0x1000;
  for (const text of ['3.25', '  -1e3xyz', '0x1.8p1', 'inf', '-Infinity', 'nan(abc)', '', 'abc', '.5e1', '1e+', '123456789.123456789']) {
    t.both(source, bytesOf(text));
    assert.equal(t.runLocal('_atof', source), t.run('_atof', source), text);
    t.equal();
  }
  for (const text of ['1e999', '1e-999', '4e-320', '0x1p-1080']) {
    t.both(source, bytesOf(text));
    assert.equal(t.runLocal('_atof', source), Forward, text);
    assert.equal(read32(t.main, t.run('___error')), 0);
    t.run('_atof', source);
    assert.equal(read32(t.main, t.run('___error')), 34, text);
    write32(t.main, t.run('___error'), 0);
  }
});

test('_wcspbrk matches the main thread', () => {
  const t = pair(), text = 0x1000, set = 0x1100;
  for (const [subject, accept] of [[[0x41, 0x42, 0x43], [0x43, 0x58]], [[0x41, 0x42], [0x59]], [[], [0x41]], [[0x41], []], [[0xffffffff, 0x41], [0x41]]]) {
    t.both(text, wide(...subject)); t.both(set, wide(...accept));
    assert.equal(t.runLocal('_wcspbrk', text, set), t.run('_wcspbrk', text, set));
  }
});

test('printf-family imports match the main thread and forward what throws', () => {
  const t = pair(), out = 0x1000, format = 0x1400, string = 0x1800, list = 0x1900;
  t.both(string, bytesOf('guest'));
  const pi = [0, 0x40091eb8];
  const cases = [['plain', []], ['%d|%5d|%-5d|%05d|%+d', [-42, 7, 7, 7, 7]], ['%x %X %#x %o %u', [0xbeef, 255, 0xdead, 8, 9]],
    ['%s|%10s|%-10s|%.3s', [string, string, string, string]], ['%c%c', [65, 66]], ['%.2f %8.3f %e %g', [...pi, ...pi, ...pi, ...pi]],
    ['%lld %llu', [1, 2, 3, 0xffffffff]], ['%%', []], ['%p', [0x1234]], ['%hhd %hd', [300, 70000]]];
  for (const [template, words] of cases) {
    t.both(format, bytesOf(template));
    for (const size of [64, 4, 1, 0]) {
      t.both(out, new Uint8Array(80).fill(0x7f));
      assert.equal(t.runLocal('_snprintf', out, size, format, ...words), t.run('_snprintf', out, size, format, ...words), template);
      t.equal();
    }
    t.both(out, new Uint8Array(80).fill(0x7f));
    assert.equal(t.runLocal('_sprintf', out, format, ...words), t.run('_sprintf', out, format, ...words), template);
    t.equal();
    words.forEach((w, i) => t.both(list + 4 * i, wide(w).subarray(0, 4)));
    assert.equal(t.runLocal('_vsnprintf', out, 64, format, list), t.run('_vsnprintf', out, 64, format, list), template);
    t.equal();
  }
  t.both(format, bytesOf('%s%s%s'));
  t.both(string, bytesOf('long enough to overflow'));
  assert.throws(() => t.run('___sprintf_chk', out, 0, 8, format, string, string, string), /too small/);
  assert.equal(t.runLocal('___sprintf_chk', out, 0, 8, format, string, string, string), Forward);
  t.both(format, bytesOf('%@'));
  assert.throws(() => t.run('_sprintf', out, format, string), /Objective-C/);
  assert.equal(t.runLocal('_sprintf', out, format, string), Forward);
  t.both(format, bytesOf('%y'));
  assert.equal(t.runLocal('_snprintf', out, 8, format, 1), Forward);
});
