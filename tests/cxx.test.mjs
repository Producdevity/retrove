import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import { readFile } from 'node:fs/promises';
import { cxxImports } from '../src/runtime/cxx/cxx.ts';
import { openIPA } from '../src/runtime/ios/package/ipa.ts';
import { runGuest } from '../src/runtime/ios/runtime/runtime.ts';
const bits=new DataView(new ArrayBuffer(8));
function words(n) { bits.setFloat64(0,n,true);return [bits.getUint32(0,true),bits.getUint32(4,true)]; }
function dbl(n) {bits.setBigUint64(0,n,true);return bits.getFloat64(0,true);}
function float(n){bits.setUint32(0,n,true);return bits.getFloat32(0,true);}
function fixtures() {
  const bytes=new Uint8Array(1024); let thread=1;
  const cpu={read:(p,n)=>bytes.subarray(p,p+n),write:(p,b)=>bytes.set(b,p)};
  const {funcs}=cxxImports(cpu,{alloc:n=>n>128?0:64,zero:()=>32},()=>thread);
  return {run:(name,...args)=>funcs[name](i=>args[i]),d:new DataView(bytes.buffer),swap:id=>thread=id};
}
test('Darwin new symbols and normal SJLJ registration are isolated across threads',()=>{
  const {run,swap,d}=fixtures();
  assert.equal(run('__Znwm',1),64);assert.throws(()=>run('__Znam',2024),/exhausted/);
  run('__Unwind_SjLj_Register',0x100);swap(2);run('__Unwind_SjLj_Register',0x180);
  swap(1);run('__Unwind_SjLj_Register',0x120);assert.equal(d.getUint32(0x120,true),0x100);
  run('__Unwind_SjLj_Unregister',0x120);run('__Unwind_SjLj_Unregister',0x100);
  swap(2);run('__Unwind_SjLj_Unregister',0x180);
});
test('returns 64-bit words in Darwin ARM ABI order and handles signed division',()=>{
  const {run,d}=fixtures();assert.equal(run('___udivdi3',1,3,2,0),0x180000000n);
  assert.equal(run('___divdi3',0xfffffff9,0xffffffff,2,0),0xfffffffffffffffdn);
  assert.equal(run('___divmodsi4',-7,2,0x10),0xfffffffd);
  assert.equal(d.getInt32(0x10,true),-1);
  assert.equal(dbl(run('_pow',...words(1.25),...words(2))),1.5625);
  assert.equal(run('___fixdfdi',...words(-13.9)),0xfffffffffffffff3n);
  assert.equal(dbl(run('___floatundidf',0x12345678,0x100000)),0x10000012345678);
  assert.equal(run('___floatundisf',1,0x80000080),0x5f000001); // above a midpoint that rounds to a double tie
  assert.equal(dbl(run('_frexp',...words(Number.MIN_VALUE),0x20)),0.5);
  assert.equal(d.getInt32(0x20,true),-1073);
  assert.equal(dbl(run('_ldexp',...words(Number.MIN_VALUE),1073)),0.5);
  assert.equal(dbl(run('_modf',...words(-2.125),0x30)),-0.125);
  assert.equal(d.getFloat64(0x30,true),-2);
  run('___sincos_stret',0x40,...words(Math.PI/2));assert.equal(d.getFloat64(0x40,true),1);
  bits.setFloat32(0,-2.5,true);assert.equal(float(run('_rintf',bits.getUint32(0,true))),-2);
});

test('default libc++ Mersenne Twister shares its sequence and mutex across guest threads', () => {
  const {run, swap} = fixtures();
  const open = '__ZNSt3__18__rs_getEv', close = '__ZNSt3__112__rs_defaultD1Ev', next = '__ZNSt3__112__rs_defaultclEv';
  assert.equal(run(open, 8), 8);
  assert.deepEqual([run(next, 8),run(next, 8),run(next, 8)], [3499211612,581869302,3890346734]);
  swap(2);
  const blocked = run(open, 16);
  assert.equal(blocked.wait(), undefined);
  swap(1); run(close, 8);
  swap(2); assert.equal(blocked.wait(), 16);
  assert.equal(run(next, 16), 3586334585);
  run(close, 16);
});

test('Darwin ARMv7 catches an Objective-C object and standard C++ base class, unwinds a qsort callback, and rethrows', async () => {
  const ipa = await openIPA(new Blob([await readFile(new URL('./fixtures/sjlj.ipa', import.meta.url))]));
  const result = await runGuest(ipa, {signal:AbortSignal.timeout(2000)});
  assert.equal(result.exitStatus, 0);
});
