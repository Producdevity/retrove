import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
const args=(...values)=>index=>values[index]??0;
test('method implementation lookup preserves guest inheritance and custom button initializers',async t=>{
 const calls=[],x=await fixture(t,(pc,values)=>{calls.push([pc,...values]);return values[0];});
 const custom=x.instance('CustomButton',[['init',0x5201],['customAction:',0x5301]],[],x.cls('UIButton'));
 x.install({'__objc_classlist':[custom]});
 const button=await x.send(custom,'buttonWithType:',0);
 assert.equal(x.read(button),custom);
 assert.equal(calls[0][0],0x5201);
 assert.equal(await x.send(custom,'instanceMethodForSelector:',x.sel('customAction:')),0x5301);
 assert.equal(await x.send(button,'methodForSelector:',x.sel('customAction:')),0x5301);
 await x.send(button,'retain');await x.send(button,'release');
});
test('host IMPs are stable and adapt scalar and structure-return register arguments',async t=>{
 const gates=new Map();let next=0x41000000;
 const x=await fixture(t,()=>{},new Map(),{hostGate:(_info,callback)=>{const pointer=next;next+=4;gates.set(pointer,callback);return pointer;}});
 const object=await x.send(x.cls('NSObject'),'alloc');
 const scalar=await x.send(object,'methodForSelector:',x.sel('isEqual:'));
 assert.equal(await x.send(object,'methodForSelector:',x.sel('isEqual:')),scalar);
 assert.equal(await gates.get(scalar)(args(object,x.sel('isEqual:'),object)),1);
 const view=await x.send(x.cls('UIView'),'alloc'),out=x.heap.zero(16);
 const floats=new Uint32Array(new Float32Array([2,3,40,50]).buffer);
 await x.send(view,'setFrame:',...floats);
 const rect=await x.send(x.cls('UIView'),'instanceMethodForSelector:',x.sel('frame'));
 assert.equal(await gates.get(rect)(args(out,view,x.sel('frame'))),out);
 assert.deepEqual(x.cpu.read(out,16),new Uint8Array(floats.buffer));
});
