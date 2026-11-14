import {test,vi} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';

class MotionEvent extends Event {
 constructor(){super('devicemotion');this.accelerationIncludingGravity={x:0,y:0,z:9.80665};}
 get timeStamp(){return 1000;}
}
test('UIKit dispatches accelerometer samples through the main loop with owned double-valued objects',async t=>{
 const events=new EventTarget();vi.stubGlobal('window',events);vi.stubGlobal('navigator',{userAgent:'Android'});
 t.onTestFinished(()=>vi.unstubAllGlobals());
 let sensor=0,timer=0,saved=0;const received=[];
 const x=await fixture(t,async(pc,args)=>{
  if(pc===0x4500){
   sensor=await x.send(x.cls('UIAccelerometer'),'sharedAccelerometer');
   assert.equal(sensor,await x.send(x.cls('UIAccelerometer'),'sharedAccelerometer'));
   await x.send(sensor,'setDelegate:',args[0]);
   timer=await x.send(x.cls('NSTimer'),'scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:',0,0,args[0],x.sel('tick:'),0,1);
  }else if(pc===0x4520){events.dispatchEvent(new MotionEvent());}
  else if(pc===0x4540){
   assert.equal(args[2],sensor);saved=args[3];
   await x.send(saved,'retain');
   const bits=new DataView(new ArrayBuffer(8));
   for(const key of ['x','y','z','timestamp']){bits.setBigUint64(0,await x.send(saved,key),true);received.push(bits.getFloat64(0,true));}
   await x.send(timer,'invalidate');
  }
  return 1;
 });
 t.onTestFinished(()=>x.objc.close());
 const delegate=x.instance('MotionDelegate',[['application:didFinishLaunchingWithOptions:',0x4500],['tick:',0x4520],['accelerometer:didAccelerate:',0x4540]]);
 x.install({'__objc_classlist':[delegate]});
 const name=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('MotionDelegate'));
 await assert.rejects(x.f('_UIApplicationMain',0,0,0,name),/without a supported event source/);
 assert.deepEqual(received.map(v=>v||0),[0,0,-1,1]);assert.ok(x.heap.live.has(saved));
 await x.send(saved,'release');assert.equal(x.heap.live.has(saved),false);
 await x.send(sensor,'setDelegate:',0);assert.equal(await x.send(sensor,'delegate'),0);
 const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,.25,true);
 await x.send(sensor,'setUpdateInterval:',bits.getUint32(0,true),bits.getUint32(4,true));
 bits.setBigUint64(0,await x.send(sensor,'updateInterval'),true);assert.equal(bits.getFloat64(0,true),.25);
});

test('accelerometer accepts an idle infinite, negative and zero intervals without aborting application launch',async t=>{
 const x=await fixture(t),sensor=await x.send(x.cls('UIAccelerometer'),'sharedAccelerometer'),bits=new DataView(new ArrayBuffer(8));
 for(const value of [Infinity,0,-.1,.02]){bits.setFloat64(0,value,true);await x.send(sensor,'setUpdateInterval:',bits.getUint32(0,true),bits.getUint32(4,true));bits.setBigUint64(0,await x.send(sensor,'updateInterval'),true);assert.equal(bits.getFloat64(0,true),value);}
});
