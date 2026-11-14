import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('native request headers copy dictionaries, preserve case-insensitive lookup and merge field updates',async t=>{
 const x=await fixture(t),pool=x.f('_objc_autoreleasePoolPush'),string=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const text=async p=>p ? readString(x.cpu,await x.send(p,'UTF8String')) : null;
 const url=await x.send(x.cls('NSURL'),'URLWithString:',await string('https://example.invalid/'));
 const request=await x.send(x.cls('NSMutableURLRequest'),'requestWithURL:',url);
 const headers=async()=>{
  const fields=await x.send(request,'allHTTPHeaderFields');if(!fields)return null;
  const keys=await x.send(fields,'allKeys'),out={};for(let i=0;i<await x.send(keys,'count');i++){
   const key=await x.send(keys,'objectAtIndex:',i);out[await text(key)]=await text(await x.send(fields,'objectForKey:',key));
  }return out;
 };
 const lookup=()=>x.send(request,'valueForHTTPHeaderField:',xKey).then(text),xKey=await string('x-CuStOm');
 assert.equal(await headers(),null);assert.equal(await lookup(),null);
 const dictionary=await x.send(x.cls('NSMutableDictionary'),'dictionary');
 await x.send(dictionary,'setObject:forKey:',await string('one'),await string('x-custom'));
 await x.send(dictionary,'setObject:forKey:',await string('image/png'),await string('content-type'));
 await x.send(request,'setAllHTTPHeaderFields:',dictionary);await x.send(dictionary,'removeAllObjects');
 assert.deepEqual(await headers(),{'Content-Type':'image/png','x-custom':'one'});assert.equal(await lookup(),'one');
 await x.send(request,'addValue:forHTTPHeaderField:',await string('two'),await string('X-CUSTOM'));
 assert.deepEqual(await headers(),{'Content-Type':'image/png','X-CUSTOM':'one,two'});
 await x.send(request,'setValue:forHTTPHeaderField:',await string('three'),await string('x-CUSTOM'));
 assert.deepEqual(await headers(),{'Content-Type':'image/png','x-CUSTOM':'three'});
 await x.send(request,'setValue:forHTTPHeaderField:',0,xKey);
 await x.send(request,'setAllHTTPHeaderFields:',dictionary);await x.send(request,'setAllHTTPHeaderFields:',0);
 assert.deepEqual(await headers(),{'Content-Type':'image/png'});assert.equal(await lookup(),null);
 await x.send(request,'retain');await x.f('_objc_autoreleasePoolPop',pool);assert.deepEqual(await headers(),{'Content-Type':'image/png'});
 await x.send(request,'release');assert.equal(x.heap.live.has(request),false);
});
