import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
const bits=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const floats=(x,p,n)=>[...new Float32Array(x.cpu.read(p,n*4).buffer)];
test('layer anchor changes preserve position and geometry changes reach backing views',async t=>{
 const x=await fixture(t),layer=await x.send(x.cls('CALayer'),'layer'),out=x.heap.zero(16);
 await x.send(layer,'setFrame:',...[20,30,100,60].map(bits));await x.send(layer,'setAnchorPoint:',bits(0),bits(0));
 await x.f('_objc_msgSend_stret',out,layer,x.sel('position'));assert.deepEqual(floats(x,out,2),[70,60]);
 await x.f('_objc_msgSend_stret',out,layer,x.sel('frame'));assert.deepEqual(floats(x,out,4),[70,60,100,60]);
 const view=await x.send(x.cls('UIView'),'new');await x.send(view,'setFrame:',...[20,30,100,60].map(bits));const backing=await x.send(view,'layer');
 await x.send(backing,'setAnchorPoint:',bits(0),bits(0));await x.f('_objc_msgSend_stret',out,view,x.sel('center'));assert.deepEqual(floats(x,out,2),[70,60]);
 await x.send(backing,'setPosition:',bits(90),bits(80));await x.f('_objc_msgSend_stret',out,view,x.sel('frame'));assert.deepEqual(floats(x,out,4),[90,80,100,60]);
 await x.send(view,'release');await x.send(layer,'release');x.heap.free(out);
});
test('layer contents retain images, release replacement images and reject unsupported pointers',async t=>{
 const x=await fixture(t),references=new Map([[100,1],[200,1]]);
 x.objc.attachCoreGraphics({pixels:p=>references.has(p)?{}:undefined,retain:p=>references.set(p,references.get(p)+1),release:async p=>references.set(p,references.get(p)-1)});
 const layer=await x.send(x.cls('CALayer'),'layer');await x.send(layer,'setContents:',100);assert.equal(references.get(100),2);
 await x.send(layer,'setContents:',200);assert.equal(references.get(100),1);assert.equal(references.get(200),2);
 await assert.rejects(()=>x.send(layer,'setContents:',999),/Unsupported CALayer/);assert.equal(await x.send(layer,'contents'),200);
 await x.send(layer,'release');assert.equal(references.get(200),1);
});
