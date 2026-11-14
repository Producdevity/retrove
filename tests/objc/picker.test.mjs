import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {floatBits,floatFromBits} from '../../src/runtime/ios/abi/scalars.ts';
test('UIPickerView caches data source counts, preserves selection and uses the CGSize stret ABI',async t=>{
 let x,componentCalls=0,rows=[3,5],selected=[];
 x=await fixture(t,async(pc,args)=>{
  if(pc===0x6200){componentCalls++;return 2;}
  if(pc===0x6210)return rows[args[3]];
  if(pc===0x6220)return floatBits(args[3]===0?90:110);
  if(pc===0x6230)return floatBits(32);
  if(pc===0x6240){selected.push(args.slice(2));return;}
  throw Error('Unexpected picker delegate address '+pc);
 });
 const klass=x.instance('PickerSource',[['numberOfComponentsInPickerView:',0x6200],['pickerView:numberOfRowsInComponent:',0x6210],['pickerView:widthForComponent:',0x6220],['pickerView:rowHeightForComponent:',0x6230],['pickerView:didSelectRow:inComponent:',0x6240]]);x.install({'__objc_classlist':[klass]});
 const source=await x.send(klass,'new'),picker=await x.send(x.cls('UIPickerView'),'new'),refs=await x.send(source,'retainCount');
 await x.send(picker,'setDataSource:',source);await x.send(picker,'setDelegate:',source);assert.equal(await x.send(source,'retainCount'),refs);
 assert.equal(await x.send(picker,'dataSource'),source);assert.equal(await x.send(picker,'numberOfComponents'),2);
 assert.equal(await x.send(picker,'numberOfRowsInComponent:',1),5);assert.equal(await x.send(picker,'selectedRowInComponent:',0),0);assert.equal(componentCalls,1);
 await x.send(picker,'selectRow:inComponent:animated:',4,1,1);assert.equal(await x.send(picker,'selectedRowInComponent:',1),4);assert.deepEqual(selected,[]);
 const result=x.heap.zero(8);await x.f('_objc_msgSend_stret',result,picker,x.sel('rowSizeForComponent:'),1);
 assert.deepEqual([floatFromBits(x.read(result)),floatFromBits(x.read(result+4))],[110,32]);
 rows[1]=2;await x.send(picker,'reloadComponent:',1);assert.equal(await x.send(picker,'selectedRowInComponent:',1),1);
 assert.equal(await x.send(picker,'viewForRow:forComponent:',0,0),0);
 await x.send(picker,'setDataSource:',0);assert.equal(await x.send(picker,'numberOfComponents'),0);assert.equal(await x.send(picker,'selectedRowInComponent:',0),-1);
 await x.send(picker,'release');assert.equal(x.heap.live.has(picker),false);assert.equal(await x.send(source,'retainCount'),refs);await x.send(source,'release');x.heap.free(result);
});
