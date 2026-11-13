import {move, read32, write32} from './memory.mjs';

const ON_HEAP=1<<24, HELPERS=1<<25, GLOBAL=1<<28, COUNT=65535;

export function dispatchImports(cpu,heap,threads,nested,objc,hostGate) {
  const main=heap.zero(4), queues=new Map([0,2,-2,-32768].map(priority=>[priority,heap.zero(4)]));
  const data=new Map([['__dispatch_main_q',main]]);
  const queueIds=new Set([main,...queues.values()]), current=new Map(), pending=[];
  let polling=false;
  const read=at=>read32(cpu,at), write=(at,val)=>write32(cpu,at,val);
  const caller=threads.funcs._pthread_self;
  const invoke=async(block,...args)=>nested(read(block+12),[block,...args]);

  function retainAt(addr) {
    const flags=read(addr);
    if ((flags&ON_HEAP) && (flags&COUNT)!==COUNT) write(addr,flags+1);
  }
  async function copy(block) {
    if (!block) return 0;
    const flags=read(block+4);
    if (flags&GLOBAL) return block;
    if (flags&ON_HEAP) { retainAt(block+4); return block; }
    const descriptor=read(block+16),size=read(descriptor+4);
    if (size<20) throw Error('Invalid guest block size');
    const dest=heap.alloc(size);
    if (!dest) throw Error('Guest block allocation failed');
    move(cpu,dest,block,size);
    write(dest,objc.blockClasses.get('__NSConcreteMallocBlock'));
    write(dest+4,(flags&~COUNT)|ON_HEAP|1);
    try { if(flags&HELPERS) await nested(read(descriptor+8),[dest,block]); }
    catch(err) { heap.free(dest); throw err; }
    return dest;
  }
  async function copyByref(original) {
    const source=read(original+4),flags=read(source+8);
    if (flags&ON_HEAP) { retainAt(source+8); return source; }
    const size=read(source+12);
    if (size<(flags&HELPERS?24:16)) throw Error('Invalid byref block capture size');
    const dest=heap.alloc(size);
    if (!dest) throw Error('Guest block capture allocation failed');
    move(cpu,dest,source,size);
    write(dest+4,dest); write(source+4,dest); write(dest+8,(flags&~COUNT)|ON_HEAP|2);
    if(flags&HELPERS) await nested(read(source+16),[dest,source]);
    return dest;
  }
  async function release(block,byref=false) {
    if (!block) return;
    const dest=byref?read(block+4):block,at=dest+(byref?8:4),flags=read(at);
    const count=flags&COUNT;
    if (!(flags&ON_HEAP) || count===COUNT) return;
    if(!count) throw Error('Guest block released too many times');
    write(at,flags-1);
    if(count!==1) return;
    try {
      if(flags&HELPERS) await nested(byref?read(dest+20):read(read(dest+16)+12),[dest]);
    } finally { heap.free(dest); }
  }
  async function field(value,flags,dispose) {
    if (flags&128 || flags&16 || !value) return value; // caller retains byref members; weak captures are unretained.
    switch(flags&15) {
      case 3: return dispose ? objc.releaseObject(value) : objc.retainObject(value);
      case 7: return dispose ? release(value) : copy(value);
      case 8: return dispose ? release(value,true) : copyByref(value);
      default: throw Error('Unsupported guest block capture flags '+flags);
    }
  }
  function validate(queue,block) {
    if(!queueIds.has(queue) || !block || !read(block+12)) throw Error('Invalid guest dispatch queue or block');
  }
  async function run(queue,block) {
    const thread=caller(), previous=current.get(thread);
    current.set(thread,queue);
    try { return await invoke(block); }
    finally { if(previous) current.set(thread,previous); else current.delete(thread); }
  }
  let onceReturn=0, syncReturn=0;
  function invokeOnCaller(block, value, gate) {
    // Leave the original return address and callback state on this pthread's
    // guest stack. A blocked block can then yield back to the thread scheduler.
    const sp=cpu.getReg(13)-8;
    if(sp<threads.stackBottom)throw Error('Guest stack exhausted entering a dispatch block');
    write(sp,cpu.getReg(14));write(sp+4,value);
    cpu.setReg(13,sp);cpu.setReg(14,gate);cpu.setReg(0,block);
    return {jump:read(block+12)};
  }
  function continuation(name,finish) {
    return hostGate({library:'libdispatch',name},()=>{
      const sp=cpu.getReg(13),lr=read(sp);
      finish(read(sp+4));
      cpu.setReg(13,sp+8);cpu.setReg(14,lr);
      return {jump:lr};
    });
  }
  async function pollMain() {
    if(polling || !threads.funcs._pthread_main_np() || !pending.length) return;
    polling=true;
    try {
      const batch=pending.splice(0);
      for(const job of batch) {
        try { await run(main,job.block); }
        finally { if(job.waiting) job.done=true; else await release(job.block); }
      }
    } finally { polling=false; }
  }
  const funcs={
    __Block_copy:a=>copy(a(0)), __Block_release:a=>release(a(0)),
    __Block_object_assign:async a=>{const dest=a(0);write(dest,await field(a(1),a(2),false));},
    __Block_object_dispose:a=>field(a(0),a(1),true),
    _dispatch_once:async a=>{
      const at=a(0),block=a(1);
      if(read(at)===0xffffffff) return;
      if(read(at)) return {wait:()=>read(at)===0xffffffff?0:undefined};
      write(at,1);
      if(hostGate) {
        onceReturn ||= continuation('dispatch_once block return',token=>write(token,0xffffffff));
        return invokeOnCaller(block,at,onceReturn);
      }
      try { await invoke(block); write(at,0xffffffff); }
      catch(err){write(at,0);throw err;}
    },
    _dispatch_get_global_queue:a=>a(1)?0:queues.get(a(0)|0)??0,
    _dispatch_get_current_queue:()=>current.get(caller())??(threads.funcs._pthread_main_np()?main:queues.get(0)),
    _dispatch_sync:async a=>{
      const queue=a(0),block=a(1);validate(queue,block);
      if(queue!==main) {
        if(!hostGate)return run(queue,block);
        const thread=caller(),previous=current.get(thread)??0;
        syncReturn ||= continuation('dispatch_sync block return',old=>{
          if(old)current.set(caller(),old);else current.delete(caller());
        });
        current.set(thread,queue);
        return invokeOnCaller(block,previous,syncReturn);
      }
      if(threads.funcs._pthread_main_np()) throw Error('Synchronous dispatch to the current main queue would deadlock');
      const job={block,waiting:true,done:false};pending.push(job);
      return {wait:()=>job.done?0:undefined};
    },
    _dispatch_async:async a=>{
      const queue=a(0),original=a(1);validate(queue,original);
      const block=await copy(original);
      if(queue===main){pending.push({block});return;}
      const id=threads.spawnDetached(read(block+12),[block],async()=>{
        current.delete(id);
        await release(block);
      });
      if(!id){await release(block);throw Error('Guest dispatch worker could not start');}
      current.set(id,queue);
    }
  };
  return {funcs,data,pollMain,hasPendingMain:()=>pending.length!==0,copy,release};
}
