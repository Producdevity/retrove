import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {doubleBits,floatBits,floatFromBits} from '../../src/runtime/ios/abi/scalars.ts';
function context(){
 const samples=new Float32Array(8000),nodes=[];
 const buffer={duration:1,length:8000,sampleRate:8000,numberOfChannels:1,getChannelData:()=>samples};
 const ctx={currentTime:5,state:'running',destination:{},decodeAudioData:async bytes=>{if(new Uint8Array(bytes)[0]!==42)throw Error('Corrupt fixture');return buffer;},
  createBufferSource:()=>{const node={playbackRate:{value:1},connect(){},disconnect(){},start(...args){this.startArgs=args;},stop(...args){this.stopArgs=args;}};nodes.push(node);return node;},
  createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),createStereoPanner:()=>({pan:{value:0},connect(){},disconnect(){}})};
 return {ctx,nodes};
}
const words=value=>{const bits=doubleBits(value);return [Number(bits&0xffffffffn),Number(bits>>32n)];};
test('AVAudioPlayer copies input data, returns scalar ABI values and delivers completion through the main pump',async t=>{
 const {ctx,nodes}=context(),callbacks=[];
 const x=await fixture(t,async(pc,args)=>{assert.equal(pc,0x6300);callbacks.push(args.slice(2));},new Map(),{audioOutput:()=>ctx});
 const pool=x.f('_objc_autoreleasePoolPush'),source=x.heap.alloc(4);x.cpu.write(source,Uint8Array.of(42,7,9,0));
 const data=await x.send(x.cls('NSMutableData'),'dataWithBytes:length:',source,4);
 const player=await x.send(x.cls('AVAudioPlayer'),'alloc'),error=x.heap.zero(4);x.write(error,0xabc);
 assert.equal(await x.send(player,'initWithData:error:',data,error),player);assert.equal(x.read(error),0xabc);
 const copied=await x.send(player,'data');assert.notEqual(copied,data);assert.equal(await x.send(copied,'length'),4);assert.equal(await x.send(player,'url'),0);
 const klass=x.instance('AudioPlayerDelegate',[['audioPlayerDidFinishPlaying:successfully:',0x6300]]);x.install({'__objc_classlist':[klass]});const delegate=await x.send(klass,'new');
 const refs=await x.send(delegate,'retainCount');await x.send(player,'setDelegate:',delegate);assert.equal(await x.send(delegate,'retainCount'),refs);
 await x.f('_objc_autoreleasePoolPop',pool);assert.equal(x.heap.live.has(copied),true);assert.equal(await x.send(player,'duration'),doubleBits(1));assert.equal(await x.send(player,'numberOfChannels'),1);
 await x.send(player,'setVolume:',floatBits(.25));assert.equal(floatFromBits(await x.send(player,'volume')),.25);
 await x.send(player,'setCurrentTime:',...words(.125));assert.equal(await x.send(player,'currentTime'),doubleBits(.125));assert.equal(await x.send(player,'prepareToPlay'),1);assert.equal(await x.send(player,'play'),1);
 assert.deepEqual(nodes[0].startArgs,[5,.125]);assert.equal(await x.send(player,'isPlaying'),1);assert.deepEqual(callbacks,[]);
 nodes[0].onended();assert.deepEqual(callbacks,[]);await x.objc.pumpAudioPlayers();await x.objc.pumpAudioPlayers();assert.deepEqual(callbacks,[[player,1]]);
 assert.equal(await x.send(player,'isPlaying'),0);await x.send(player,'release');assert.equal(x.heap.live.has(copied),false);await x.send(delegate,'release');x.heap.free(source);x.heap.free(error);x.objc.close();
});
test('AVAudioPlayer corrupt input returns a real NSError and releases the failed initializer',async t=>{
 const {ctx}=context(),x=await fixture(t,undefined,new Map(),{audioOutput:()=>ctx});const pool=x.f('_objc_autoreleasePoolPush'),p=x.heap.alloc(1);x.cpu.write(p,Uint8Array.of(0));
 const data=await x.send(x.cls('NSData'),'dataWithBytes:length:',p,1),player=await x.send(x.cls('AVAudioPlayer'),'alloc'),error=x.heap.zero(4);
 assert.equal(await x.send(player,'initWithData:error:',data,error),0);assert.equal(x.heap.live.has(player),false);assert.notEqual(x.read(error),0);assert.equal(await x.send(x.read(error),'code'),0x6474613f);
 await x.f('_objc_autoreleasePoolPop',pool);x.heap.free(error);x.heap.free(p);x.objc.close();
});
