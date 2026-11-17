import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../src/runtime/memory/guest-memory.ts';
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

test('Gregorian composition reconstructs ZIP timestamps and resolves daylight-saving gaps and repeated hours',async t=>{
 const x=await fixture(t),str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s)),decode=n=>{const v=new DataView(new ArrayBuffer(8));v.setBigUint64(0,n,true);return v.getFloat64(0,true);};
 for(const [zoneName,fields,expected] of [['UTC',{year:1980,month:1,day:1},'1980-01-01T00:00:00Z'],['Europe/Amsterdam',{year:1980,month:1,day:1},'1979-12-31T23:00:00Z'],['PST',{year:2026,month:3,day:8,hour:2,minute:30},'2026-03-08T10:30:00Z'],['PST',{year:2026,month:11,day:1,hour:1,minute:30},'2026-11-01T08:30:00Z']]){
  const calendar=await x.send(x.cls('NSCalendar'),'alloc');await x.send(calendar,'initWithCalendarIdentifier:',await str('gregorian'));await x.send(calendar,'setTimeZone:',await x.send(x.cls('NSTimeZone'),'timeZoneWithName:',await str(zoneName)));
  const components=await x.send(x.cls('NSDateComponents'),'new');for(const [field,value]of Object.entries(fields))await x.send(components,'set'+field[0].toUpperCase()+field.slice(1)+':',value);
  const date=await x.send(calendar,'dateFromComponents:',components);assert.equal(decode(await x.send(date,'timeIntervalSince1970')),Date.parse(expected)/1000);await x.send(components,'release');await x.send(calendar,'release');
 }
});
