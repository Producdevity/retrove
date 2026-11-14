import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';

test('dictionary fast enumeration yields keys in bounded batches and exposes mutations',async t=>{
  const x=await fixture(t),dictionary=await x.send(x.cls('NSMutableDictionary'),'new');
  const string=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
  const value=await string('value');
  for(const key of ['a','b','c'])await x.send(dictionary,'setObject:forKey:',value,await string(key));
  const state=x.heap.zero(32),buffer=x.heap.zero(12);x.write(buffer+8,0xcafebabe);
  const next=()=>x.send(dictionary,'countByEnumeratingWithState:objects:count:',state,buffer,2);
  assert.equal(await next(),2);assert.equal(x.read(state+4),buffer);assert.equal(x.read(buffer+8),0xcafebabe);
  const keys=[];
  for(let i=0;i<2;i++)keys.push(readString(x.cpu,await x.send(x.read(buffer+i*4),'UTF8String')));
  assert.equal(await next(),1);keys.push(readString(x.cpu,await x.send(x.read(buffer),'UTF8String')));
  assert.equal(await next(),0);assert.deepEqual(keys.sort(),['a','b','c']);
  const mutation=x.read(state+8),before=x.read(mutation);
  await x.send(dictionary,'setObject:forKey:',value,await string('d'));
  assert.notEqual(x.read(mutation),before);
  await x.send(dictionary,'release');assert.equal(x.heap.live.has(mutation),false);
});

test('NSString character-set search returns an ARM32 NSRange through objc_msgSend_stret',async t=>{
 const x=await fixture(t),str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
 const value=await str('a🎮bx'),set=await x.send(x.cls('NSCharacterSet'),'characterSetWithCharactersInString:',await str('🎮x'));
 const range=x.heap.zero(12);x.write(range+8,0xcafebabe);
 await x.f('_objc_msgSend_stret',range,value,x.sel('rangeOfCharacterFromSet:'),set);
 assert.equal(x.read(range),1);assert.equal(x.read(range+4),2);assert.equal(x.read(range+8),0xcafebabe);
});
