import { read32, write32 } from './memory.mjs';

const fourcc = s => [...s].reduce((n,ch) => n*256 + ch.charCodeAt(0),0);
const RIOC = fourcc('rioc'), LPCM = fourcc('lpcm');
const invalid = -50, badScope = -10866, badSize = -10851, badProperty = -10879;
const framesProperty = 14, callbackProperty = 23, streamProperty = 8, ioProperty = 2003;
const view = b => new DataView(b.buffer,b.byteOffset,b.byteLength);

function defaultStream() {
  const b = new Uint8Array(40), v = view(b);
  v.setFloat64(0,44100,true);
  for (const [i,n] of [LPCM,12,4,1,4,2,16,0].entries()) v.setUint32(8+i*4,n,true);
  return b;
}

function parseStream(bytes) {
  const v = view(bytes), rate = v.getFloat64(0,true);
  const word = at => v.getUint32(at,true);
  const flags = word(12), frameBytes = word(24), channels = word(28), bits = word(32);
  const float = !!(flags & 1), signed = !!(flags & 4), little = !(flags & 2);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000 || word(8) !== LPCM ||
      (flags & ~15) || !(flags & 8) || !channels || channels>8 || word(20)!==1 ||
      frameBytes !== word(16) || frameBytes !== channels*(bits/8) || ![8,16,32].includes(bits) ||
      (float && (bits!==32 || signed)) || (!float && bits===32 && !signed)) return null;
  const width = bits/8, scale = 2**(bits-1);
  const method = float ? 'getFloat32' : 'get' + (signed ? 'Int' : 'Uint') + bits;
  return {rate, frameBytes, channels, bits, float, signed, width,
    sample: (data,offset) => {
      const value = data[method](offset,little);
      return float ? (Number.isFinite(value) ? value : 0) : (signed ? value : value-scale)/scale;
    }};
}

