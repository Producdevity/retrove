import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {deflateSync, inflateSync} from 'node:zlib';
import {createCPU} from '../src/runtime/cpu/cpu.ts';
import {guestZlibStreams} from '../src/runtime/ios/libc/guest-zlib.ts';
import {Heap, read32, write32} from '../src/runtime/memory/guest-memory.ts';

async function fixture(t) {
  const cpu = await createCPU(), heap = new Heap(cpu), gates = new Map();
  t.onTestFinished(() => cpu.close());
  const gateway = 0x28000000, done = gateway + 4092, stack = 0x40000000 - 4096;
  cpu.map(gateway, 4096, 5); cpu.map(stack, 4096, 3);
  for (let p = gateway; p < gateway + 64; p += 4) write32(cpu, p, 0xe7f000f0);
  let pending;
  cpu.trapRange(gateway, gateway + 60, (_, at) => { pending = at; });
  function hostGate(_, fn) {
    const address = gateway + gates.size * 4;
    gates.set(address, fn);
    return address;
  }
  const funcs = guestZlibStreams(cpu, heap, hostGate);
  async function call(name, ...args) {
    const jump = await funcs[name](i => args[i]);
    if (typeof jump === 'number') return jump;
    const sp = stack + 2048;
    cpu.setReg(13, sp); cpu.setReg(14, done);
    args.forEach((arg, i) => i < 4 ? cpu.setReg(i, arg) : write32(cpu, sp+4*(i-4), arg));
    let pc = jump.jump;
    for (let slice = 0; slice < 20000; slice++) {
      const result = cpu.run(pc, {until: done, count: 8192});
      if (result.reason === 'until') return cpu.getReg(0) | 0;
      if (result.reason === 'trap') {
        const value = gates.get(pending)(i => cpu.getReg(i));
        if (value !== undefined) cpu.setReg(0, value);
        pc = cpu.getReg(14);
      } else pc = result.pc;
    }
    throw Error('Guest zlib exceeded the fixture instruction budget');
  }
  return {cpu, heap, call, hostGate};
}

test('upstream ARM zlib consumes a stream in pieces and invokes guest allocator callbacks', async t => {
  const {cpu, heap, call, hostGate} = await fixture(t);
  const plain = Buffer.from('Welcome to Rapture. '.repeat(120)), compressed = deflateSync(plain);
  const stream = heap.zero(56), input = heap.alloc(compressed.length), output = heap.alloc(plain.length);
  const version = heap.string('1.2.8'), held = new Set();
  const context = 0x1050;
  write32(cpu, stream + 40, context);
  const allocGate = hostGate({}, args => {
    assert.equal(args(0), context);
    const p = heap.zero(args(1)*args(2));
    held.add(p);
    return p;
  });
  const freeGate = hostGate({}, args => {
    assert.equal(args(0), context);
    const p = args(1);
    assert.ok(held.delete(p));
    heap.free(p);
  });
  // These callback pointers name guest ARM veneers; neither is a host gate.
  const code = 0x31000000;
  cpu.map(code, 4096, 5);
  for (const [offset, target] of [[0, allocGate], [8, freeGate]]) {
    write32(cpu, code+offset, 0xe51ff004);
    write32(cpu, code+offset+4, target);
  }
  write32(cpu, stream + 32, code); write32(cpu, stream + 36, code + 8);
  cpu.write(input, compressed);
  assert.equal(await call('_inflateInit2_', stream, 15, version, 55), -6);
  assert.equal(await call('_inflateInit2_', stream, 15, version, 56), 0);
  assert.ok(held.has(read32(cpu, stream+28)));
  write32(cpu, stream, input); write32(cpu, stream+4, compressed.length);
  write32(cpu, stream+12, output);
  let result = 0;
  while (result === 0) {
    write32(cpu, stream+16, Math.min(147, plain.length-read32(cpu,stream+20)));
    result = await call('_inflate', stream, 0);
  }
  assert.equal(result, 1);
  assert.equal(read32(cpu, stream + 8), compressed.length);
  assert.equal(read32(cpu, stream + 20), plain.length);
  assert.deepEqual(Buffer.from(cpu.read(output, plain.length)), plain);
  assert.equal(await call('_inflateEnd', stream), 0);
  assert.equal(held.size, 0);
});

test('upstream ARM deflate uses callable default alloc/free and produces a standard zlib stream', async t => {
  const {cpu, heap, call} = await fixture(t);
  const plain = Buffer.from('Darwin streaming deflate '.repeat(50));
  const stream = heap.zero(56), input = heap.alloc(plain.length), output = heap.alloc(512);
  cpu.write(input, plain);
  assert.equal(await call('_deflateInit2_', stream, 6, 8, 15, 8, 0, heap.string('1.2.8'), 56), 0);
  assert.ok(read32(cpu, stream + 32));
  assert.ok(read32(cpu, stream + 36));
  write32(cpu, stream, input); write32(cpu, stream+4, plain.length);
  write32(cpu, stream+12, output); write32(cpu, stream+16, 512);
  assert.equal(await call('_deflate', stream, 4), 1);
  assert.deepEqual(inflateSync(cpu.read(output, read32(cpu, stream+20))), plain);
  assert.equal(await call('_deflateEnd', stream), 0);
});
