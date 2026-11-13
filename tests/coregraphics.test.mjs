import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {coreGraphics} from '../web/coregraphics.mjs';

const args=(...words)=>i=>words[i]??0;
function fixture(raw=new Uint8Array(0)) {
  let next=1024, refs=1, thread=3;
  const cpu={read:(p,n)=>raw.slice(p,p+n)}, live=new Set();
  const heap={zero:()=>{next+=4;live.add(next);return next;},free:p=>assert.ok(live.delete(p))};
  const objc={funcs:{_CFDataGetLength:()=>raw.length,_CFDataGetBytePtr:()=>0},retainObject:()=>refs++,
    releaseObject:()=>refs--,currentThreadId:()=>thread};
  return {cg:coreGraphics(cpu,heap,objc),refs:()=>refs,live,select:id=>{thread=id;}};
}
test('a Quartz image retains its provider, honors guest row stride and unpremultiplies BGRA',async()=>{
  const input=Uint8Array.of(0,0,128,128,9,9,9,9,16,32,48,255);
  const {cg,live,refs}=fixture(input),f=cg.funcs;
  const color=f._CGColorSpaceCreateDeviceRGB(),provider=f._CGDataProviderCreateWithCFData(args(3));
  const image=f._CGImageCreate(args(1,2,8,32,8,color,0x2002,provider,0,1,0));
  assert.ok(image);
  await f._CGDataProviderRelease(args(provider));await f._CGColorSpaceRelease(args(color));
  assert.equal(refs(),2);
  assert.deepEqual([...cg.pixels(image).rgba],[255,0,0,128,48,32,16,255]);
  assert.equal(f._CGImageGetHeight(args(image)),2);
  assert.equal(f._CGImageCreate(args(1,3,8,32,8,color,0x2002,provider,0,1,0)),0);
  await f._CGImageRelease(args(image));assert.equal(refs(),1);assert.equal(live.size,0);
});
test('drawing contexts restore unbalanced guest state and remain local to each guest thread',async()=>{
  const {cg,live,select}=fixture(), calls=[];
  const canvas=new Proxy({},{get:(_,name)=>(...params)=>calls.push([name,...params])});
  const f=cg.funcs;
  assert.equal(f._UIGraphicsGetCurrentContext(),0);
  await cg.withContext(canvas,async()=>{
    const outer=f._UIGraphicsGetCurrentContext();
    select(4);assert.equal(f._UIGraphicsGetCurrentContext(),0);
    select(3);await cg.withContext(canvas,async()=>{
      const inner=f._UIGraphicsGetCurrentContext();
      assert.notEqual(inner,outer);
      f._CGContextSaveGState(args(inner));f._CGContextDrawPath(args(inner,4));
    });
    assert.equal(f._UIGraphicsGetCurrentContext(),outer);
  });
  assert.deepEqual(calls,[['save'],['save'],['save'],['fill','evenodd'],['stroke'],['beginPath'],['restore'],['restore'],['restore']]);
  assert.equal(live.size,0);
});
