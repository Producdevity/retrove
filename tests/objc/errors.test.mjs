import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('NSError copies its domain and user info and retains error metadata through the caller pool',async t=>{
 const x=await fixture(t),pool=x.f('_objc_autoreleasePoolPush'),str=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const domain=await x.send(x.cls('NSMutableString'),'stringWithString:',await str('AppDomain'));
 const info=await x.send(x.cls('NSMutableDictionary'),'dictionary');
 await x.send(info,'setObject:forKey:',await str('Broken resource'),await str('NSLocalizedDescription'));
 await x.send(info,'setObject:forKey:',await str('Try another file'),await str('NSLocalizedRecoverySuggestion'));
 const error=await x.send(x.cls('NSError'),'errorWithDomain:code:userInfo:',domain,-42,info);
 await x.send(domain,'appendString:',await str('changed'));await x.send(info,'removeAllObjects');
 const text=async p=>readString(x.cpu,await x.send(p,'UTF8String'));
 assert.equal(await x.send(error,'code'),-42);assert.equal(await text(await x.send(error,'domain')),'AppDomain');
 assert.equal(await text(await x.send(error,'localizedDescription')),'Broken resource');
 assert.equal(await text(await x.send(error,'localizedRecoverySuggestion')),'Try another file');assert.equal(await x.send(error,'localizedFailureReason'),0);
 const metadata=await x.send(error,'userInfo');assert.equal(x.read(metadata),x.cls('NSDictionary'));assert.equal(await x.send(metadata,'count'),2);
 await x.send(error,'retain');await x.f('_objc_autoreleasePoolPop',pool);assert.equal(await text(await x.send(error,'localizedDescription')),'Broken resource');
 const copy=await x.send(error,'copy');assert.equal(copy,error);await x.send(copy,'release');await x.send(error,'release');assert.equal(x.heap.live.has(metadata),false);assert.equal(x.heap.live.has(error),false);
});
test('NSError initializers keep signed codes, empty user info and explicit invalid domain failure',async t=>{
 const x=await fixture(t),domain=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('NSURLErrorDomain'));
 const error=await x.send(x.cls('NSError'),'alloc');assert.equal(await x.send(error,'initWithDomain:code:userInfo:',domain,-1009,0),error);
 assert.equal(await x.send(error,'code'),-1009);assert.equal(await x.send(await x.send(error,'userInfo'),'count'),0);
 assert.equal(readString(x.cpu,await x.send(await x.send(error,'localizedDescription'),'UTF8String')),'The internet connection appears to be offline.');await x.send(error,'release');
 await assert.rejects(x.send(x.cls('NSError'),'errorWithDomain:code:userInfo:',0,1,0),/non-nil domain/);
});
