import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('NSDecimalNumber parses exact base-ten strings and canonicalizes without binary floating-point loss',async t=>{
 const x=await fixture(t),str=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v)),text=async p=>readString(x.cpu,await x.send(p,'UTF8String'));
 for(const [input,expected] of [['1.2300','1.23'],['-0','0'],['0.1','0.1'],['12345678901234567890123456789012345678','12345678901234567890123456789012345678'],['1e127','1'+'0'.repeat(127)],['1e-128','0.'+'0'.repeat(127)+'1'],['1e128','NaN'],['1e-129','NaN'],['abc','NaN'],['12junk','12'],['  +12.5e-3','0.0125'],['-3.45','-3.45']]){
  const n=await x.send(x.cls('NSDecimalNumber'),'decimalNumberWithString:',await str(input));assert.equal(await text(await x.send(n,'stringValue')),expected);assert.equal(readString(x.cpu,await x.send(n,'objCType')),'d');assert.equal(await x.send(n,'isKindOfClass:',x.cls('NSNumber')),1);
 }
 const exact=await x.send(x.cls('NSDecimalNumber'),'decimalNumberWithString:',await str('12345678901234567890123456789012345678'));assert.equal(await x.send(exact,'longLongValue'),-4302749291975740594n);
});
test('NSDecimalNumber mantissa constructor honors aligned ARM32 integers, signed exponents and double getValue storage',async t=>{
 const x=await fixture(t),n=await x.send(x.cls('NSDecimalNumber'),'alloc');assert.equal(await x.send(n,'initWithMantissa:exponent:isNegative:',12345,0,0xfffe,1),n);assert.equal(await x.send(n,'longLongValue'),-123n);
 const bytes=x.heap.alloc(8);await x.send(n,'getValue:',bytes);assert.equal(new DataView(x.cpu.read(bytes,8).buffer).getFloat64(0,true),-123.45);x.heap.free(bytes);await x.send(n,'release');assert.equal(x.heap.live.has(n),false);
});
