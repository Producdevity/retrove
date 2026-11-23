import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import { glesImports } from '../src/runtime/graphics/gles.ts';
import { write32 } from '../src/runtime/memory/guest-memory.ts';

function setup(gl) {
  const memory = new Uint8Array(4096);
  const cpu = { read: (p,n) => memory.slice(p,p+n), write: (p,b) => memory.set(b,p) };
  const heap={alloc:()=>2048,free:()=>{}};
  const imports = glesImports(cpu,heap,() => ({ isContextLost: () => false, ...gl }));
  return {cpu, call: (name,...args) => imports['_gl'+name](i => args[i])};
}

test('multi-string shader source respects per-string byte lengths and NUL termination', () => {
  let compiled;
  const {cpu,call} = setup({createShader: () => ({}), shaderSource: (_,source) => { compiled=source; }});
  const handle = call('CreateShader',0x8b31);
  const bytes = new TextEncoder();
  cpu.write(512,bytes.encode('first-extra')); cpu.write(640,bytes.encode('second\0ignored'));
  write32(cpu,256,512); write32(cpu,260,640); write32(cpu,320,5); write32(cpu,324,-1);
  call('ShaderSource',handle,2,256,320);
  assert.equal(compiled,'firstsecond');
});

test('upload PVRTC with native extension or decode 2/4 bpp and short mips to RGBA', async () => {
  const uploads=[], aligns=[];
  let native = false;
  const {cpu,call} = setup({
    getExtension: () => native ? {} : null,
    texImage2D: (...args) => uploads.push(args.at(-1)),
    compressedTexImage2D: (...args) => uploads.push(args.at(-1)),
    pixelStorei: (_,value) => aligns.push(value)
  });
  for (let i=0;i<32;i+=8) write32(cpu,516+i,0xfc00fc00); // both PVRTC color endpoints opaque pure red
  for(const format of [0x8c00,0x8c01,0x8c02,0x8c03]) {
    await call('CompressedTexImage2D',0x0de1,2,format,2,2,0,32,512);
    assert.deepEqual(uploads.at(-1),Uint8Array.from(Array(4).fill([255,0,0,255]).flat()));
  }
  assert.deepEqual(aligns,[1,4,1,4,1,4,1,4]);
  native=true;
  await call('CompressedTexImage2D',0x0de1,2,0x8c02,2,2,0,32,512);
  assert.deepEqual(uploads.at(-1),cpu.read(512,32));
});

test('OES mapped buffers preserve untouched bytes and upload ARM guest writes',()=>{
  let uploaded;
  const {cpu,call}=setup({createBuffer:()=>({}),bindBuffer(){},bufferData(){},
    bufferSubData:(_,offset,bytes)=>{assert.equal(offset,0);uploaded=bytes},getError:()=>0});
  call('GenBuffers',1,400);
  const name=new DataView(cpu.read(400,4).buffer).getUint32(0,true), target=0x8892;
  call('BindBuffer',target,name);
  cpu.write(512,Uint8Array.of(1,2,3,4));
  call('BufferData',target,4,512,0x88e4);
  const pointer=call('MapBufferOES',target,0x88b9);
  assert.equal(pointer,2048);
  cpu.write(pointer+2,Uint8Array.of(8));
  assert.equal(call('UnmapBufferOES',target),1);
  assert.deepEqual(uploaded,Uint8Array.of(1,2,8,4));
  assert.equal(call('UnmapBufferOES',target),0);
  assert.equal(call('GetError'),0x0502); assert.equal(call('GetError'),0);
});

test('OES mapped buffers reuse their guest block and refresh it after the buffer changes',()=>{
  const {cpu,call}=setup({createBuffer:()=>({}),bindBuffer(){},bufferData(){},bufferSubData(){},getError:()=>0});
  call('GenBuffers',1,400);
  const name=new DataView(cpu.read(400,4).buffer).getUint32(0,true), target=0x8892;
  call('BindBuffer',target,name);
  cpu.write(512,Uint8Array.of(1,2,3,4));
  call('BufferData',target,4,512,0x88e4);
  const pointer=call('MapBufferOES',target,0x88b9);
  cpu.write(pointer,Uint8Array.of(9));
  call('UnmapBufferOES',target);
  assert.equal(call('MapBufferOES',target,0x88b9),pointer);
  assert.deepEqual(cpu.read(pointer,4),Uint8Array.of(9,2,3,4));
  call('UnmapBufferOES',target);
  cpu.write(512,Uint8Array.of(5));
  call('BufferSubData',target,1,1,512);
  assert.equal(call('MapBufferOES',target,0x88b9),pointer);
  assert.deepEqual(cpu.read(pointer,4),Uint8Array.of(9,5,3,4));
  call('UnmapBufferOES',target);
  call('BufferData',target,4,0,0x88e4);
  assert.equal(call('MapBufferOES',target,0x88b9),pointer);
  assert.deepEqual(cpu.read(pointer,4),Uint8Array.of(0,0,0,0));
});

test('BioShock derivative directive precedes pixel shader declarations while retaining #version',()=>{
  const header='/* build */\r\n#version 100\r\n', precision='precision mediump float;\r\n';
  const block=['#define USE_DERIVATIVES 0','#ifdef GL_OES_standard_derivatives','\t#extension GL_OES_standard_derivatives : enable','\t#undef USE_DERIVATIVES','\t#define USE_DERIVATIVES 1','#endif',''].join('\r\n');
  let source, extension;
  const {cpu,call}=setup({createShader:()=>({}),shaderSource:(_,s)=>{source=s;},getExtension:n=>{extension=n;}});
  const shader=call('CreateShader',0x8b30);
  write32(cpu,256,512);
  cpu.write(512,new TextEncoder().encode(header+precision+block+'void main(){}\0'));
  call('ShaderSource',shader,1,256,0);
  assert.equal(extension,'OES_standard_derivatives');
  assert.equal(source,header+block+precision+'void main(){}');
});

test('GLES object queries return false for other object types, zero and unknown names', () => {
  const shader={},program={},buffer={};
  const {cpu,call}=setup({
    createShader:()=>shader,createProgram:()=>program,createBuffer:()=>buffer,
    isShader:object=>{assert.equal(object,shader);return true;},
    isProgram:object=>{assert.equal(object,program);return true;},
    isBuffer:object=>{assert.equal(object,buffer);return true;},
    deleteBuffer:object=>assert.equal(object,buffer),
  });
  const shaderId=call('CreateShader',0x8b31),programId=call('CreateProgram');
  call('GenBuffers',1,400);
  const bufferId=new DataView(cpu.read(400,4).buffer).getUint32(0,true);
  for(const [name,valid] of [['Shader',shaderId],['Program',programId],['Buffer',bufferId]])
    for(const handle of [shaderId,programId,bufferId,0,999])
      assert.equal(call('Is'+name,handle),Number(handle===valid));
  call('DeleteBuffers',1,400);
  assert.equal(call('IsBuffer',bufferId),0);
});
