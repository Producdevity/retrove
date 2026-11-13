import assert from 'node:assert/strict';
import test from 'node:test';
import { createCPU } from '../web/cpu.mjs';

test('ARM execution and bounded instruction slices', async () => {
  const cpu = await createCPU();
  try {
    cpu.map(0x1000, 4096);
    cpu.write(0x1000, [
      0x28, 0x00, 0xa0, 0xe3, // mov r0, #40
      0x02, 0x00, 0x80, 0xe2, // add r0, r0, #2
      0x1e, 0xff, 0x2f, 0xe1, // bx lr
    ]);
    const slice = cpu.run(0x1000, { count: 1 });
    assert.deepEqual(slice, { reason: 'budget', pc: 0x1004 });
    assert.equal(cpu.getReg(0), 40);
    assert.deepEqual(cpu.run(undefined, { until: 0x1008 }), { reason: 'until', pc: 0x1008 });
    assert.equal(cpu.getReg(0), 42);
  } finally { cpu.close(); }
});

test('Thumb-2 execution, ARM host thunk and return to Thumb', async () => {
  const cpu = await createCPU();
  try {
    cpu.map(0x1000, 8192);
    cpu.write(0x1000, [
      0x40, 0xf2, 0x28, 0x00, // movw r0, #40
      0x98, 0x47,             // blx r3
      0x01, 0x30,             // adds r0, #1
      0x00, 0xbf,             // nop
    ]);
    cpu.write(0x2000, [0xf0, 0x00, 0xf0, 0xe7]); // udf if trap handling fails
    cpu.setReg(3, 0x2000);
    const unhook = cpu.trap(0x2000, (guest, address) => {
      assert.equal(address, 0x2000);
      assert.equal(guest.getReg(14), 0x1007);
      guest.setReg(0, guest.getReg(0) + 1);
      guest.branch(guest.getReg(14));
    });
    assert.deepEqual(cpu.run(0x1001, { count: 1 }), { reason: 'budget', pc: 0x1005 });
    assert.deepEqual(cpu.run(), { reason: 'trap', address: 0x2000, pc: 0x1007 });
    assert.deepEqual(cpu.run(undefined, { until: 0x1008 }), { reason: 'until', pc: 0x1009 });
    assert.equal(cpu.getReg(0), 42);
    unhook();
  } finally { cpu.close(); }
});

test('VFP scalar calculation, memory and guest-mode protection', async () => {
  const cpu = await createCPU();
  try {
    cpu.map(0x80000000, 4096);
    cpu.write(0x80000000, [
      0x10, 0x0a, 0x00, 0xee, // vmov s0,r0
      0x00, 0x0a, 0x30, 0xee, // vadd.f32 s0,s0,s0
      0x10, 0x1a, 0x10, 0xee, // vmov r1,s0
      0x00, 0x10, 0x82, 0xe5, // str r1,[r2]
    ]);
    cpu.setReg(0, 0x3fc00000); // float 1.5
    cpu.setReg(2, 0x80000100);
    cpu.run(0x80000000, { until: 0x80000010 });
    assert.equal(cpu.cpsr & 31, 16);
    assert.equal(cpu.getReg(1), 0x40400000);
    assert.deepEqual(cpu.read(0x80000100, 4), Uint8Array.of(0, 0, 0x40, 0x40));
    cpu.protect(0x80000000, 4096, 5);
    assert.throws(() => cpu.run(0x8000000c, { until: 0x80000010 }),
      err => err.faultAddress === 0x80000100 && err.faultSize === 4 && /UC_ERR_WRITE_PROT/.test(err.message));
    cpu.setReg(2, 0x40000000);
    assert.throws(() => cpu.run(0x8000000c, { until: 0x80000010 }),
      err => err.faultAddress === 0x40000000 && /UC_ERR_WRITE_UNMAPPED/.test(err.message));
  } finally { cpu.close(); }
});

test('save and restore nested guest CPU state including flags and VFP registers', async () => {
  const cpu = await createCPU();
  try {
    cpu.map(0x1000,4096);
    cpu.write(0x1000,[0x10,0x0a,0x00,0xee,0x10,0x1a,0x10,0xee,0x1e,0xff,0x2f,0xe1]); // vmov s0,r0; vmov r1,s0; bx lr
    cpu.setReg(14,0x1010);
    cpu.setReg(0,0x3f800000);
    cpu.run(0x1000,{count:1});
    const state=cpu.saveState();
    const cpsr=cpu.cpsr;
    cpu.setReg(0,0x40400000);
    cpu.run(0x1000,{until:0x1010});
    assert.equal(cpu.getReg(1),0x40400000);
    cpu.restoreState(state);
    assert.equal(cpu.nextPC,0x1004);
    assert.equal(cpu.cpsr,cpsr);
    cpu.freeState(state);
    cpu.run(undefined,{until:0x1010});
    assert.equal(cpu.getReg(1),0x3f800000);
  } finally { cpu.close(); }
});

test('NEON vector integer arithmetic', async () => {
  const cpu=await createCPU();
  try {
    cpu.map(0x1000,4096);
    cpu.write(0x1000,[
      0x10,0x0b,0xa0,0xee, // vdup.32 q0,r0
      0x40,0x28,0x20,0xf2, // vadd.i32 q1,q0,q0
      0x10,0x1b,0x32,0xee, // vmov.32 r1,d2[1]
      0x1e,0xff,0x2f,0xe1, // bx lr
    ]);
    cpu.setReg(0,21); cpu.setReg(14,0x1010);
    cpu.run(0x1000,{until:0x1010});
    assert.equal(cpu.getReg(1),42);
  } finally { cpu.close(); }
});

test('unrolled ARM initializer updates every table entry across instruction budgets', async () => {
  const cpu = await createCPU();
  try {
    const text = 0x1000, data = 0x8000, entries = 300;
    const code = new DataView(new ArrayBuffer(entries * 8));
    for (let i = 0; i < entries; i++) {
      code.setUint32(i * 8, 0xe2800003, true); // add r0, r0, #3
      code.setUint32(i * 8 + 4, 0xe4810004, true); // str r0, [r1], #4
    }
    cpu.map(text, 4096, 5);
    cpu.map(data, 4096, 3);
    cpu.write(text, new Uint8Array(code.buffer));
    cpu.setReg(1, data);
    let pc = text;
    const end = text + code.byteLength;
    while (pc !== end) pc = cpu.run(pc, {count: 97, until: end}).pc;
    const table = cpu.read(data, entries * 4);
    const words = new DataView(table.buffer, table.byteOffset, table.byteLength);
    for (let i = 0; i < entries; i++) assert.equal(words.getUint32(i * 4, true), (i + 1) * 3);
  } finally { cpu.close(); }
});

test('iOS ARMv7 floating-point defaults flush subnormals and return canonical NaNs', async () => {
  const cpu = await createCPU();
  try {
    cpu.map(0x1000, 4096, 5);
    cpu.write(0x1000, [
      0x10, 0x0a, 0x00, 0xee, // vmov s0,r0
      0x00, 0x0a, 0x30, 0xee, // vadd.f32 s0,s0,s0
      0x10, 0x1a, 0x10, 0xee, // vmov r1,s0
    ]);
    for (const [input, result] of [[1, 0], [0x7fc00123, 0x7fc00000]]) {
      cpu.setReg(0, input);
      cpu.run(0x1000, {until: 0x100c});
      assert.equal(cpu.getReg(1), result);
    }
  } finally { cpu.close(); }
});
