import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('NSArray additions copy their contents, own the added objects and preserve both input arrays',async t=>{
 const x=await fixture(t),pool=await x.send(await x.send(x.cls('NSAutoreleasePool'),'alloc'),'init');
 const first=await x.send(x.cls('NSObject'),'new'),second=await x.send(x.cls('NSObject'),'new');
 const source=await x.send(x.cls('NSMutableArray'),'arrayWithObject:',first);
 const appended=await x.send(source,'arrayByAddingObject:',second);await x.send(appended,'retain');
 const combined=await x.send(source,'arrayByAddingObjectsFromArray:',appended);
 assert.equal(await x.send(combined,'count'),3);assert.equal(await x.send(combined,'objectAtIndex:',1),first);
 assert.equal(await x.send(combined,'objectAtIndex:',2),second);assert.equal(await x.send(source,'count'),1);
 await x.send(source,'removeAllObjects');assert.equal(await x.send(appended,'count'),2);
 await x.send(first,'release');await x.send(second,'release');await x.send(pool,'drain');
 assert.equal(x.read(appended),x.cls('NSArray'));assert.ok(x.heap.live.has(first));assert.ok(x.heap.live.has(second));
 const release=x.sel('release');await x.f('_objc_msgSend',appended,release);assert.equal(x.heap.live.has(first),false);assert.equal(x.heap.live.has(second),false);
});
test('NSArray rejects nil additions before creating another owned array',async t=>{
 const x=await fixture(t),array=await x.send(x.cls('NSArray'),'array'),selector=x.sel('arrayByAddingObject:'),before=x.heap.live.size;
 await assert.rejects(()=>x.f('_objc_msgSend',array,selector,0),/nil/);assert.equal(x.heap.live.size,before);
});


test('mutable array and set capacity initializers retain inserted objects without allocating the reservation',async t=>{
 const x=await fixture(t);
 for(const name of ['NSMutableArray','NSMutableSet']){
  const self=await x.send(x.cls(name),'alloc');assert.equal(await x.send(self,'initWithCapacity:',0xffffffff),self);assert.equal(await x.send(self,'count'),0);
  const object=await x.send(x.cls('NSObject'),'new');await x.send(self,'addObject:',object);await x.send(object,'release');
  assert.equal(await x.send(self,'count'),1);assert.equal(await x.send(object,'retainCount'),1);const release=x.sel('release');await x.f('_objc_msgSend',self,release);assert.equal(x.heap.live.has(object),false);
 }
});
