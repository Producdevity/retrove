import {read32,write32} from './memory.mjs';

export const tag=s=>[...s].reduce((v,c)=>v*256+c.charCodeAt(0),0);
const bytesView=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const text=(b,i)=>String.fromCharCode(...b.subarray(i,i+4));
const invalid=tag('dta?'), unsupported=tag('typ?'), badProperty=tag('pty?');
const status=code=>Object.assign(new Error('AudioFile OSStatus '+code),{osStatus:code});
const fail=code=>{throw status(code);};
const scalar=(kind,value)=>{const b=new Uint8Array(kind.endsWith('64')?8:4);bytesView(b)['set'+kind](0,value,true);return b;};

function streamASBD({rate,format,flags,packetBytes,packetFrames,frameBytes,channels,bits}) {
  const b=new Uint8Array(40),v=bytesView(b);v.setFloat64(0,rate,true);
  [format,flags,packetBytes,packetFrames,frameBytes,channels,bits].forEach((n,i)=>v.setUint32(8+i*4,n,true));
  return b;
}
async function inspect(read, size) {
  if (size<12)fail(unsupported);
  const head=await read(0,12), kind=text(head,0);
  const caf=kind==='caff',wave=kind==='RIFF'&&text(head,8)==='WAVE';
  if(!caf&&!wave)fail(unsupported);
  let at=caf?8:12, format, dataAt, dataSize, cookie, table;
  while(at+(caf?12:8)<=size) {
    const h=await read(at,caf?12:8),v=bytesView(h),name=text(h,0);at+=h.length;
    let n=caf?Number(v.getBigInt64(4)):v.getUint32(4,true);
    if(caf&&name==='data'&&n===-1)n=size-at;
    if(!Number.isSafeInteger(n)||n<0||n>size-at)fail(invalid);
    if(caf&&name==='desc') {
      if(n<32)fail(invalid);
      const d=bytesView(await read(at,32)), fmt=d.getUint32(8), cafFlags=d.getUint32(12),
        packetBytes=d.getUint32(16),packetFrames=d.getUint32(20),bits=d.getUint32(28);
      const flags=fmt===tag('lpcm') ? (cafFlags&1?1:4)|(cafFlags&2?0:2)|8 : cafFlags;
      format={format:fmt,rate:d.getFloat64(0),flags,packetBytes,packetFrames,
        frameBytes:fmt===tag('lpcm')&&packetFrames?packetBytes/packetFrames:0,channels:d.getUint32(24),bits};
    } else if(wave&&name==='fmt ') {
      if(n<16)fail(invalid);
      const d=bytesView(await read(at,16)), code=d.getUint16(0,true), bits=d.getUint16(14,true);
      if(code!==1&&code!==3)fail(unsupported);
      const frameBytes=d.getUint16(12,true);
      format={format:tag('lpcm'),rate:d.getUint32(4,true),flags:8|(code===3?1:bits===8?0:4),
        packetBytes:frameBytes,packetFrames:1,frameBytes,channels:d.getUint16(2,true),bits};
    } else if(name==='data') {
      const skip=caf?4:0;if(n<skip)fail(invalid);dataAt=at+skip;dataSize=n-skip;
    } else if(caf&&name==='kuki') {
      if(n>1<<20)fail(invalid);cookie=await read(at,n);
    } else if(caf&&name==='pakt') {
      if(n<24||n>64*1024*1024)fail(invalid);
      const header=bytesView(await read(at,24)), count=Number(header.getBigInt64(0)),valid=header.getBigInt64(8);
      if(count<0||count>0x1000000||valid<0n)fail(invalid);
      table={count,valid,priming:header.getInt32(16),remainder:header.getInt32(20),at:at+24,bytes:n-24};
    }
    at+=n+Number(wave&&n%2===1);
  }
  if(!format||dataAt==null||!Number.isFinite(format.rate)||format.rate<=0||!format.channels)fail(invalid);
  const {packetBytes,packetFrames}=format;
  let count=table?.count??Math.floor(dataSize/packetBytes), max=packetBytes, offsets,frames;
  if(!packetBytes||!packetFrames) {
    if(!table)fail(invalid);
    offsets=new Float64Array(count+1);
    if(!packetFrames)frames=new Uint32Array(count);
    const b=await read(table.at,table.bytes);let pos=0;
    const variable=()=>{let v=0,c;do{if(pos>=b.length||v>0x1ffffff)fail(invalid);c=b[pos++];v=v*128+(c&127);}while(c&128);return v;};
    for(let i=0;i<count;i++){
      const n=packetBytes||variable();if(!packetFrames)frames[i]=variable();
      offsets[i+1]=offsets[i]+n;max=Math.max(max,n);
    }
    if(offsets[count]>dataSize)fail(invalid);
  } else if(!Number.isSafeInteger(count)||count*packetBytes>dataSize)fail(invalid);
  const frameCount=Number(table?.valid??(count*packetFrames));
  const duration=frameCount/format.rate;
  const props=new Map([
    ['ffmt',scalar('Uint32',tag(caf?'caff':'WAVE'))],['dfmt',streamASBD(format)],['bcnt',scalar('BigUint64',BigInt(dataSize))],
    ['pcnt',scalar('BigUint64',BigInt(count))],['psze',scalar('Uint32',max)],['pkub',scalar('Uint32',max)],
    ['doff',scalar('BigUint64',BigInt(dataAt))],['edur',scalar('Float64',duration)],['brat',scalar('Uint32',duration?Math.round(dataSize*8/duration):0)]
  ].map(([s,v])=>[tag(s),v]));
  if(cookie)props.set(tag('mgic'),cookie);
  if(table){const b=new Uint8Array(16),v=bytesView(b);v.setBigInt64(0,table.valid,true);
    v.setInt32(8,table.priming,true);v.setInt32(12,table.remainder,true);props.set(tag('pnfo'),b);}
  return {props,dataAt,count,packetBytes,offsets,frames,read};
}

