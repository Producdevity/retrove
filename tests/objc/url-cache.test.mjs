import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('NSURLCache preserves copied response data, request identity and ownership across clearing',async t=>{
 const x=await fixture(t),pool=x.f('_objc_autoreleasePoolPush'),string=value=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
 const url=await x.send(x.cls('NSURL'),'URLWithString:',await string('https://example.test/a?q=1')),request=await x.send(x.cls('NSMutableURLRequest'),'requestWithURL:',url);
 const cache=await x.send(await x.send(x.cls('NSURLCache'),'alloc'),'initWithMemoryCapacity:diskCapacity:diskPath:',16,0,0);
 const response=await x.send(x.cls('NSURLResponse'),'new'),data=await x.send(x.cls('NSMutableData'),'dataWithLength:',3),pointer=await x.send(data,'mutableBytes');x.cpu.write(pointer,Uint8Array.of(1,2,3));
 const cached=await x.send(await x.send(x.cls('NSCachedURLResponse'),'alloc'),'initWithResponse:data:',response,data);
 await x.send(data,'setLength:',0);assert.equal(await x.send(await x.send(cached,'data'),'length'),3);
 await x.send(cache,'storeCachedResponse:forRequest:',cached,request);await x.send(cached,'release');
 assert.equal(await x.send(cache,'currentMemoryUsage'),3);const found=await x.send(cache,'cachedResponseForRequest:',await x.send(x.cls('NSURLRequest'),'requestWithURL:',url));assert.equal(found,cached);
 await x.send(request,'setHTTPMethod:',await string('POST'));assert.equal(await x.send(cache,'cachedResponseForRequest:',request),0);
 await x.send(cache,'removeAllCachedResponses');assert.equal(await x.send(cache,'currentMemoryUsage'),0);assert.equal(x.heap.live.has(cached),true);
 await x.f('_objc_autoreleasePoolPop',pool);assert.equal(x.heap.live.has(cached),false);await x.send(response,'release');await x.send(cache,'release');
});
test('shared NSURLCache can be replaced or disabled and rejects unsupported disk storage',async t=>{
 const x=await fixture(t),cls=x.cls('NSURLCache'),first=await x.send(cls,'sharedURLCache');assert.equal(await x.send(cls,'sharedURLCache'),first);
 await x.send(cls,'setSharedURLCache:',0);assert.equal(await x.send(cls,'sharedURLCache'),0);
 const cache=await x.send(cls,'new');await x.send(cls,'setSharedURLCache:',cache);await x.send(cache,'release');assert.equal(await x.send(cls,'sharedURLCache'),cache);
 await assert.rejects(()=>x.send(cache,'setDiskCapacity:',1),/Disk-backed/);assert.equal(await x.send(cache,'diskCapacity'),0);await x.send(cls,'setSharedURLCache:',0);
});
