import assert from 'node:assert/strict';
import test from 'node:test';
import { audioImports } from '../web/audio.mjs';
import { read32, write32 } from '../web/memory.mjs';

function audioFixture() {
  const mem=new Uint8Array(1<<20);
  const cpu={read:(p,n)=>mem.slice(p,p+n),write:(p,b)=>mem.set(b,p)};
  const heap={alloc:()=>4096,free:()=>{}};
  const captured=[], callbackArgs=[];
  const ac={state:'running',currentTime:1,destination:{},
    createBuffer:(channels,frames,rate)=>{
      const out=Array.from({length:channels},()=>new Float32Array(frames));
      return {getChannelData:c=>out[c],sampleRate:rate,out};
    },
    createBufferSource:()=>({connect(){},disconnect(){},stop(){this.stopped=true},start(t){this.t=t;captured.push(this)}})
  };
  const cb=async (pc,args)=>{
    callbackArgs.push({pc,args,timestamp:new DataView(cpu.read(args[2],64).buffer).getFloat64(0,true)});
    assert.equal(args[0],0x5555); assert.equal(args[3],0);
    const list=args[5];
    assert.equal(read32(cpu,list),1);
    assert.equal(read32(cpu,list+4),2);
    assert.equal(read32(cpu,list+8),args[4]*4);
    const data=read32(cpu,list+12), v=new DataView(mem.buffer);
    for(let i=0;i<args[4];i++) {v.setInt16(data+4*i,-16384,true);v.setInt16(data+4*i+2,24576,true);}
    return 0;
  };
  const audio=audioImports(cpu,heap,cb,()=>ac);
  const call=(name,...args)=>audio.funcs['_'+name](n=>args[n]??0);
  const component=call('AudioComponentFindNext',0,64);
  assert.equal(component,0x72696f63);
  assert.equal(call('AudioComponentInstanceNew',component,32),0);
  const u=read32(cpu,32);
  write32(cpu,288,0x1235);write32(cpu,292,0x5555);
  assert.equal(call('AudioUnitSetProperty',u,23,1,0,288,8),0);
  return {cpu,ac,call,u,audio,captured,callbackArgs};
}

test('RemoteIO renders guest interleaved callback into correctly timed stereo Web Audio buffers',async()=>{
  const {u,audio,ac,call,captured,callbackArgs}=audioFixture();
  assert.equal(call('AudioUnitInitialize',u),0);
  assert.equal(call('AudioOutputUnitStart',u),0);
  await audio.pump();
  assert.equal(captured.length,3);
  for(let i=0;i<3;i++){
    assert.equal(callbackArgs[i].pc,0x1235);
    assert.equal(callbackArgs[i].timestamp,1024*i);
    const node=captured[i];
    assert.equal(node.buffer.sampleRate,44100);
    assert.equal(node.buffer.out[0][0],-0.5); assert.equal(node.buffer.out[1][1023],0.75);
    assert.ok(Math.abs(node.t-(1.005+1024*i/44100))<1e-9);
  }
  await audio.pump(); assert.equal(captured.length,3);
  ac.currentTime+=0.025; await audio.pump(); assert.equal(captured.length,4);
  assert.equal(call('AudioOutputUnitStop',u),0);
  assert.ok(captured.every(n=>n.stopped));
  audio.close();
});

test('RemoteIO rejects noninterleaved formats and invalid property scopes without starting',()=>{
  const {cpu,u,call,audio}=audioFixture();
  write32(cpu,320,40);
  assert.equal(call('AudioUnitGetProperty',u,8,1,0,512,320),0);
  write32(cpu,524,12|32);
  assert.equal(call('AudioUnitSetProperty',u,8,1,0,512,40),-10868);
  assert.equal(call('AudioUnitSetProperty',u,8,2,0,512,40),-10866);
  assert.equal(call('AudioOutputUnitStart',u),-10867);
  assert.equal(call('AudioComponentInstanceDispose',u),0);
  assert.equal(call('AudioUnitInitialize',u),-50); audio.close();
});
