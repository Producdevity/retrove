// The guest has no routed BSD network interface. Return the corresponding Darwin
// reachability flags and DNS error; a browser's own network remains independent.
import {readString} from '../src/runtime/memory/guest-memory.ts';
export function cfNetwork({cpu,read,write,hostClass,method,names,alloc,destroy,text,callGuest,heap,array,dataFrom,release}) {
  hostClass('SCNetworkReachability','NSObject');hostClass('CFHost','NSObject');
  const monitors=new Map(),hosts=new Map();
  const isLoopback=name=>name==='localhost'||name==='::1'||name==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(name);
  const create=target=>{const ptr=alloc(names.get('SCNetworkReachability'));monitors.set(ptr,{target,active:new Set()});return ptr;};
  method('SCNetworkReachability',false,'dealloc',async ptr=>{
    const value=monitors.get(ptr);monitors.delete(ptr);
    if(value?.release&&value.info)await callGuest(value.release,[value.info]);destroy(ptr);
  });
  method('CFHost',false,'dealloc',async ptr=>{
    const state=hosts.get(ptr);hosts.delete(ptr);if(state?.addressList)await release(state.addressList);destroy(ptr);
  });
  return {
    _SCNetworkReachabilityCreateWithAddress:a=>{
      if(!a(1))return 0;
      const addr=cpu.read(a(1),2);
      if(addr[1]===2)return create(Array.from(cpu.read(a(1)+4,4)).join('.'));
      if(addr[1]===30){const ip=cpu.read(a(1)+8,16);return create(ip[15]===1&&ip.subarray(0,15).every(b=>!b)?'::1':'');}
      return 0;
    },
    _SCNetworkReachabilityCreateWithName:a=>a(1)?create(readString(cpu,a(1))):0,
    _SCNetworkReachabilityGetFlags:a=>{
      if(!a(1)||!monitors.has(a(0)))return 0;write(a(1),isLoopback(monitors.get(a(0)).target)?0x30002:0);return 1;
    },
    _SCNetworkReachabilitySetCallback:async a=>{
      const record=monitors.get(a(0)),cb=a(1),ctx=a(2);if(!record||ctx&&read(ctx)!==0)return 0;
      const info=ctx&&read(ctx+4),retainFn=ctx&&read(ctx+8),releaseFn=ctx&&read(ctx+12);
      const newInfo=info&&retainFn?await callGuest(retainFn,[info]):info;
      if(record.info&&record.release)await callGuest(record.release,[record.info]);
      Object.assign(record,{callback:cb,info:newInfo,release:releaseFn});return 1;
    },
    _SCNetworkReachabilityScheduleWithRunLoop:a=>{
      const rec=monitors.get(a(0));if(!rec||!a(1)||!a(2))return 0;rec.active.add(a(1)+'/'+a(2));return 1;
    },
    _SCNetworkReachabilityUnscheduleFromRunLoop:a=>Number(monitors.get(a(0))?.active.delete(a(1)+'/'+a(2))??false),
    _CFHostCreateWithName:a=>{
      if(!a(1))return 0;const p=alloc(names.get('CFHost'));hosts.set(p,{name:text(a(1)),resolved:false});return p;
    },
    _CFHostStartInfoResolution:a=>{
      const record=hosts.get(a(0)),err=a(2);
      if(!record)return 0;
      if(a(1)===0 && isLoopback(record.name)){
        if(!record.addressList){
          const v6=record.name.includes(':'),buf=heap.zero(v6?28:16);
          try{
            const bytes=new Uint8Array(v6?28:16);bytes[0]=bytes.length;bytes[1]=v6?30:2;
            if(v6)bytes[23]=1;else bytes.set(record.name==='localhost'?[127,0,0,1]:record.name.split('.').map(Number),4);
            cpu.write(buf,bytes);const value=dataFrom(buf,bytes.length);record.addressList=array([value]);release(value);
          }finally{heap.free(buf);}
        }
        record.resolved=true;if(err){write(err,0);write(err+4,0);}return 1;
      }
      // CFStreamErrorDomainPOSIX / EHOSTUNREACH.
      if(err){write(err,1);write(err+4,65);}
      record.resolved=false;return 0;
    },
    _CFHostGetAddressing:a=>{const h=hosts.get(a(0));if(a(1))cpu.write(a(1),new Uint8Array([Number(!!h?.resolved)]));return h?.resolved?h.addressList:0;},
  };
}
