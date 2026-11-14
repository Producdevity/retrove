import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('NSMutableString replacement uses the ARM32 range ABI, returns a count and invalidates encoded bytes',async t=>{
 const x=await fixture(t),string=value=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
 const self=await x.send(x.cls('NSMutableString'),'stringWithUTF8String:',x.heap.string('aa🌟aa🌟aa'));
 await x.send(self,'UTF8String');const target=await string('aa'),replacement=await string('$&');
 assert.equal(await x.send(self,'replaceOccurrencesOfString:withString:options:range:',target,replacement,0,2,8),2);
 assert.equal(readString(x.cpu,await x.send(self,'UTF8String')),'aa🌟$&🌟$&');
 await x.send(self,'replaceCharactersInRange:withString:',2,2,await string('X'));
 assert.equal(readString(x.cpu,await x.send(self,'UTF8String')),'aaX$&🌟$&');
});
test('NSString replacement returns immutable strings and validates ranges without changing mutable receivers',async t=>{
 const x=await fixture(t),string=value=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
 const self=await x.send(x.cls('NSMutableString'),'stringWithUTF8String:',x.heap.string('banana')),target=await string('ana'),replacement=await string('X');
 const copy=await x.send(self,'stringByReplacingOccurrencesOfString:withString:options:range:',target,replacement,4,0,6);
 assert.equal(x.read(copy),x.cls('NSString'));assert.equal(readString(x.cpu,await x.send(copy,'UTF8String')),'banX');
 await assert.rejects(()=>x.send(self,'replaceOccurrencesOfString:withString:options:range:',target,replacement,0,7,0),/range/);
 assert.equal(readString(x.cpu,await x.send(self,'UTF8String')),'banana');
});