export function audioFiles(cpu,heap,guest) {
  const files=new Map();let next=0;
  function property(a,info) {
    const f=files.get(a(0));if(!f||!a(2))return -50;
    const prop=f.props.get(a(1));if(!prop)return badProperty;
    if(info){write32(cpu,a(2),prop.byteLength);if(a(3))write32(cpu,a(3),0);}
    else {if(!a(3)||read32(cpu,a(2))<prop.length)return tag('!siz');cpu.write(a(3),prop);write32(cpu,a(2),prop.length);}
    return 0;
  }
  return {
    _AudioFileOpenWithCallbacks: async a=>{
      const client=a(0),reader=a(1),sizeProc=a(3),out=a(6);
      if(!out||!reader||!sizeProc)return -50;write32(cpu,out,0);
      const size=Number(await guest(sizeProc,[client],true));
      if(!Number.isSafeInteger(size)||size<0)return invalid;
      const read=async (at,n)=>{
        if(!n)return new Uint8Array();
        const b=new Uint8Array(n);
        for(let pos=0;pos<n;){
          const len=Math.min(n-pos,65536),tmp=heap.alloc(len+4);if(!tmp)fail(-108);
          try {
            write32(cpu,tmp,0);const off=at+pos;
            const err=await guest(reader,[client,off>>>0,Math.floor(off/2**32),len,tmp+4,tmp]);
            const got=read32(cpu,tmp);if(err&&(err|0)!==-39)fail(err|0);
            if(!got||got>len)fail(invalid);b.set(cpu.read(tmp+4,got),pos);pos+=got;
          } finally {heap.free(tmp);}
        }
        return b;
      };
      try{const f=await inspect(read,size);files.set(++next,f);write32(cpu,out,next);return 0;}
      catch(e){if(e.osStatus!==undefined)return e.osStatus;throw e;}
    },
    _AudioFileGetPropertyInfo:a=>property(a,true), _AudioFileGetProperty:a=>property(a,false),
    _AudioFileClose:a=>files.delete(a(0))?0:-50,
    _AudioFileReadPacketData:async a=>{
      const f=files.get(a(0)),nbytes=a(2),desc=a(3),start=a(4)+a(5)*2**32,packets=a(6),out=a(7);
      if(!f||!nbytes||!packets||!out||!Number.isSafeInteger(start))return -50;
      const capacity=read32(cpu,nbytes),wanted=read32(cpu,packets);
      write32(cpu,nbytes,0);write32(cpu,packets,0);
      if(start>=f.count)return -39;
      const offset=i=>f.offsets?f.offsets[i]:i*f.packetBytes;
      let n=Math.min(wanted,f.count-start);
      if(!f.offsets)n=Math.min(n,Math.floor(capacity/f.packetBytes));
      else {let lo=0,hi=n;while(lo<hi){const m=Math.ceil((hi+lo)/2);
        if(offset(start+m)-offset(start)<=capacity)lo=m;else hi=m-1;}n=lo;}
      const first=offset(start),len=offset(start+n)-first;
      try{for(let j=0;j<len;j+=65536)cpu.write(out+j,await f.read(f.dataAt+first+j,Math.min(65536,len-j)));}
      catch(e){if(e.osStatus!==undefined)return e.osStatus;throw e;}
      if(desc&&f.offsets){
        const b=new Uint8Array(16*n),v=bytesView(b);
        for(let i=0;i<n;i++){const at=start+i;v.setBigInt64(16*i,BigInt(offset(at)-first),true);
          v.setUint32(16*i+8,f.frames?.[at]??0,true);v.setUint32(16*i+12,offset(at+1)-offset(at),true);}
        cpu.write(desc,b);
      }
      write32(cpu,nbytes,len);write32(cpu,packets,n);
      return n<wanted&&start+n===f.count?-39:0;
    }
  };
}
