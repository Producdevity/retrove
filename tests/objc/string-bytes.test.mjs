import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('NSString byte constructors decode exact ranges, consume transferred storage, and preserve borrowed storage',async t=>{
 const x=await fixture(t);
 for(const transfer of [false,true]){
  const bytes=Uint8Array.of(0x63,0x61,0x66,0xc3,0xa9,0x21),input=x.heap.alloc(bytes.length);x.cpu.write(input,bytes);
  const receiver=await x.send(x.cls('NSMutableString'),'alloc');assert.equal(await x.send(receiver,'initWithBytesNoCopy:length:encoding:freeWhenDone:',input,bytes.length-1,4,Number(transfer)),receiver);
  assert.equal(x.read(receiver),x.cls('NSMutableString'));assert.equal(x.heap.live.has(input),!transfer);assert.equal(readString(x.cpu,await x.send(receiver,'UTF8String')),'café');
  await x.send(receiver,'release');if(!transfer)x.heap.free(input);
 }
 const empty=await x.send(x.cls('NSString'),'alloc');assert.equal(await x.send(empty,'initWithBytesNoCopy:length:encoding:freeWhenDone:',0,0,4,1),empty);assert.equal(await x.send(empty,'length'),0);await x.send(empty,'release');
});
test('failed NSString byte decoding returns nil and releases both receiver and transferred bytes',async t=>{
 const x=await fixture(t),input=x.heap.alloc(1),receiver=await x.send(x.cls('NSString'),'alloc');x.cpu.write(input,Uint8Array.of(0xff));
 assert.equal(await x.send(receiver,'initWithBytesNoCopy:length:encoding:freeWhenDone:',input,1,4,1),0);assert.equal(x.heap.live.has(receiver),false);assert.equal(x.heap.live.has(input),false);
 const source=x.heap.string('hello'),ordinary=await x.send(x.cls('NSString'),'alloc');await x.send(ordinary,'initWithBytes:length:encoding:',source,5,4);assert.equal(x.heap.live.has(source),true);await x.send(ordinary,'release');x.heap.free(source);
});

test('empty NSString factories and initializers allocate real storage and preserve mutable subclasses',async t=>{
 const x=await fixture(t);for(const name of ['NSString','NSMutableString']){for(const selector of ['new','string']){const pointer=await x.send(x.cls(name),selector);assert.equal(x.read(pointer),x.cls(name));assert.equal(await x.send(pointer,'length'),0);assert.equal(readString(x.cpu,await x.send(pointer,'UTF8String')),'');if(name==='NSMutableString'){await x.send(pointer,'appendString:',await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('ab')));assert.equal(await x.send(pointer,'length'),2);}if(selector==='new')await x.send(pointer,'release');}}
});
