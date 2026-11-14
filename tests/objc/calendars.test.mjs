import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
function words(value){const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,value,true);return[d.getUint32(0,true),d.getUint32(4,true)];}
test('named Foundation time zones and Gregorian components honor daylight saving and midnight boundaries',async t=>{
 const x=await fixture(t),text=async p=>readString(x.cpu,await x.send(p,'UTF8String')),str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
 for(const [name,offset,parts] of [['PST',-25200,[2026,7,1,3,0,0]],['UTC',0,[2026,7,1,10,0,0]],['Europe/Amsterdam',7200,[2026,7,1,12,0,0]]]){
  const zone=await x.send(x.cls('NSTimeZone'),'timeZoneWithName:',await str(name)),date=await x.send(x.cls('NSDate'),'dateWithTimeIntervalSince1970:',...words(1782900000));
  assert.equal(await x.send(zone,'secondsFromGMTForDate:',date),offset);assert.equal(await text(await x.send(zone,'name')),name==='UTC'?'GMT':name);
  const calendar=await x.send(x.cls('NSCalendar'),'alloc');await x.send(calendar,'initWithCalendarIdentifier:',await str('gregorian'));await x.send(calendar,'setTimeZone:',zone);
  const fields=await x.send(calendar,'components:fromDate:',4|8|16|32|64|128,date);assert.deepEqual(await Promise.all(['year','month','day','hour','minute','second'].map(field=>x.send(fields,field))),parts);
  assert.equal(await x.send(fields,'weekday'),0x7fffffff);assert.equal(await text(await x.send(await x.send(calendar,'timeZone'),'name')),await text(await x.send(zone,'name')));
  const winter=await x.send(x.cls('NSDate'),'dateWithTimeIntervalSince1970:',...words(1767225600));if(name==='PST')assert.equal(await x.send(zone,'secondsFromGMTForDate:',winter),-28800);
  await x.send(calendar,'release');
 }
 assert.equal(await x.send(x.cls('NSTimeZone'),'timeZoneWithName:',await str('wrong/name')),0);
 const calendar=await x.send(x.cls('NSCalendar'),'alloc');await x.send(calendar,'initWithCalendarIdentifier:',await str('gregorian'));await x.send(calendar,'setTimeZone:',await x.send(x.cls('NSTimeZone'),'timeZoneWithName:',await str('PST')));
 const date=await x.send(x.cls('NSDate'),'dateWithTimeIntervalSince1970:',...words(1767225600)),parts=await x.send(calendar,'components:fromDate:',16|32|64,date);assert.equal(await x.send(parts,'day'),31);assert.equal(await x.send(parts,'hour'),16);await x.send(calendar,'release');
});
