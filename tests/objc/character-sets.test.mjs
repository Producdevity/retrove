import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
test('mutable character-set ranges support JSON escapes and independent mutable and immutable copies',async t=>{
 const x=await fixture(t),pool=x.f('_objc_autoreleasePoolPush'),str=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const set=await x.send(x.cls('NSMutableCharacterSet'),'characterSetWithRange:',0,32);assert.equal(x.read(set),x.cls('NSMutableCharacterSet'));
 await x.send(set,'addCharactersInString:',await str('"\\'));
 for(const [c,expected] of [[0,1],[31,1],[32,0],[34,1],[92,1],[97,0]])assert.equal(await x.send(set,'characterIsMember:',c),expected);
 const immutable=await x.send(set,'copyWithZone:',0),mutable=await x.send(set,'mutableCopyWithZone:',0);assert.equal(x.read(immutable),x.cls('NSCharacterSet'));assert.equal(x.read(mutable),x.cls('NSMutableCharacterSet'));
 await x.send(set,'removeCharactersInRange:',0,32);await x.send(set,'removeCharactersInString:',await str('"'));
 assert.equal(await x.send(set,'characterIsMember:',31),0);assert.equal(await x.send(immutable,'characterIsMember:',31),1);assert.equal(await x.send(mutable,'characterIsMember:',34),1);
 await x.send(mutable,'invert');assert.equal(await x.send(mutable,'characterIsMember:',34),0);assert.equal(await x.send(immutable,'characterIsMember:',34),1);
 const emoji=await x.send(x.cls('NSCharacterSet'),'characterSetWithRange:',0x1f600,2);await x.send(set,'formUnionWithCharacterSet:',emoji);assert.equal(await x.send(set,'longCharacterIsMember:',0x1f601),1);
 await x.send(set,'formIntersectionWithCharacterSet:',emoji);assert.equal(await x.send(set,'characterIsMember:',92),0);assert.equal(await x.send(set,'longCharacterIsMember:',0x110000),0);
 await assert.rejects(x.send(x.cls('NSCharacterSet'),'characterSetWithRange:',0x10ffff,2),/Unicode/);
 await x.f('_objc_autoreleasePoolPop',pool);assert.equal(x.heap.live.has(set),false);assert.equal(await x.send(immutable,'characterIsMember:',34),1);await x.send(immutable,'release');await x.send(mutable,'release');
});
test('NSScanner copies a mutable skipped character set before later mutations',async t=>{
 const x=await fixture(t),str=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const set=await x.send(x.cls('NSMutableCharacterSet'),'characterSetWithCharactersInString:',await str('a')),scanner=await x.send(x.cls('NSScanner'),'scannerWithString:',await str('a42'));
 await x.send(scanner,'setCharactersToBeSkipped:',set);assert.notEqual(await x.send(scanner,'charactersToBeSkipped'),set);await x.send(set,'removeCharactersInString:',await str('a'));
 const out=x.heap.zero(4);assert.equal(await x.send(scanner,'scanInt:',out),1);assert.equal(x.read(out),42);x.heap.free(out);
});
