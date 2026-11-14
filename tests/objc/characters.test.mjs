import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('NSString character copies use UTF-16 code units without a terminator and validate ranges before writing',async t=>{
 const x=await fixture(t),string=await x.send(x.cls('NSMutableString'),'stringWithUTF8String:',x.heap.string('A😀é')),buffer=x.heap.alloc(16);
 x.cpu.write(buffer,new Uint8Array(16).fill(90));await x.send(string,'getCharacters:',buffer);
 assert.deepEqual([...x.cpu.read(buffer,10)],[65,0,61,216,0,222,233,0,90,90]);
 x.cpu.write(buffer,new Uint8Array(16).fill(90));await x.send(string,'getCharacters:range:',buffer,1,2);
 assert.deepEqual([...x.cpu.read(buffer,6)],[61,216,0,222,90,90]);assert.equal(await x.send(string,'characterAtIndex:',1),0xd83d);
 await assert.rejects(x.send(string,'getCharacters:range:',buffer,3,2),/outside bounds/);assert.deepEqual([...x.cpu.read(buffer,6)],[61,216,0,222,90,90]);
 await x.send(string,'getCharacters:range:',0,4,0);await assert.rejects(x.send(string,'getCharacters:',0),/output buffer/);
 x.heap.free(buffer);
});
test('large NSString character copies cross bounded chunks without losing surrogate units',async t=>{
 const x=await fixture(t),value='A😀é'.repeat(6000),string=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value)),bytes=Buffer.from(value,'utf16le'),out=x.heap.alloc(bytes.length+2);
 x.cpu.write(out+bytes.length,Uint8Array.of(90,90));await x.send(string,'getCharacters:',out);
 assert.deepEqual(x.cpu.read(out,bytes.length),new Uint8Array(bytes));assert.deepEqual([...x.cpu.read(out+bytes.length,2)],[90,90]);x.heap.free(out);
});

test('NSString character constructors copy raw UTF-16 including unpaired surrogates, embedded nulls and mutable class identity',async t=>{
 const x=await fixture(t),raw=Uint8Array.of(65,0,61,216,0,222,0,216,0,0),input=x.heap.alloc(raw.length),out=x.heap.alloc(raw.length+2);x.cpu.write(input,raw);
 const string=await x.send(x.cls('NSMutableString'),'stringWithCharacters:length:',input,5);x.cpu.write(input,new Uint8Array(raw.length));
 assert.equal(x.read(string),x.cls('NSMutableString'));assert.equal(await x.send(string,'length'),5);assert.equal(await x.send(string,'characterAtIndex:',3),0xd800);
 x.cpu.write(out+raw.length,Uint8Array.of(90,90));await x.send(string,'getCharacters:',out);assert.deepEqual(x.cpu.read(out,raw.length),raw);assert.deepEqual([...x.cpu.read(out+raw.length,2)],[90,90]);
 const empty=await x.send(x.cls('NSString'),'stringWithCharacters:length:',0,0);assert.ok(empty);assert.equal(await x.send(empty,'length'),0);
 x.cpu.write(input,raw);const receiver=await x.send(x.cls('NSString'),'alloc');assert.equal(await x.send(receiver,'initWithCharacters:length:',input,5),receiver);await x.send(receiver,'release');x.heap.free(input);x.heap.free(out);
});
