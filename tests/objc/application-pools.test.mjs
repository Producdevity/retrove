import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('UIApplication launch drains its own temporary objects before the event loop and preserves the caller pool',async t=>{
 let x,temporary,held,observed;
 x=await fixture(t,async pc=>{
  assert.equal(pc,0x6900);temporary=await x.send(x.cls('NSObject'),'new');await x.send(temporary,'autorelease');
  held=await x.send(x.cls('NSObject'),'new');await x.send(held,'autorelease');await x.send(held,'retain');return 1;
 },new Map(),{onLifecycle:phase=>{if(phase==='UIKit event loop')observed={temporaryAlive:x.heap.live.has(temporary)};}});
 const pool=x.f('_objc_autoreleasePoolPush'),outer=await x.send(x.cls('NSObject'),'new');await x.send(outer,'autorelease');
 const klass=x.instance('LaunchPoolApp',[['application:didFinishLaunchingWithOptions:',0x6900]]);x.install({'__objc_classlist':[klass]});
 const name=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('LaunchPoolApp'));
 await assert.rejects(x.f('_UIApplicationMain',0,0,0,name),/without a supported event source/);
 assert.deepEqual(observed,{temporaryAlive:false});assert.equal(await x.send(held,'retainCount'),1);assert.equal(x.heap.live.has(outer),true);
 await x.send(held,'release');await x.f('_objc_autoreleasePoolPop',pool);assert.equal(x.heap.live.has(outer),false);
});
test('failed launch callbacks drain their temporary objects before propagating the original exception',async t=>{
 let x,temporary;
 x=await fixture(t,async()=>{temporary=await x.send(x.cls('NSObject'),'new');await x.send(temporary,'autorelease');throw Error('Launch failure sentinel');});
 const pool=x.f('_objc_autoreleasePoolPush'),klass=x.instance('FailedLaunchPoolApp',[['application:didFinishLaunchingWithOptions:',0x6910]]);x.install({'__objc_classlist':[klass]});
 const name=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('FailedLaunchPoolApp'));
 await assert.rejects(x.f('_UIApplicationMain',0,0,0,name),/Launch failure sentinel/);assert.equal(x.heap.live.has(temporary),false);await x.f('_objc_autoreleasePoolPop',pool);
});
