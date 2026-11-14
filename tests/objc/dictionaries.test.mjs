import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('NSDictionary array construction copies keys, retains values and keeps the source arrays independent',async t=>{
 const x=await fixture(t),key=await x.send(x.cls('NSMutableString'),'stringWithUTF8String:',x.heap.string('score'));
 const value=await x.send(x.cls('NSObject'),'new'),keys=await x.send(x.cls('NSMutableArray'),'arrayWithObject:',key),values=await x.send(x.cls('NSMutableArray'),'arrayWithObject:',value);
 const dictionary=await x.send(x.cls('NSMutableDictionary'),'dictionaryWithObjects:forKeys:',values,keys);
 assert.equal(x.read(dictionary),x.cls('NSMutableDictionary'));assert.equal(await x.send(dictionary,'count'),1);
 await x.send(keys,'removeAllObjects');await x.send(values,'removeAllObjects');await x.send(value,'release');
 await x.send(key,'appendString:',await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('-changed')));
 const stored=await x.send(await x.send(dictionary,'allKeys'),'objectAtIndex:',0);
 assert.equal(readString(x.cpu,await x.send(stored,'UTF8String')),'score');assert.notEqual(stored,key);
 assert.equal(await x.send(dictionary,'objectForKey:',stored),value);assert.equal(await x.send(value,'class'),x.cls('NSObject'));
});
test('NSDictionary array construction rejects unequal lengths before copying keys or publishing a result',async t=>{
 const x=await fixture(t),empty=await x.send(x.cls('NSArray'),'array'),keys=await x.send(x.cls('NSArray'),'arrayWithObject:',await x.send(x.cls('NSObject'),'new'));
 const selector=x.sel('dictionaryWithObjects:forKeys:'),before=x.heap.live.size;
 await assert.rejects(()=>x.f('_objc_msgSend',x.cls('NSDictionary'),selector,empty,keys),/counts differ/);assert.equal(x.heap.live.size,before);
});


test('NSMutableDictionary capacity initialization preserves identity and owns only inserted contents',async t=>{
 const x=await fixture(t),self=await x.send(x.cls('NSMutableDictionary'),'alloc');
 assert.equal(await x.send(self,'initWithCapacity:',0xffffffff),self);assert.equal(await x.send(self,'count'),0);
 const key=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('score')),value=await x.send(x.cls('NSObject'),'new');
 await x.send(self,'setObject:forKey:',value,key);await x.send(value,'release');assert.equal(await x.send(self,'objectForKey:',key),value);assert.equal(await x.send(value,'retainCount'),1);
 const release=x.sel('release');await x.f('_objc_msgSend',self,release);assert.equal(x.heap.live.has(value),false);assert.equal(x.heap.live.has(self),false);
});
