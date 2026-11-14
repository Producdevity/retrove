import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';

test('NSNumber initializers preserve their receiver and round-trip signed and unsigned ARM32 values',async t=>{
 const x=await fixture(t);
 for(const [suffix,input,expected] of [['Bool',1,1],['Bool',0,0],['Char',0xff,-1],['UnsignedChar',0xff,255],['Short',0xffff,-1],['UnsignedShort',0xffff,65535],['Int',0x80000000,-2147483648],['UnsignedInt',0xffffffff,4294967295],['Long',0xffffffff,-1],['UnsignedInteger',0xffffffff,4294967295]]){
  const self=await x.send(x.cls('NSNumber'),'alloc');assert.equal(await x.send(self,'initWith'+suffix+':',input),self);
  assert.equal(await x.send(self,suffix[0].toLowerCase()+suffix.slice(1)+'Value'),expected);await x.send(self,'release');
 }
});
test('NSNumber keeps all 64 integer bits across factories, initializers and conversions',async t=>{
 const x=await fixture(t);
 const unsigned=await x.send(x.cls('NSNumber'),'numberWithUnsignedLongLong:',0xffffffff,0xffffffff);
 assert.equal(await x.send(unsigned,'unsignedLongLongValue'),18446744073709551615n);assert.equal(await x.send(unsigned,'longLongValue'),-1n);
 const signed=await x.send(x.cls('NSNumber'),'alloc');await x.send(signed,'initWithLongLong:',1,0x80000000);
 assert.equal(await x.send(signed,'longLongValue'),-9223372036854775807n);assert.equal(await x.send(signed,'unsignedLongLongValue'),9223372036854775809n);
 assert.equal(await x.send(signed,'intValue'),1);
});
test('NSNumber float and double values use the guest soft-float ABI',async t=>{
 const x=await fixture(t),bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,-123.25,true);
 const number=await x.send(x.cls('NSNumber'),'alloc');await x.send(number,'initWithDouble:',bits.getUint32(0,true),bits.getUint32(4,true));
 bits.setBigUint64(0,await x.send(number,'doubleValue'),true);assert.equal(bits.getFloat64(0,true),-123.25);
 bits.setUint32(0,await x.send(number,'floatValue'),true);assert.equal(bits.getFloat32(0,true),-123.25);
});
