import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('layer convenience objects retain sublayers and detach without destroying external ownership',async t=>{
 const x=await fixture(t),pool=x.f('_objc_autoreleasePoolPush');
 const parent=await x.send(x.cls('CALayer'),'layer'),child=await x.send(x.cls('CALayer'),'layer');
 await x.send(child,'retain');
 await x.send(parent,'addSublayer:',child);
 assert.equal(await x.send(child,'superlayer'),parent);
 assert.equal(await x.send(await x.send(parent,'sublayers'),'count'),1);
 await x.send(child,'removeFromSuperlayer');
 assert.equal(await x.send(child,'superlayer'),0);
 await x.f('_objc_autoreleasePoolPop',pool);
 assert.equal(x.heap.live.has(parent),false);assert.equal(x.heap.live.has(child),true);
 await x.send(child,'release');assert.equal(x.heap.live.has(child),false);
});
