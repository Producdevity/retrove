import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../src/runtime/memory/guest-memory.ts';
test('EAGL preserves the requested API and current-context lifetime for ES1 and ES2',async t=>{
 const x=await fixture(t);const contexts=[];
 const selectors=new Map(["alloc","initWithAPI:","API","setCurrentContext:","release","UTF8String"].map(name=>[name,x.sel(name)]));
 const send=(self,name,...args)=>{const selector=selectors.get(name);assert.ok(selector);return x.f('_objc_msgSend',self,selector,...args);};
 for(const api of [1,2]){
  const object=await send(x.cls('EAGLContext'),'alloc');
  contexts.push(await send(object,'initWithAPI:',api));
  assert.equal(await send(object,'API'),api);
  assert.equal(await send(x.cls('EAGLContext'),'setCurrentContext:',object),1);
  assert.equal(x.objc.graphicsAPI(),api);assert.equal(x.objc.graphicsContext(),object);
  await send(object,'release');assert.ok(x.heap.live.has(object));
 }
 assert.equal(x.heap.live.has(contexts[0]),false);
 await send(x.cls('EAGLContext'),'setCurrentContext:',0);
 assert.equal(x.heap.live.has(contexts[1]),false);
 const symbol=x.objc.resolveData('_kEAGLColorFormatRGB565');
 assert.equal(readString(x.cpu,await send(x.read(symbol),'UTF8String')),'RGB565');
});


test('legacy and animated status-bar setters share the application orientation',async t=>{
 const x=await fixture(t),application=await x.send(x.cls('UIApplication'),'new');
 await x.send(application,'setStatusBarOrientation:',3);assert.equal(await x.send(application,'statusBarOrientation'),3);
 await x.send(application,'setStatusBarOrientation:animated:',4,1);assert.equal(await x.send(application,'statusBarOrientation'),4);
});