export function audioImports(cpu,heap,callGuest,getAudioContext) {
  const units = new Map();
  const listeners = new Map();
  const session = {ready:false, active:true, rate:44100, duration:1024/44100, category:fourcc('solo'), mix:0, duck:0};
  let next = 1, rendering = false, context, observedContext, interrupted = false;
  const sessionEvents = [];
  const onState = () => {
    const state=observedContext?.state;
    if(state==='interrupted' && !interrupted){interrupted=true;sessionEvents.push({interruption:1});}
    if(state==='running' && interrupted){interrupted=false;sessionEvents.push({interruption:0});}
    if(state==='closed')sessionEvents.push({property:fourcc('died')});
  };
  const onRoute = () => sessionEvents.push({property:fourcc('roch')});
  let routeListening=false;
  function observeSession() {
    observedContext ??= getAudioContext?.();
    observedContext?.addEventListener?.('statechange',onState);
    if(!routeListening){globalThis.navigator?.mediaDevices?.addEventListener?.('devicechange',onRoute);routeListening=true;}
  }

  function stopSources(unit) {
    unit.started = false;
    for (const node of unit.sources) { node.onended=null; node.stop(); node.disconnect(); }
    unit.sources.clear();
  }
  function release(unit) {
    stopSources(unit);
    if (unit.work !== 0) heap.free(unit.work);
    unit.work=0;
  }
  function withUnit(a,fn) {
    if (rendering) return -10863;
    const u = units.get(a(0));
    return u ? fn(u) : invalid;
  }
  function propSize(prop,scope) {
    switch (prop) {
      case streamProperty: return scope===1 || scope===2 ? 40 : badScope;
      case framesProperty: return scope===0 ? 4 : badScope;
      case callbackProperty: return scope===0 || scope===1 ? 8 : badScope;
      case ioProperty: return scope===2 ? 4 : badScope;
      default: return badProperty;
    }
  }
  function property(a,write) {
    return withUnit(a,u => {
      const prop=a(1), scope=a(2), pointer=a(4), sizeArg=a(5);
      if (a(3)!==0) return -10877;
      if (!pointer || (!write && !sizeArg)) return invalid;
      const size=propSize(prop,scope);
      if (size<0) return size;
      if (write) {
        if (u.work) return -10849;
        if (sizeArg!==size) return badSize;
        if (prop===streamProperty) {
          if (scope!==1) return badScope;
          const raw=cpu.read(pointer,size), format=parseStream(raw);
          if (!format) return -10868;
          u.raw=raw; u.format=format;
        } else if (prop===callbackProperty) {
          u.callback=read32(cpu,pointer); u.ref=read32(cpu,pointer+4);
        } else if (prop===framesProperty) {
          const n=read32(cpu,pointer);
          if (n<64 || n>16384) return badSize;
          u.maximum=n;
        } else if (read32(cpu,pointer)!==1) return badSize;
      } else {
        if (read32(cpu,sizeArg)<size) return badSize;
        if (prop===streamProperty) cpu.write(pointer,u.raw);
        else if (prop===callbackProperty) {write32(cpu,pointer,u.callback); write32(cpu,pointer+4,u.ref);}
        else write32(cpu,pointer,prop===framesProperty ? u.maximum : 1);
        write32(cpu,sizeArg,size);
      }
      return 0;
    });
  }
  const sessionSpecs = new Map([
    ['hwsr',['rate','Float64',8]],['iobd',['duration','Float32',4]],['acat',['category','Uint32',4]],
    ['cmix',['mix','Uint32',4]],['duck',['duck','Uint32',4]],['aiav',[null,'Uint32',4]],['chic',[null,'Uint32',4]],
  ].map(([key,spec])=>[fourcc(key),spec]));
  function sessionProperty(a,write) {
    if (!session.ready) return fourcc('!ini');
    const spec=sessionSpecs.get(a(0)), pointer=a(2);
    if (!spec || (write && spec[0]==null)) return fourcc('pty?');
    if (!pointer || (!write && !a(1))) return invalid;
    const [key,type,size]=spec;
    if (write) {
      if (a(1)!==size) return fourcc('!siz');
      const x=view(cpu.read(pointer,size))['get'+type](0,true);
      if ((key==='rate' && (!Number.isFinite(x) || x<8000 || x>192000)) ||
          (key==='duration' && (!Number.isFinite(x) || x<=0 || x>1)) ||
          ((key==='mix' || key==='duck') && x>1)) return invalid;
      if (key==='duck' && x) return fourcc('pty?');
      if (key==='category' && !['ambi','solo','medi','plar'].map(fourcc).includes(x)) return fourcc('!cat');
      session[key]=x;
    } else {
      if (read32(cpu,a(1))<size) return fourcc('!siz');
      const value=new Uint8Array(size);
      view(value)['set'+type](0,key===null ? 0 : session[key],true);
      cpu.write(pointer,value); write32(cpu,a(1),size);
    }
    return 0;
  }
  const funcs = {
    _AudioComponentFindNext: a => {
      if (a(0) || !a(1)) return 0;
      const p=a(1);
      for (const [i,expected] of [fourcc('auou'),RIOC,fourcc('appl')].entries()) {
        const n=read32(cpu,p+4*i); if (n && n!==expected) return 0;
      }
      return (read32(cpu,p+12) & read32(cpu,p+16)) ? 0 : RIOC;
    },
    _AudioComponentInstanceNew: a => {
      if (rendering) return -10863;
      if (a(0)!==RIOC || !a(1)) return invalid;
      const raw=defaultStream(), id=next++;
      units.set(id,{raw,format:parseStream(raw),maximum:4096,callback:0,ref:0,work:0,
        frames:0,samples:0,started:false,time:0,sources:new Set()});
      write32(cpu,a(1),id); return 0;
    },
    _AudioUnitSetProperty: a => property(a,true),
    _AudioUnitGetProperty: a => property(a,false),
    _AudioUnitInitialize: a => withUnit(a,u => {
      if (u.work) return 0;
      if (!u.callback) return -10876;
      context ??= getAudioContext?.();
      if (!context || context.state==='closed') return -10875;
      const wanted=Math.min(u.maximum, Math.round(session.duration*u.format.rate));
      let frames=64;
      while(frames<wanted && frames*2<=u.maximum) frames*=2;
      u.frames=frames; u.samples=0;
      // flags + padding, AudioTimeStamp, AudioBufferList, interleaved PCM.
      u.work=heap.alloc(88+frames*u.format.frameBytes);
      return u.work ? 0 : -10875;
    }),
    _AudioUnitRender: async a => {
      const unit=units.get(a(0)),flags=a(1),stamp=a(2),bus=a(3),frames=a(4),list=a(5);
      if(!unit||!flags||!stamp||!list)return invalid;
      if(!unit.work)return -10867;
      if(bus!==0||!unit.callback)return -10876;
      if(frames>unit.maximum)return -10874;
      if(rendering)return -10863;
      rendering=true;
      try{return await callGuest(unit.callback,[unit.ref,flags,stamp,bus,frames,list]);}
      finally{rendering=false;}
    },
    _AudioOutputUnitStart: a => withUnit(a,u => {
      if (!u.work) return -10867;
      if (!u.started) u.time=0;
      u.started=true;
      return 0;
    }),
    _AudioOutputUnitStop: a => withUnit(a,u => {stopSources(u); return 0;}),
    _AudioUnitUninitialize: a => withUnit(a,u => {release(u); return 0;}),
    _AudioComponentInstanceDispose: a => withUnit(a,u => {release(u); units.delete(a(0)); return 0;}),
    _AudioSessionInitialize: a => {
      if (session.ready) return fourcc('init');
      session.ready=true; session.interruptionCallback=a(2);session.ref=a(3);observeSession();return 0;
    },
    _AudioSessionSetProperty: a => sessionProperty(a,true),
    _AudioSessionGetProperty: a => sessionProperty(a,false),
    _AudioSessionAddPropertyListener: a => {
      const property=a(0), callback=a(1), ref=a(2);
      if (!callback) return invalid;
      if (!['roch','died','aiav'].map(fourcc).includes(property)) return fourcc('pty?');
      if (!session.ready) return fourcc('!ini');
      listeners.set([property,callback,ref].join('/'),{property,callback,ref});
      return 0;
    },
    _AudioSessionSetActive: a => session.ready ? setSessionActive(!!a(0)) : fourcc('!ini'),
  };
  function setSessionActive(enabled) {
      if (rendering) return -10863;
      session.active=enabled;
      if (!session.active) for (const unit of units.values()) {
        const started=unit.started; stopSources(unit); unit.started=started; unit.time=0;
      }
      return 0;
  }

  async function render(unit) {
    const {work,frames,format}=unit, {rate,channels,frameBytes,width}=format;
    const length=frames*frameBytes, timestamp=work+8, list=work+72, pcm=work+88;
    const stamp=new Uint8Array(64), v=view(stamp);
    const now=context.currentTime;
    v.setFloat64(0,unit.samples,true); v.setBigUint64(8,BigInt(Math.floor(performance.now()*1e6)),true);
    v.setUint32(56,3,true); cpu.write(timestamp,stamp);
    write32(cpu,work,0); write32(cpu,list,1); write32(cpu,list+4,channels);
    write32(cpu,list+8,length); write32(cpu,list+12,pcm);
    const silence=new Uint8Array(length);
    if (!format.float && !format.signed) {
      const quiet=view(silence);
      if (width===1) silence.fill(128);
      else for(let i=0;i<length;i+=2) quiet.setUint16(i,32768,!(view(unit.raw).getUint32(12,true)&2));
    }
    cpu.write(pcm,silence);
    const status=await callGuest(unit.callback,[unit.ref,work,timestamp,0,frames,list]);
    if (status) throw Error('RemoteIO render callback returned OSStatus '+(status|0));
    const buffer=context.createBuffer(channels,frames,rate);
    if (!(read32(cpu,work)&16)) {
      if (read32(cpu,list)!==1 || read32(cpu,list+4)!==channels || read32(cpu,list+8)<length || !read32(cpu,list+12)) {
        throw Error('RemoteIO callback returned an invalid interleaved AudioBufferList');
      }
      const input=view(cpu.read(read32(cpu,list+12),length));
      for (let c=0;c<channels;c++) {
        const out=buffer.getChannelData(c);
        for(let i=0;i<frames;i++) out[i]=format.sample(input,i*frameBytes+c*width);
      }
    }
    const source=context.createBufferSource(); source.buffer=buffer; source.connect(context.destination);
    const when=Math.max(unit.time,now+0.005,context.currentTime+0.002);
    unit.sources.add(source);
    source.onended=() => {source.disconnect(); unit.sources.delete(source);};
    source.start(when);
    unit.time=when+frames/rate; unit.samples+=frames;
  }
  async function pump() {
    if (rendering || !context || context.state!=='running' || !session.active) return;
    rendering=true;
    try {
      for (const unit of units.values()) {
        // Cap callback count if guest rendering takes longer than real time.
        for (let i=0; i<4 && unit.started && unit.time<context.currentTime+0.055; i++) await render(unit);
      }
    } finally { rendering=false; }
  }
  let sendingEvents=false;
  async function pumpSession(objc){
    if(sendingEvents||!sessionEvents.length)return;
    sendingEvents=true;
    try{for(const event of sessionEvents.splice(0)){
      if(event.interruption!==undefined){
        if(session.interruptionCallback)await callGuest(session.interruptionCallback,[session.ref,event.interruption]);
        await objc.audioSessionNotification('AVAudioSessionInterruptionNotification','AVAudioSessionInterruptionTypeKey', event.interruption);
      }else{
        const route=event.property===fourcc('roch');
        let slot=0;
        try{
          if(route){
            await objc.audioSessionNotification('AVAudioSessionRouteChangeNotification','AVAudioSessionRouteChangeReasonKey',0);
            const legacy=await objc.audioReasonDictionary('OutputDeviceDidChange_Reason',0);
            slot=heap.alloc(4);write32(cpu,slot,legacy);
          }
          for(const l of listeners.values())if(l.property===event.property)
            await callGuest(l.callback,[l.ref,event.property,route?4:0,slot]);
        }finally{if(slot)heap.free(slot);}
      }
    }}finally{sendingEvents=false;}
  }
  function close() {
    observedContext?.removeEventListener?.('statechange',onState);
    if(routeListening)globalThis.navigator?.mediaDevices?.removeEventListener?.('devicechange',onRoute);
    for(const u of units.values())release(u);units.clear();listeners.clear();
  }
  return {funcs,pump,pumpSession,close,setSessionActive};
}
