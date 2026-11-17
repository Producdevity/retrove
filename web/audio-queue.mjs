import {IMA4Decoder} from "../src/runtime/audio/codecs/ima4.ts";
import {read32,write32} from '../src/runtime/memory/guest-memory.ts';
import {tag} from './audio-file.mjs';
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const LPCM=tag('lpcm'),IMA=tag('ima4');
const invalid=-66682,codec=-66673;
function format(b){
  const d=view(b),f={rate:d.getFloat64(0,true)};
  for(const [i,key] of ['id','flags','packetBytes','packetFrames','frameBytes','channels','bits'].entries())f[key]=d.getUint32(8+4*i,true);
  return f;
}
function pcm(f){
  if(f.id!==LPCM||(f.flags&~15)||!(f.flags&8)||![8,16,32].includes(f.bits)||
    f.frameBytes!==f.channels*f.bits/8 || (f.flags&1)&&f.bits!==32)return null;
  const kind=f.flags&1?'Float32':(f.flags&4?'Int':'Uint')+f.bits, little=!(f.flags&2);
  const half=2**(f.bits-1),bias=f.flags&4?0:half;
  return {
    get:(d,off)=>{const x=d['get'+kind](off,little);return kind==='Float32'?x:(x-bias)/half;},
    set:(d,off,x)=>d['set'+kind](off,kind==='Float32'?x:Math.round(Math.max(-1,Math.min(1-1/half,x))*half)+bias,little)
  };
}
function decode(f,bytes,ima){
  const read=pcm(f),d=view(bytes), channels=f.channels;
  if(read){
    const samples=new Float32Array(Math.floor(bytes.length/f.frameBytes)*channels);
    for(let i=0;i<samples.length;i++)samples[i]=read.get(d,i*f.bits/8);
    return samples;
  }
  return f.id===IMA ? ima?.decode(bytes)??null : null;
}
export function audioQueues(cpu,heap,callGuest,context){
  const queues=new Map(); let serial=0,servicing=false;
  const valid=f=>Number.isFinite(f.rate)&&f.rate>=1000&&f.rate<=384000&&f.channels>=1&&f.channels<=8;
  function allocate(a,described){
    const q=queues.get(a(0)),cap=a(1),n=described?a(2):0,out=a(described?3:2);
    if(!q||!cap||!out)return invalid;
    const p=heap.zero(28+cap+3+n*16);
    if(!p)return -108;
    const data=p+28, desc=n?Math.ceil((data+cap)/4)*4:0;
    write32(cpu,p,cap);write32(cpu,p+4,data);write32(cpu,p+16,n);write32(cpu,p+20,desc);
    q.buffers.set(p,{cap,data,desc});write32(cpu,out,p);return 0;
  }
  const recycled=async(q,item)=>{q.active.delete(item.p);if(q.callback)await callGuest(q.callback,[q.user,q.id,item.p]);};
  function discard(q){
    for(const node of q.nodes){node.onended=null;node.stop();node.disconnect();}
    q.nodes.clear();q.items=[];q.ended=[];q.active.clear();q.time=0;
  }
  function startNode(q,item,ctx){
    const channels=q.f.channels, buf=ctx.createBuffer(channels,item.samples.length/channels,q.f.rate);
    for(let c=0;c<channels;c++){
      const channel=buf.getChannelData(c);
      for(let i=0;i<channel.length;i++)channel[i]=item.samples[i*channels+c];
    }
    const source=ctx.createBufferSource(); source.buffer=buf; source.connect(ctx.destination);
    source.onended=()=>{source.disconnect();q.nodes.delete(source);q.ended.push(item);};
    q.nodes.add(source);const when=Math.max(q.time,ctx.currentTime+.003);source.start(when);q.time=when+buf.duration;
  }
  const funcs={
    _AudioQueueNewOutput:a=>{
      const out=a(6);if(!a(0)||!out)return invalid;
      write32(cpu,out,0);const f=format(cpu.read(a(0),40));
      if(!valid(f)||(!pcm(f)&&!(f.id===IMA&&f.packetFrames===64&&f.packetBytes===34*f.channels)))return codec;
      const id=++serial;queues.set(id,{id,f,ima:f.id===IMA?new IMA4Decoder(f.channels):null,callback:a(1),user:a(2),buffers:new Map(),nodes:new Set(),items:[],ended:[],
        active:new Set(),started:false,stopping:false,time:0});write32(cpu,out,id);return 0;
    },
    _AudioQueueAllocateBuffer:a=>allocate(a,false),
    _AudioQueueAllocateBufferWithPacketDescriptions:a=>allocate(a,true),
    _AudioQueueSetOfflineRenderFormat:a=>{
      const q=queues.get(a(0));if(!q)return invalid;
      if(q.started)return -66678;
      if(!a(1)){q.offline=null;return 0;}
      const f=format(cpu.read(a(1),40));if(!valid(f)||!pcm(f)||f.channels!==q.f.channels||f.rate!==q.f.rate)return codec;
      q.offline=f;return 0;
    },
    _AudioQueueSetProperty:a=>{
      const q=queues.get(a(0));if(!q)return invalid;
      if(a(1)===tag('aqmc')){q.cookie=cpu.read(a(2),a(3));return 0;}
      return -66684;
    },
    _AudioQueueEnqueueBuffer:a=>{
      const q=queues.get(a(0)),p=a(1),b=q?.buffers.get(p);
      if(!b)return -66687;if(q.active.has(p))return -66666;
      const n=read32(cpu,p+8);if(!n)return -66686;if(n>b.cap)return invalid;
      const samples=decode(q.f,cpu.read(b.data,n),q.ima);if(!samples||!samples.length)return codec;
      q.items.push({p,samples,pos:0});q.active.add(p);return 0;
    },
    _AudioQueueStart:a=>{const q=queues.get(a(0));if(!q)return invalid;
      if(!q.offline&&(!context()||context().state==='closed'))return -66680;
      q.started=true;q.stopping=false;return 0;},
    _AudioQueueStop:a=>{const q=queues.get(a(0));if(!q)return invalid;
      if(a(1)){discard(q);q.started=false;}else {q.stopping=true;if(!q.active.size)q.started=false;}return 0;},
    _AudioQueueFlush:a=>queues.has(a(0))?0:invalid, // The supported packet decoders have no internal delay.
    _AudioQueueOfflineRender:async a=>{
      const q=queues.get(a(0)),p=a(2),b=q?.buffers.get(p),frames=a(3);
      if(!q?.offline)return -66626;if(!b)return -66687;
      const f=q.offline,bytes=frames*f.frameBytes;if(bytes>b.cap||q.active.has(p))return invalid;
      if(!q.started&&frames)return -66678;
      const write=pcm(f),output=new Uint8Array(bytes),d=view(output);
      let n=0;
      while(n<frames*f.channels&&q.items.length){
        const item=q.items[0],end=Math.min(item.samples.length,item.pos+frames*f.channels-n);
        while(item.pos<end)write.set(d,n++*f.bits/8,item.samples[item.pos++]);
        if(item.pos===item.samples.length){q.items.shift();await recycled(q,item);}
      }
      const length=n*f.bits/8;
      if(length)cpu.write(b.data,output.subarray(0,length));write32(cpu,p+8,length);return 0;
    },
    _AudioQueueDispose:a=>{
      const q=queues.get(a(0));if(!q)return invalid;
      if(!a(1)&&q.active.size){q.disposing=true;q.stopping=true;return 0;}
      dispose(q);return 0;
    }
  };
  function dispose(q){queues.delete(q.id);discard(q);for(const p of q.buffers.keys())heap.free(p);q.buffers.clear();}
  async function pump(){
    if(servicing)return;servicing=true;
    try{for(const q of queues.values()){
      for(const item of q.ended.splice(0))await recycled(q,item);
      if(q.disposing&&!q.active.size){dispose(q);continue;}
      if(q.stopping&&!q.active.size)q.started=false;
      if(!q.started||q.offline)continue;
      const ctx=context();if(!ctx||ctx.state!=='running')continue;
      while(q.items.length&&q.time<ctx.currentTime+.12)startNode(q,q.items.shift(),ctx);
    }}finally{servicing=false;}
  }
  return {funcs,pump,close(){for(const q of queues.values())dispose(q);}};
}
