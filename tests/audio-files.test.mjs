import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {tag,audioFiles} from '../web/audio-file.mjs';
import {audioQueues} from '../web/audio-queue.mjs';
import {systemSounds} from '../web/system-sound.mjs';
import {read32,write32} from '../web/memory.mjs';

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
  assert.equal(await call(fs,'AudioFileReadPacketData',f,0,36,0,1,0,40,300),-39);
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
