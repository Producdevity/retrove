import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
function words(value){const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value,true);return [view.getUint32(0,true),view.getUint32(4,true)];}
function number(bits){const view=new DataView(new ArrayBuffer(8));view.setBigUint64(0,bits,true);return view.getFloat64(0,true);}
test('request constructors preserve native option defaults and double precision timeout ABI',async t=>{
 const x=await fixture(t),string=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const url=await x.send(x.cls('NSURL'),'URLWithString:',await string('https://example.invalid/'));
 const initial=await x.send(x.cls('NSMutableURLRequest'),'requestWithURL:',url);
 assert.equal(await x.send(initial,'cachePolicy'),0);assert.equal(number(await x.send(initial,'timeoutInterval')),60);
 assert.equal(await x.send(initial,'HTTPShouldHandleCookies'),1);assert.equal(await x.send(initial,'HTTPShouldUsePipelining'),0);
 const request=await x.send(x.cls('NSMutableURLRequest'),'requestWithURL:cachePolicy:timeoutInterval:',url,4,...words(7.25));
 assert.equal(await x.send(request,'cachePolicy'),4);assert.equal(number(await x.send(request,'timeoutInterval')),7.25);
 assert.equal(await x.send(request,'URL'),url);assert.equal(number(await x.send(initial,'timeoutInterval')),60);
 for(const value of [0,-1,15.125]){await x.send(request,'setTimeoutInterval:',...words(value));assert.equal(number(await x.send(request,'timeoutInterval')),value);}
 await x.send(request,'setCachePolicy:',3);assert.equal(await x.send(request,'cachePolicy'),3);
 await x.send(request,'setHTTPShouldHandleCookies:',0);await x.send(request,'setHTTPShouldUsePipelining:',1);
 assert.equal(await x.send(request,'HTTPShouldHandleCookies'),0);assert.equal(await x.send(request,'HTTPShouldUsePipelining'),1);
 const receiver=await x.send(x.cls('NSMutableURLRequest'),'alloc');assert.equal(await x.send(receiver,'initWithURL:cachePolicy:timeoutInterval:',url,2,...words(30.125)),receiver);
 assert.equal(number(await x.send(receiver,'timeoutInterval')),30.125);await x.send(receiver,'release');assert.equal(x.heap.live.has(receiver),false);
});
