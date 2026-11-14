import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('Core Animation transaction groups restore nested duration and action state per thread',async t=>{
 let thread=1;const x=await fixture(t,undefined,new Map(),{threads:{funcs:{_pthread_self:()=>thread}}}),cls=x.cls('CATransaction');
 const duration=async()=>{const bytes=new DataView(new ArrayBuffer(8));bytes.setBigUint64(0,await x.send(cls,'animationDuration'),true);return bytes.getFloat64(0,true);};
 assert.equal(await duration(),.25);await x.send(cls,'begin');await x.send(cls,'setDisableActions:',1);
 const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,.5,true);await x.send(cls,'setAnimationDuration:',bits.getUint32(0,true),bits.getUint32(4,true));
 await x.send(cls,'begin');await x.send(cls,'setDisableActions:',0);await x.send(cls,'commit');assert.equal(await x.send(cls,'disableActions'),1);assert.equal(await duration(),.5);
 thread=2;assert.equal(await x.send(cls,'disableActions'),0);assert.equal(await duration(),.25);
 thread=1;await x.send(cls,'commit');assert.equal(await x.send(cls,'disableActions'),0);assert.equal(await duration(),.25);
});
