import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';

test('Foundation locks contend across guest threads and resume the original waiter',async t=>{
  let thread=1;
  const x=await fixture(t,()=>{},new Map(),{threads:{funcs:{_pthread_self:()=>thread}}});
  const lock=await x.send(x.cls('NSLock'),'new');
  assert.equal(await x.send(lock,'tryLock'),1);
  assert.equal(await x.send(lock,'tryLock'),0);
  thread=2;
  assert.equal(await x.send(lock,'tryLock'),0);
  const waiting=await x.send(lock,'lock');
  assert.equal(waiting.wait(),undefined);
  await assert.rejects(x.send(lock,'unlock'),/lock operation failed/);
  thread=1;await x.send(lock,'unlock');
  assert.equal(waiting.wait(),0);
  await assert.rejects(x.send(lock,'unlock'),/lock operation failed/);
  thread=2;await x.send(lock,'unlock');await x.send(lock,'release');
});
test('recursive Foundation locks require balanced unlocks',async t=>{
  let thread=1;
  const x=await fixture(t,()=>{},new Map(),{threads:{funcs:{_pthread_self:()=>thread}}});
  const lock=await x.send(x.cls('NSRecursiveLock'),'new');
  assert.equal(await x.send(lock,'tryLock'),1);assert.equal(await x.send(lock,'tryLock'),1);
  await x.send(lock,'unlock');thread=2;assert.equal(await x.send(lock,'tryLock'),0);
  thread=1;await x.send(lock,'unlock');thread=2;assert.equal(await x.send(lock,'tryLock'),1);
  await x.send(lock,'unlock');await x.send(lock,'release');
});
test('Foundation timed locks report expiration when contended',async t=>{
  let thread=1;
  const x=await fixture(t,()=>{},new Map(),{threads:{funcs:{_pthread_self:()=>thread}}});
  const lock=await x.send(x.cls('NSLock'),'new');await x.send(lock,'lock');thread=2;
  const past=await x.send(x.cls('NSDate'),'distantPast');
  assert.equal(await x.send(lock,'lockBeforeDate:',past),0);
  thread=1;await x.send(lock,'unlock');await x.send(lock,'release');
});
