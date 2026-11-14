import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
const bits=new DataView(new ArrayBuffer(8));
function words(value){bits.setFloat64(0,value,true);return [bits.getUint32(0,true),bits.getUint32(4,true)];}
function decoded(value){bits.setBigUint64(0,value,true);return bits.getFloat64(0,true);}
test('NSDate epoch constructors round-trip fractional doubles through ARM32 registers and preserve initializer receivers',async t=>{
 const x=await fixture(t),cls=x.cls('NSDate');
 for(const value of [-978307200.25,-1.5,0,978307200,1234567890.125]){
  const date=await x.send(cls,'dateWithTimeIntervalSince1970:',...words(value));
  assert.equal(decoded(await x.send(date,'timeIntervalSince1970')),value);
  assert.equal(decoded(await x.send(date,'timeIntervalSinceReferenceDate')),value-978307200);
  const self=await x.send(cls,'alloc');assert.equal(await x.send(self,'initWithTimeIntervalSinceReferenceDate:',...words(value-978307200)),self);
  assert.equal(await x.send(self,'isEqualToDate:',date),1);await x.send(self,'release');
 }
});
test('NSDate relative arithmetic and comparisons return real times and existing date identities',async t=>{
 const x=await fixture(t),cls=x.cls('NSDate'),early=await x.send(cls,'dateWithTimeIntervalSince1970:',...words(1000.25));
 const late=await x.send(cls,'dateWithTimeInterval:sinceDate:',...words(2.5),early);
 assert.equal(decoded(await x.send(late,'timeIntervalSince1970')),1002.75);
 assert.equal(decoded(await x.send(late,'timeIntervalSinceDate:',early)),2.5);
 assert.equal(await x.send(early,'compare:',late),-1);assert.equal(await x.send(late,'compare:',early),1);assert.equal(await x.send(early,'compare:',early),0);
 assert.equal(await x.send(early,'earlierDate:',late),early);assert.equal(await x.send(early,'laterDate:',late),late);
 assert.equal(await x.send(early,'isEqual:',await x.send(cls,'dateWithTimeIntervalSince1970:',...words(1000.25))),1);
 assert.equal(await x.send(early,'isEqual:',await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('other'))),0);
 const added=await x.send(early,'dateByAddingTimeInterval:',...words(-3));assert.equal(decoded(await x.send(added,'timeIntervalSince1970')),997.25);
 const copy=await x.send(early,'copy');assert.equal(copy,early);await x.send(copy,'release');
});
test('NSDate clock-relative constructors and lifecycle retain the reference epoch and release allocated instances',async t=>{
 const x=await fixture(t),cls=x.cls('NSDate'),before=Date.now()/1000;
 const date=await x.send(cls,'dateWithTimeIntervalSinceNow:',...words(-123.5)),value=decoded(await x.send(date,'timeIntervalSince1970'));
 assert.ok(value>=before-123.5&&value<=Date.now()/1000-123.5);
 assert.ok(Math.abs(decoded(await x.send(date,'timeIntervalSinceNow'))+123.5)<1);
 const init=x.sel('initWithTimeIntervalSince1970:'),release=x.sel('release'),self=await x.send(cls,'alloc');
 await x.f('_objc_msgSend',self,init,...words(0));await x.f('_objc_msgSend',self,release);assert.equal(x.heap.live.has(self),false);
});
