import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {tag,audioFiles} from '../web/audio-file.mjs';
import {audioQueues} from '../web/audio-queue.mjs';
import {systemSounds} from '../web/system-sound.mjs';
import {read32,write32} from '../src/runtime/memory/guest-memory.ts';

function memory(){
  const b=new Uint8Array(512000);let next=1024;
  const cpu={read:(p,n)=>b.slice(p,p+n),write:(p,v)=>b.set(v,p)};
  const heap={alloc(n){const at=next;next+=Math.ceil(n/8)*8;return at;},zero(n){return this.alloc(n);},free(){}};
  return {b,cpu,heap,read:p=>read32(cpu,p),write:(p,n)=>write32(cpu,p,n)};
}
const call=(api,n,...args)=>api['_'+n](i=>args[i]??0);

test('AudioFile opens a guest callback WAV, reports native ASBD and reads exact packets into guest memory', async()=>{
  const {b,cpu,heap,read,write}=memory(), wav=new Uint8Array(56),d=new DataView(wav.buffer);
  const name=(p,s)=>wav.set(new TextEncoder().encode(s),p);
  name(0,'RIFF');d.setUint32(4,48,true);name(8,'WAVE');name(12,'fmt ');d.setUint32(16,16,true);
  d.setUint16(20,1,true);d.setUint16(22,2,true);d.setUint32(24,22050,true);d.setUint32(28,88200,true);
  d.setUint16(32,4,true);d.setUint16(34,16,true);name(36,'data');d.setUint32(40,12,true);
  wav.set([1,2,3,4,5,6,7,8,9,10,11,12],44);
  const fs=audioFiles(cpu,heap,async(pc,[ref,lo,hi,n,p,out])=>{
    assert.equal(ref,77);if(pc===2)return BigInt(wav.length);
    assert.equal(hi,0);const size=Math.min(5,n);cpu.write(p,wav.subarray(lo,lo+size));write(out,size);return 0;
  });
  assert.equal(await call(fs,'AudioFileOpenWithCallbacks',77,1,0,2,0,0,32),0);
  const f=read(32);write(36,40);assert.equal(call(fs,'AudioFileGetProperty',f,tag('dfmt'),36,80),0);
  assert.equal(new DataView(b.buffer).getFloat64(80,true),22050);assert.equal(read(88),tag('lpcm'));
  write(36,8);write(40,5);
  assert.equal(await call(fs,'AudioFileReadPacketData',f,0,36,0,1,0,40,300),0);
  assert.equal(read(36),8);assert.equal(read(40),2);assert.deepEqual([...b.subarray(300,308)],[5,6,7,8,9,10,11,12]);
  assert.equal(call(fs,'AudioFileClose',f),0);
});

test('AudioQueue decodes Apple IMA4 nibbles and returns consumed guest buffers exactly once',async()=>{
  const {b,cpu,heap,read,write}=memory(),callbacks=[];
  const audio=audioQueues(cpu,heap,(pc,args)=>callbacks.push([pc,...args]),()=>null);
  function format(p,id,flags,packetBytes,frames,frameBytes,bits){
    new DataView(b.buffer).setFloat64(p,22050,true);
    [tag(id),flags,packetBytes,frames,frameBytes,1,bits].forEach((v,i)=>write(p+8+4*i,v));
  }
  format(100,'ima4',0,34,64,0,0);format(144,'lpcm',12,2,1,2,16);
  const f=(n,...args)=>call(audio.funcs,'AudioQueue'+n,...args);
  assert.equal(f('NewOutput',100,42,33,0,0,0,20),0);const q=read(20);
  assert.equal(f('SetOfflineRenderFormat',q,144,0),0);
  assert.equal(f('AllocateBufferWithPacketDescriptions',q,34,1,20),0);const input=read(20);
  const offset=read(input+4);b[offset+2]=0x21;write(input+8,34);
  assert.equal(f('EnqueueBuffer',q,input,0,0),0);assert.equal(f('Start',q,0),0);
  assert.equal(f('AllocateBuffer',q,128,20),0);const out=read(20);
  assert.equal(await f('OfflineRender',q,0,out,2),0);
  const data=read(out+4),v=new DataView(b.buffer);
  assert.deepEqual([v.getInt16(data,true),v.getInt16(data+2,true)],[1,4]);assert.equal(read(out+8),4);
  assert.equal(await f('OfflineRender',q,0,out,64),0);assert.equal(read(out+8),124);
  assert.deepEqual(callbacks,[[42,33,q,input]]);assert.equal(f('Dispose',q,1),0);audio.close();
});

test('AudioServices decodes the selected asset and schedules one completion after playback',async()=>{
  const {cpu,read}=memory(),data=Uint8Array.of(3,7,9);let node;const callbacks=[];
  const ctx={destination:{},decodeAudioData:async b=>{assert.deepEqual([...new Uint8Array(b)], [...data]);return {duration:.1};},
    createBufferSource:()=>node={connect(){},disconnect(){},start(){},stop(){}}};
  const sounds=systemSounds(cpu,{has:n=>n==='Payload/app/s.wav',read:async()=>data},()=>ctx,async()=>'/Payload/app/s.wav',(pc,args)=>callbacks.push([pc,...args]));
  assert.equal(await call(sounds.funcs,'AudioServicesCreateSystemSoundID',55,32),0);const id=read(32);
  assert.equal(call(sounds.funcs,'AudioServicesAddSystemSoundCompletion',id,0,0,123,456),0);
  call(sounds.funcs,'AudioServicesPlaySystemSound',id);await sounds.pump();assert.deepEqual(callbacks,[]);
  node.onended();await sounds.pump();await sounds.pump();assert.deepEqual(callbacks,[[123,id,456]]);
  assert.equal(call(sounds.funcs,'AudioServicesDisposeSystemSoundID',id),0);sounds.close();
});

