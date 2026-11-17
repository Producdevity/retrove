import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../src/runtime/memory/guest-memory.ts';
test('NSString legacy URL escaping preserves query separators and handles encoding failures through Objective-C',async t=>{
 const x=await fixture(t),string=value=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
 const input=await string('https://example.test/a b?name=café&x=1#frag'),escaped=await x.send(input,'stringByAddingPercentEscapesUsingEncoding:',4);
 assert.equal(readString(x.cpu,await x.send(escaped,'UTF8String')),'https://example.test/a%20b?name=caf%C3%A9&x=1%23frag');
 const decoded=await x.send(escaped,'stringByReplacingPercentEscapesUsingEncoding:',4);assert.equal(readString(x.cpu,await x.send(decoded,'UTF8String')),readString(x.cpu,await x.send(input,'UTF8String')));
 assert.equal(await x.send(input,'stringByAddingPercentEscapesUsingEncoding:',1),0);assert.equal(await x.send(await string('%GG'),'stringByReplacingPercentEscapesUsingEncoding:',4),0);
});
