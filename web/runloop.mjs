import {readString} from './memory.mjs';
export function foundationRunLoop({cpu,hostClass,method,names,alloc,autorelease,retain,release,send,threads,destroy,read,callGuest,getDispatch,withAnimation}) {
  const timers=new Map(),scheduled=new Map(),queue=[],animations=[];
  const scratch=new DataView(new ArrayBuffer(8));
  const number=(lo,hi)=>{scratch.setUint32(0,lo,true);scratch.setUint32(4,hi,true);return scratch.getFloat64(0,true);};
  const bits=n=>{scratch.setFloat64(0,n,true);return scratch.getBigUint64(0,true);};
  hostClass('NSTimer','NSObject');
  const create=(a,schedule)=>{
    const interval=Math.max(0.1,number(a(0),a(1))*1000);
    const ptr=alloc(names.get('NSTimer'));
    const t={target:retain(a(2)),name:readString(cpu,a(3)),userInfo:retain(a(4)),repeats:!!a(5),interval,
      at:performance.now()+interval,valid:true};
    timers.set(ptr,t);if(schedule)scheduled.set(retain(ptr),t);return autorelease(ptr);
  };
  method('NSTimer',true,'scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:',(_,a)=>create(a,true));
  method('NSTimer',true,'timerWithTimeInterval:target:selector:userInfo:repeats:',(_,a)=>create(a,false));
  async function invalidate(ptr){
    const t=timers.get(ptr);if(!t?.valid)return;
    t.valid=false;await release(t.target);await release(t.userInfo);t.target=0;t.userInfo=0;
    if(scheduled.delete(ptr))await release(ptr);
  }
  async function fire(ptr) {
    const t=timers.get(ptr);if(!t?.valid)return;
    t.at=performance.now()+t.interval;
    try {await send(t.target,t.name,[ptr]);} finally {if(!t.repeats)await invalidate(ptr);}
  }
  method('NSTimer',false,'invalidate',invalidate);
  method('NSTimer',false,'fire',fire);
  method('NSTimer',false,'isValid',s=>Number(timers.get(s)?.valid??false));
  method('NSTimer',false,'userInfo',s=>timers.get(s)?.userInfo??0);
  method('NSTimer',false,'timeInterval',s=>bits((timers.get(s)?.interval??0)/1000));
  method('NSTimer',false,'dealloc',async s=>{await invalidate(s);timers.delete(s);destroy(s);});
  method('NSRunLoop',false,'addTimer:forMode:',(_,a)=>{const p=a(0),t=timers.get(p);if(t?.valid&&!scheduled.has(p))scheduled.set(retain(p),t);});
  for(const isMeta of [false,true]){
    for(const [name,count] of [['performSelector:',0],['performSelector:withObject:',1],['performSelector:withObject:withObject:',2]])
      method('NSObject',isMeta,name,(s,a)=>send(s,readString(cpu,a(0)),Array.from({length:count},(_,i)=>a(i+1))));
    method('NSObject',isMeta,'performSelector:withObject:afterDelay:',(s,a)=>{
      queue.push({target:retain(s),name:readString(cpu,a(0)),arg:retain(a(1)),at:performance.now()+1000*number(a(2),a(3))});
    });
    const deliver=(s,sel,arg,wait)=>{
      const name=readString(cpu,sel);
      if(wait && (threads?.funcs._pthread_self()??1)===1)return send(s,name,[arg]);
      const call={target:retain(s),name,arg:retain(arg),at:0,done:false};queue.push(call);
      return wait?{wait:()=>call.done?0:undefined}:undefined;
    };
    method('NSObject',isMeta,'performSelectorOnMainThread:withObject:waitUntilDone:',(s,a)=>deliver(s,a(0),a(1),a(2)));
    method('NSObject',isMeta,'performSelector:onThread:withObject:waitUntilDone:',async(s,a)=>{
      const [selector,thread,arg,wait]=[a(0),a(1),a(2),a(3)];
      if(!await send(thread,'isMainThread'))throw Error('Requested selector delivery to a non-main NSThread run loop');
      return deliver(s,selector,arg,wait);
    });
  }
  // UIView immediately applies model changes. The completion block runs on
  // the main run loop after both the requested delay and the duration.
  async function animate(seconds, delay, options, changes, completion) {
    const service = getDispatch();
    const saved = completion ? await service.copy(completion) : 0;
    try {
      if (changes) await withAnimation(seconds, delay, options, () => callGuest(read(changes + 12), [changes]));
      if (saved) animations.push({block:saved, at:performance.now() + Math.max(0, seconds + delay) * 1000});
    } catch (error) {
      if (saved) await service.release(saved);
      throw error;
    }
  }
  method('UIView', true, 'animateWithDuration:delay:options:animations:completion:', (_,a)=>
    animate(number(a(0),a(1)),number(a(2),a(3)),a(4),a(5),a(6)));
  method('UIView', true, 'animateWithDuration:animations:completion:', (_,a)=>
    animate(number(a(0),a(1)),0,0,a(2),a(3)));
  method('UIView', true, 'animateWithDuration:animations:', (_,a)=>animate(number(a(0),a(1)),0,0,a(2),0));
  return {pending:()=>scheduled.size+queue.length+animations.length,async pump(){
    const now=performance.now();
    for (const call of queue.slice())if(call.at<=now){
      queue.splice(queue.indexOf(call),1);
      try {await send(call.target,call.name,[call.arg]);}finally{await release(call.target);await release(call.arg);call.done=true;}
    }
    for (const animation of animations.slice()) if (animation.at <= now) {
      animations.splice(animations.indexOf(animation), 1);
      try { await callGuest(read(animation.block + 12), [animation.block, 1]); }
      finally { await getDispatch().release(animation.block); }
    }
    for(const [p,t] of [...scheduled])if(t.valid&&t.at<=now)await fire(p);
  }};
}