function urlFixture(input) {
 const x=memory();let position=0,closes=0,opens=0;
 const io={path:async()=>'/Payload/Test.app/sample.caf',errno:()=>2,allocate:n=>x.heap.alloc(n),free:p=>x.heap.free(p),read:(p,n)=>x.cpu.read(p,n),word:x.read,
  string:value=>{const bytes=new TextEncoder().encode(value+'\0'),p=x.heap.alloc(bytes.length);x.cpu.write(p,bytes);return p;},
  invoke:async(name,a)=>{
   if(name==='_open'){assert.equal(a[1],0);opens++;return 42;}
   if(name==='_close'){closes++;return 0;}
   if(name==='_fstat'){x.write(a[1]+60,input.length);x.write(a[1]+64,0);return 0;}
   if(name==='_lseek'){position=a[1]+a[2]*2**32;return BigInt(position);}
   if(name==='_read'){const bytes=input.subarray(position,position+Math.min(a[2],5));position+=bytes.length;x.cpu.write(a[1],bytes);return bytes.length;}
   throw Error('Unexpected file operation '+name);
  }};
 const api=audioFiles(x.cpu,x.heap,()=>{throw Error('URL assets should use filesystem reads');},io);
 return {...x,api,closes:()=>closes,opens:()=>opens};
}
const nativeCAF=Buffer.from('Y2FmZgABAABkZXNjAAAAAAAAACBA1YiAAAAAAGltYTQAAAAAAAAAIgAAAEAAAAABAAAAAGRhdGEAAAAAAAAASAAAAAAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QEFCQw==','base64');
const nativeProperties={"1650683508": {"status": 0, "data": "RAAAAAAAAAA="}, "1886090594": {"status": 0, "data": "IgAAAA=="}, "1885564532": {"status": 0, "data": "AgAAAAAAAAA="}, "1684434292": {"status": 0, "data": "AAAAAICI1UA0YW1pAAAAACIAAABAAAAAAAAAAAEAAAAAAAAAAAAAAA=="}};
const nativeReads=[{"status": 0, "bytes": 68, "data": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkM=", "wanted": 68, "start": 0}, {"status": -39, "bytes": 8, "data": "PD0+P0BBQkM=", "wanted": 16, "start": 60}, {"status": -39, "bytes": 0, "data": "", "wanted": 1, "start": 68}, {"status": -39, "bytes": 0, "data": "", "wanted": 0, "start": 68}, {"status": 0, "bytes": 4, "data": "AAABAg==", "wanted": 4, "start": -1}];
test('AudioFile URL streams exact native CAF metadata and compressed payload through the guest filesystem',async()=>{
 const x=urlFixture(nativeCAF),f=(name,...a)=>call(x.api,name,...a);
 assert.equal(await f('AudioFileOpenURL',1,1,0,32),0);const handle=x.read(32);assert.ok(handle);
 for(const [key,expected]of Object.entries(nativeProperties)){
  const bytes=Buffer.from(expected.data,'base64');x.write(36,bytes.length);
  assert.equal(f('AudioFileGetProperty',handle,Number(key),36,100),0);assert.deepEqual([...x.cpu.read(100,bytes.length)],[...bytes]);
 }
 for(const c of nativeReads.filter(c=>c.start>=0)){
  x.write(36,c.wanted);assert.equal(await f('AudioFileReadBytes',handle,0,c.start,0,36,200),c.status);
  assert.equal(x.read(36),c.bytes);assert.deepEqual([...x.cpu.read(200,c.bytes)],[...Buffer.from(c.data,'base64')]);
 }
 x.write(36,0xdead);x.write(40,3);assert.equal(await f('AudioFileReadPackets',handle,0,36,0,0,0,40,300),0);
 assert.equal(x.read(36),68);assert.equal(x.read(40),2);assert.deepEqual([...x.cpu.read(300,68)],Array.from({length:68},(_,i)=>i));
 x.write(36,34);x.write(40,3);assert.equal(await f('AudioFileReadPacketData',handle,0,36,0,0,0,40,300),0);assert.equal(x.read(36),34);assert.equal(x.read(40),1);
 assert.equal(await f('AudioFileClose',handle),0);assert.equal(x.closes(),1);assert.equal(f('AudioFileClose',handle),-38);
});
test('AudioFile URL failures close owned descriptors and reject write permissions without opening the asset',async()=>{
 const invalid=urlFixture(Buffer.from('invalid')),f=(name,...a)=>call(invalid.api,name,...a);
 assert.equal(await f('AudioFileOpenURL',1,1,0,32),tag('typ?'));assert.equal(invalid.read(32),0);assert.equal(invalid.closes(),1);
 const valid=urlFixture(nativeCAF);assert.equal(await call(valid.api,'AudioFileOpenURL',1,3,0,32),tag('prm?'));assert.equal(valid.opens(),0);
 assert.equal(await call(valid.api,'AudioFileOpenURL',1,1,0,32),0);await valid.api.close();assert.equal(valid.closes(),1);
 assert.equal(call(valid.api,'AudioFileGetProperty',valid.read(32),tag('dfmt'),36,100),-50);
});
