import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString,write32} from '../../web/memory.mjs';
async function files(t){
 const bytesByPath=new Map([['/Documents/utf8',new TextEncoder().encode('café 🎮')],['/Documents/latin',Uint8Array.of(0xe9)],['/Documents/empty',new Uint8Array()],['/Documents/bad',Uint8Array.of(0xc3,0x28)]]);
 let bytes,position=0,closes=0;
 const x=await fixture(t,()=>{},new Map(),(cpu,heap)=>{
  const errno=heap.zero(4);
  return {sys:{funcs:{___error:()=>errno,
   _open:a=>{bytes=bytesByPath.get(readString(cpu,a(0)));position=0;if(!bytes){write32(cpu,errno,2);return -1;}return 42;},
   _fstat:a=>{write32(cpu,a(1)+60,bytes.length);return 0;},
   _read:a=>{const chunk=bytes.subarray(position,position+a(2));cpu.write(a(1),chunk);position+=chunk.length;return chunk.length;},
   _close:()=>{closes++;return 0;}
  }}};
 });
 return {...x,closes:()=>closes,string:v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v)),decode:p=>readString(x.cpu,p)};
}
test('NSString file loading honors explicit encodings, empty files, mutable classes and success error-pointer ownership',async t=>{
 const x=await files(t),error=x.heap.zero(4);x.write(error,0x12345678);
 const value=await x.send(x.cls('NSMutableString'),'stringWithContentsOfFile:encoding:error:',await x.string('/Documents/utf8'),4,error);
 assert.equal(x.read(value),x.cls('NSMutableString'));assert.equal(x.decode(await x.send(value,'UTF8String')),'café 🎮');assert.equal(x.read(error),0x12345678);
 const latin=await x.send(x.cls('NSString'),'alloc');assert.equal(await x.send(latin,'initWithContentsOfFile:encoding:error:',await x.string('/Documents/latin'),5,error),latin);
 assert.equal(x.decode(await x.send(latin,'UTF8String')),'é');
 const empty=await x.send(x.cls('NSString'),'stringWithContentsOfFile:encoding:error:',await x.string('/Documents/empty'),4,error);assert.ok(empty);assert.equal(await x.send(empty,'length'),0);assert.equal(x.closes(),3);
});
test('NSString file loading reports Cocoa errors and releases failed initializers',async t=>{
 const x=await files(t),error=x.heap.zero(4),path=await x.string('/Documents/bad'),init=x.sel('initWithContentsOfFile:encoding:error:'),self=await x.send(x.cls('NSString'),'alloc');
 assert.equal(await x.f('_objc_msgSend',self,init,path,4,error),0);assert.equal(x.heap.live.has(self),false);
 const fault=x.read(error);assert.equal(await x.send(fault,'code'),261);assert.equal(x.decode(await x.send(await x.send(fault,'domain'),'UTF8String')),'NSCocoaErrorDomain');
 assert.equal(await x.send(x.cls('NSString'),'stringWithContentsOfFile:encoding:error:',await x.string('/Documents/missing'),4,error),0);assert.equal(await x.send(x.read(error),'code'),260);assert.equal(x.closes(),1);
});
