import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString,write32} from '../../web/memory.mjs';
async function setup(t,callback,local=false){
 let thread=2,position=0;const bytes=Uint8Array.of(1,2,3,255);
 const x=await fixture(t,callback,new Map(),(cpu,heap)=>{
  const errno=heap.zero(4);return {threads:{funcs:{_pthread_self:()=>thread}},sys:{funcs:{___error:()=>errno,
   _open:()=>{position=0;return 42;},_fstat:a=>{write32(cpu,a(1)+60,bytes.length);return 0;},
   _read:a=>{const chunk=bytes.subarray(position,position+a(2));position+=chunk.length;cpu.write(a(1),chunk);return chunk.length;},_close:()=>0
  }}};
 });
 const str=v=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(v));
 const url=await x.send(x.cls('NSURL'),local?'fileURLWithPath:':'URLWithString:',await str(local?'/Documents/sample':'https://example.invalid/no-network'));
 const request=await x.send(x.cls('NSURLRequest'),'requestWithURL:',url),loop=await x.send(x.cls('NSRunLoop'),'currentRunLoop');
 return {...x,str,request,loop,select:id=>{thread=id;},text:async p=>readString(x.cpu,await x.send(p,'UTF8String'))};
}
test('connections deliver offline failures only on their registered loop and mode and retain pending ownership',async t=>{
 let x,calls=0,deliveredMode;
 x=await setup(t,async(pc,args)=>{
  assert.equal(pc,0x6200);calls++;
  assert.equal(await x.send(args[3],'code'),-1009);
  const info=await x.send(args[3],'userInfo'),key=x.read(x.objc.resolveData('_NSURLErrorFailingURLStringErrorKey'));
  assert.equal(await x.text(await x.send(info,'objectForKey:',key)),'https://example.invalid/no-network');
  const url=await x.send(info,'objectForKey:',x.read(x.objc.resolveData('_NSURLErrorFailingURLErrorKey')));
  assert.equal(await x.text(await x.send(url,'absoluteString')),'https://example.invalid/no-network');deliveredMode=await x.text(await x.send(x.loop,'currentMode'));
 });
 const cls=x.instance('OfflineObserver',[['connection:didFailWithError:',0x6200]]);x.install({'__objc_classlist':[cls]});
 const delegate=await x.send(cls,'new'),mode=await x.str('NetworkMode'),other=await x.str('OtherMode'),future=await x.send(x.cls('NSDate'),'distantFuture');
 const connection=await x.send(await x.send(x.cls('NSURLConnection'),'alloc'),'initWithRequest:delegate:startImmediately:',x.request,delegate,0);
 await x.send(connection,'scheduleInRunLoop:forMode:',x.loop,mode);await x.send(connection,'start');await x.send(connection,'release');
 assert.equal(x.heap.live.has(connection),true);assert.equal(await x.send(x.loop,'runMode:beforeDate:',other,future),0);assert.equal(calls,0);
 await x.send(connection,'unscheduleFromRunLoop:forMode:',x.loop,mode);assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,future),0);assert.equal(calls,0);
 await x.send(connection,'scheduleInRunLoop:forMode:',x.loop,mode);x.select(1);const main=await x.send(x.cls('NSRunLoop'),'currentRunLoop');assert.equal(await x.send(main,'runMode:beforeDate:',mode,future),0);
 x.select(2);assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,future),1);assert.equal(calls,1);assert.equal(deliveredMode,'NetworkMode');
 assert.equal(x.heap.live.has(connection),false);assert.equal(await x.send(x.loop,'currentMode'),0);assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,future),0);
 await x.send(delegate,'release');
});
test('unscheduling during a response defers data and finish while retaining their values across autorelease pools',async t=>{
 let x,connection,mode,calls=[];
 x=await setup(t,async(pc,args)=>{
  calls.push(pc);
  if(pc===0x6210)await x.send(connection,'unscheduleFromRunLoop:forMode:',x.loop,mode);
  if(pc===0x6220){const data=args[3];assert.deepEqual([...x.cpu.read(await x.send(data,'bytes'),await x.send(data,'length'))],[1,2,3,255]);}
 },true);
 const pool=x.f('_objc_autoreleasePoolPush'),cls=x.instance('FileObserver',[['connection:didReceiveResponse:',0x6210],['connection:didReceiveData:',0x6220],['connectionDidFinishLoading:',0x6230]]);x.install({'__objc_classlist':[cls]});
 const delegate=await x.send(cls,'new');mode=await x.str('FileMode');await x.send(mode,'retain');
 connection=await x.send(await x.send(x.cls('NSURLConnection'),'alloc'),'initWithRequest:delegate:startImmediately:',x.request,delegate,0);
 await x.send(connection,'scheduleInRunLoop:forMode:',x.loop,mode);await x.send(connection,'start');await x.send(connection,'release');
 let future=await x.send(x.cls('NSDate'),'distantFuture');assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,future),1);assert.deepEqual(calls,[0x6210]);
 await x.f('_objc_autoreleasePoolPop',pool);assert.equal(x.heap.live.has(connection),true);
 await x.send(connection,'scheduleInRunLoop:forMode:',x.loop,mode);future=await x.send(x.cls('NSDate'),'distantFuture');
 assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,future),1);assert.deepEqual(calls,[0x6210,0x6220,0x6230]);assert.equal(x.heap.live.has(connection),false);
 await x.send(mode,'release');await x.send(delegate,'release');
});
test('cancelling a request during its response suppresses later data and completion callbacks',async t=>{
 let x,connection,calls=[];
 x=await setup(t,async(pc)=>{calls.push(pc);await x.send(connection,'cancel');},true);
 const cls=x.instance('CancelObserver',[['connection:didReceiveResponse:',0x6240],['connection:didReceiveData:',0x6250],['connectionDidFinishLoading:',0x6260]]);x.install({'__objc_classlist':[cls]});
 const delegate=await x.send(cls,'new');connection=await x.send(x.cls('NSURLConnection'),'connectionWithRequest:delegate:',x.request,delegate);await x.send(connection,'retain');
 const mode=await x.str('kCFRunLoopDefaultMode'),date=await x.send(x.cls('NSDate'),'distantFuture');
 assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,date),1);assert.deepEqual(calls,[0x6240]);assert.equal(await x.send(x.loop,'runMode:beforeDate:',mode,date),0);
 await x.send(connection,'release');await x.send(delegate,'release');
});
