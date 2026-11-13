import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openIPA} from '../web/ipa.mjs';
import {runGuest} from '../web/runtime.mjs';

test('ARM main joins a guest worker after it sleeps and receives its return value', async () => {
  const b = await readFile(new URL('./fixtures/threads.ipa', import.meta.url));
  const ipa = await openIPA(new Blob([b]));
  const result = await runGuest(ipa, {signal: AbortSignal.timeout(2000)});
  assert.deepEqual(result, {exitStatus: 0, calls: 3});
});

test('ARM SJLJ leaves keep independent context chains across thread preemption', async t => {
  const {createCPU} = await import('../web/cpu.mjs');
  const {Heap, read32} = await import('../web/memory.mjs');
  const {threadImports} = await import('../web/threads.mjs');
  const cpu = await createCPU(), heap = new Heap(cpu), done = 0x1000;
  t.onTestFinished(() => cpu.close());
  cpu.map(done, 4096, 5);
  const ts = threadImports(cpu, heap, done);
  const frame = () => heap.zero(44);
  const main = frame(), worker = frame(), nested = frame();
  const enter = '__Unwind_SjLj_Register', leave = '__Unwind_SjLj_Unregister';
  function call(name, arg = 0) {
    cpu.setReg(0, arg); cpu.setReg(14, done);
    assert.equal(cpu.run(ts.nativeFunctions.get(name), {until: done}).reason, 'until');
    return cpu.getReg(0);
  }
  assert.equal(call('_pthread_self'), 1);
  call(enter, main);
  const workerId = ts.spawnDetached(0x1240, []);
  await ts.advance(async () => {
    assert.equal(call('_pthread_self'), workerId);
    call(enter, worker);
    assert.equal(read32(cpu, worker), 0);
    return {budget:true, pc:0x1244};
  });
  assert.equal(call('_pthread_self'), 1);
  call(enter, nested);
  assert.equal(read32(cpu, nested), main);
  call(leave, nested);
  await ts.advance(async () => {
    call(enter, nested);
    assert.equal(read32(cpu, nested), worker);
    call(leave, nested); call(leave, worker);
    return {done:true, value:0};
  });
  call(enter, nested);
  assert.equal(read32(cpu, nested), main);
  call(leave, nested); call(leave, main);
  ts.close();
});

test('Darwin longjmp restores copied ARM state, VFP data and the saved SjLj chain', async () => {
  const {nonlocalJumps}=await import('../web/nonlocal-jump.mjs');
  const {createCPU}=await import('../web/cpu.mjs');
  const {Heap,read32,write32}=await import('../web/memory.mjs');
  const {threadImports}=await import('../web/threads.mjs');
  const cpu=await createCPU();
  try {
    const heap=new Heap(cpu),end=0x1000;
    cpu.map(end,4096);const threads=threadImports(cpu,heap,end);
    const j=nonlocalJumps(cpu,heap,threads),buf=heap.alloc(112),copy=heap.alloc(112);
    const write=(p,x)=>write32(cpu,p,x);
    const regcode=heap.alloc(4096,4096);
    // VLDR D8,[R0], BX LR, VSTR D8,[R0], BX LR
    for(const [i,n] of [0xed908b00,0xe12fff1e,0xed808b00,0xe12fff1e].entries())write(regcode+i*4,n);
    cpu.protect(regcode,4096,5);
    const d=heap.alloc(16);write(d,0x76543210);write(d+4,0xffeeddcc);
    cpu.setReg(14,end);cpu.setReg(0,d);cpu.run(regcode,{until:end});
    for(let n=4;n<=11;n++)cpu.setReg(n,n*100);cpu.setReg(13,0x68000000);cpu.setReg(0,buf);threads.unwindTop=0x20123200;
    cpu.run(j.save,{until:end});assert.equal(cpu.getReg(0),0);
    cpu.write(copy,cpu.read(buf,112));write(d,0);write(d+4,0);
    cpu.setReg(0,d);cpu.run(regcode,{until:end});
    cpu.setReg(4,0);cpu.setReg(13,0x65000000);
    threads.unwindTop=0;const transfer=j.longjmp(i=>[copy,0][i]);cpu.run(transfer.restore(cpu),{until:end});
    assert.equal(threads.unwindTop,0x20123200);assert.equal(cpu.getReg(4),400);assert.equal(cpu.getReg(13),0x68000000);assert.equal(cpu.getReg(0),1);
    cpu.setReg(0,d);cpu.run(regcode+8,{until:end});
    assert.equal(read32(cpu,d),0x76543210);assert.equal(read32(cpu,d+4),0xffeeddcc);
    threads.close();
  } finally {cpu.close();}
});

test('a worker dispatch_once block can wait for a mutex held by its scheduling main thread', async () => {
  const b = await readFile(new URL('./fixtures/dispatch-contention.ipa', import.meta.url));
  const ipa = await openIPA(new Blob([b]));
  const result = await runGuest(ipa, {signal: AbortSignal.timeout(2000)});
  assert.equal(result.exitStatus,0);
});
