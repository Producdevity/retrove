import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString,write32} from '../../src/runtime/memory/guest-memory.ts';
const native={"100": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHBsaXN0IFBVQkxJQyAiLS8vQXBwbGUvL0RURCBQTElTVCAxLjAvL0VOIiAiaHR0cDovL3d3dy5hcHBsZS5jb20vRFREcy9Qcm9wZXJ0eUxpc3QtMS4wLmR0ZCI+CjxwbGlzdCB2ZXJzaW9uPSIxLjAiPgo8ZGljdD4KCTxrZXk+Y291bnQ8L2tleT4KCTxpbnRlZ2VyPjc8L2ludGVnZXI+Cgk8a2V5PmRhdGE8L2tleT4KCTxkYXRhPgoJQVFMLwoJPC9kYXRhPgoJPGtleT5kYXRlPC9rZXk+Cgk8ZGF0ZT4yMDAxLTAxLTAxVDAwOjAwOjEyWjwvZGF0ZT4KCTxrZXk+ZW5hYmxlZDwva2V5PgoJPHRydWUvPgoJPGtleT5uYW1lPC9rZXk+Cgk8c3RyaW5nPmNhZsOpPC9zdHJpbmc+Cgk8a2V5Pm5lc3RlZDwva2V5PgoJPGRpY3Q+CgkJPGtleT5pdGVtczwva2V5PgoJCTxhcnJheT4KCQkJPHN0cmluZz5vbmU8L3N0cmluZz4KCQkJPGludGVnZXI+MzwvaW50ZWdlcj4KCQk8L2FycmF5PgoJPC9kaWN0Pgo8L2RpY3Q+CjwvcGxpc3Q+Cg==", "200": "YnBsaXN0MDDWAQIDBAUGBwgJCgsMVGRhdGVUZGF0YVdlbmFibGVkVWNvdW50VG5hbWVWbmVzdGVkM0AoAAAAAAAAQwEC/wkQB2QAYwBhAGYA6dENDlVpdGVtc6IPEFNvbmUQAwgVGh8nLTI5QkZHSVJVW15iAAAAAAAAAQEAAAAAAAAAEQAAAAAAAAAAAAAAAAAAAGQ="};
async function files(t){
 const byPath=new Map(Object.entries(native).map(([format,base64])=>['/Documents/'+format,Buffer.from(base64,'base64')]));
 byPath.set('/Documents/bad',Buffer.from('bad'));byPath.set('/Documents/array',Buffer.from('<plist><array><string>wrong root</string></array></plist>'));
 let bytes,position=0,closes=0;
 const x=await fixture(t,()=>{},new Map(),(cpu,heap)=>{
  const errno=heap.zero(4);return {sys:{funcs:{___error:()=>errno,
   _open:a=>{bytes=byPath.get(readString(cpu,a(0)));position=0;if(!bytes){write32(cpu,errno,2);return -1;}return 42;},
   _fstat:a=>{write32(cpu,a(1)+60,bytes.length);return 0;},
   _read:a=>{const chunk=bytes.subarray(position,position+a(2));cpu.write(a(1),chunk);position+=chunk.length;return chunk.length;},
   _close:()=>{closes++;return 0;}
  }}};
 });
 return {...x,closes:()=>closes,string:v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v))};
}
test('native XML and binary property lists preserve nested values, data, dates and mutable receiver classes',async t=>{
 const x=await files(t);
 for(const format of Object.keys(native)){
  const pool=x.f('_objc_autoreleasePoolPush'),path=await x.string('/Documents/'+format);
  const root=await x.send(x.cls('NSMutableDictionary'),'dictionaryWithContentsOfFile:',path);
  assert.equal(x.read(root),x.cls('NSMutableDictionary'));assert.equal(await x.send(root,'count'),6);
  const entry=async key=>x.send(root,'objectForKey:',await x.string(key));
  assert.equal(readString(x.cpu,await x.send(await entry('name'),'UTF8String')),'café');
  assert.equal(await x.send(await entry('count'),'intValue'),7);assert.equal(await x.send(await entry('enabled'),'boolValue'),1);
  const nested=await x.send(await entry('nested'),'objectForKey:',await x.string('items'));assert.equal(await x.send(nested,'count'),2);
  const data=await entry('data'),date=await entry('date');assert.equal(await x.send(data,'length'),3);assert.deepEqual([...x.cpu.read(await x.send(data,'bytes'),3)],[1,2,255]);
  const bits=new DataView(new ArrayBuffer(8));bits.setBigUint64(0,await x.send(date,'timeIntervalSinceReferenceDate'),true);assert.equal(bits.getFloat64(0,true),12);
  await x.send(root,'setObject:forKey:',await x.string('new'),await x.string('extra'));assert.equal(await x.send(root,'count'),7);
  await x.send(root,'retain');await x.f('_objc_autoreleasePoolPop',pool);assert.equal(await x.send(data,'length'),3);
  await x.send(root,'release');assert.equal(x.heap.live.has(root),false);assert.equal(x.heap.live.has(data),false);
 }
 assert.equal(x.closes(),2);
});
test('dictionary file and URL initializers preserve receiver ownership and reject missing or non-dictionary files',async t=>{
 const x=await files(t),path=await x.string('/Documents/100'),self=await x.send(x.cls('NSDictionary'),'alloc');
 assert.equal(await x.send(self,'initWithContentsOfFile:',path),self);assert.equal(await x.send(self,'count'),6);await x.send(self,'release');
 const url=await x.send(x.cls('NSURL'),'fileURLWithPath:',path),dictionary=await x.send(x.cls('NSMutableDictionary'),'dictionaryWithContentsOfURL:',url);assert.equal(x.read(dictionary),x.cls('NSMutableDictionary'));
 for(const file of ['missing','bad','array']){
  const input=await x.string('/Documents/'+file);assert.equal(await x.send(x.cls('NSDictionary'),'dictionaryWithContentsOfFile:',input),0);
  const receiver=await x.send(x.cls('NSDictionary'),'alloc');assert.equal(await x.send(receiver,'initWithContentsOfFile:',input),0);assert.equal(x.heap.live.has(receiver),false);
 }
 const remote=await x.send(x.cls('NSURL'),'URLWithString:',await x.string('https://example.invalid/no-plist'));
 assert.equal(await x.send(x.cls('NSDictionary'),'dictionaryWithContentsOfURL:',remote),0);
});
