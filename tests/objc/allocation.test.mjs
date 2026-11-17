import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../src/runtime/memory/guest-memory.ts';
test('NSObject alloc and new honor an inherited guest allocWithZone override and its returned singleton',async t=>{
 let singleton=0,child=0;const calls=[];
 const x=await fixture(t,async(pc,args)=>{
  calls.push([pc,...args]);
  if(pc===0x5010){
   assert.equal(args[0],child);assert.equal(readString(x.cpu,args[1]),'allocWithZone:');assert.equal(args[2],0);
   if(!singleton){const sup=x.heap.zero(8);x.write(sup,child);x.write(sup+4,x.read(base));singleton=await x.f('_objc_msgSendSuper2',sup,x.sel('allocWithZone:'),0);}
   return singleton;
  }
  if(pc===0x5020)return args[0];
  throw Error('Unexpected guest IMP '+pc);
 });
 const base=x.instance('SingletonAllocator',[],[['allocWithZone:',0x5010]]);
 child=x.instance('SingletonChild',[['init',0x5020]],[],base);x.install({'__objc_classlist':[base,child]});
 const object=await x.send(child,'alloc');assert.ok(object);assert.equal(x.read(object),child);
 assert.equal(await x.send(child,'new'),object);assert.deepEqual(await x.send(child,'allocWithZone:',0),{jump:0x5010});
 assert.deepEqual(calls.map(c=>c[0]),[0x5010,0x5010,0x5020]);
});
test('default allocation still constructs each guest class once in superclass order',async t=>{
 const calls=[],x=await fixture(t,(pc,args)=>{calls.push([pc,args[0]]);return args[0];});
 const base=x.instance('ConstructedBase',[['.cxx_construct',0x6010]]),child=x.instance('ConstructedChild',[['.cxx_construct',0x6020]],[],base);
 x.install({'__objc_classlist':[base,child]});const self=await x.send(child,'new');
 assert.equal(x.read(self),child);assert.deepEqual(calls,[[0x6010,self],[0x6020,self]]);
});
