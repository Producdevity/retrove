import {glesImports} from '../web/gles.mjs';
import {eaglDrawable} from '../web/drawable.mjs';
import {read32, write32} from '../web/memory.mjs';

export async function render(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext(kind, {alpha:false, antialias:false, preserveDrawingBuffer:true});
  if (!gl) throw Error(kind + ' unavailable');
  const memory = new Uint8Array(65536);
  const cpu = {read:(address, length) => memory.slice(address,address+length),
    write:(address, bytes) => memory.set(bytes,address)};
  const heap = {string: () => 0};
  const funcs = glesImports(cpu, heap, () => gl);
  const call = (name, ...args) => funcs['_gl'+name](i => args[i]);
  const drawable = eaglDrawable(() => gl);
  function equal(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(JSON.stringify({actual, expected}));
  }
  let cursor = 64;
  function string(s) {
    const b = new TextEncoder().encode(s + '\0'), at = cursor;
    cursor += Math.ceil(b.length / 4) * 4;
    cpu.write(at,b); return at;
  }
  function create(kind) { call('Gen'+kind+'s',1,8); return read32(cpu,8); }
  function shader(type,source) {
    const s = call('CreateShader',type);
    write32(cpu,16,string(source)); call('ShaderSource',s,1,16,0); call('CompileShader',s);
    call('GetShaderiv',s,gl.COMPILE_STATUS,8); equal(read32(cpu,8),1); return s;
  }

  const renderbuffer = create('Renderbuffer'), dest = create('Framebuffer');
  call('BindRenderbuffer',gl.RENDERBUFFER,renderbuffer);
  equal(drawable.allocate(gl.RENDERBUFFER,1),1);
  call('BindFramebuffer',gl.FRAMEBUFFER,dest);
  call('FramebufferRenderbuffer',gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,renderbuffer);
  const multisample = kind === 'webgl2', samples = multisample ? Math.min(4,gl.getParameter(gl.MAX_SAMPLES)) : 0;
  if (multisample) {
    if (!samples) throw Error('Expected multisample color renderbuffer');
    const src = create('Framebuffer'), ms = create('Renderbuffer');
    call('BindRenderbuffer',gl.RENDERBUFFER,ms);
    call('RenderbufferStorageMultisampleAPPLE',gl.RENDERBUFFER,samples,gl.RGBA8,16,16);
    call('BindFramebuffer',gl.FRAMEBUFFER,src);
    call('FramebufferRenderbuffer',gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,ms);
  }
  equal(call('CheckFramebufferStatus',gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE);
  const p = call('CreateProgram');
  equal(call('IsShader',p),0); equal(call('IsProgram',p),1);
  equal(call('IsShader',0),0); equal(call('IsShader',0xffffffff),0);
  call('AttachShader',p,shader(gl.VERTEX_SHADER,'attribute vec2 pos;void main(){gl_Position=vec4(pos,0.,1.);}'));
  call('AttachShader',p,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,vec2(.5));}'));
  call('LinkProgram',p); call('UseProgram',p);
  call('GetProgramiv',p,gl.LINK_STATUS,8); equal(read32(cpu,8),1);
  const pos = call('GetAttribLocation',p,string('pos'));
  call('BindTexture',gl.TEXTURE_2D,create('Texture'));
  cpu.write(2048,Uint8Array.of(0,0,255,255));
  call('TexImage2D',gl.TEXTURE_2D,0,0x80e1,1,1,0,0x80e1,gl.UNSIGNED_BYTE,2048);
  call('TexParameteri',gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  call('TexParameteri',gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  cpu.write(4096,new Uint8Array(new Float32Array([-1,-1,3,-1,-1,3]).buffer));
  call('BindBuffer',gl.ARRAY_BUFFER,0);
  call('VertexAttribPointer',pos,2,gl.FLOAT,0,0,4096);
  call('EnableVertexAttribArray',pos);
  cpu.write(8192,new Uint8Array(new Uint32Array([0,1,2]).buffer));
  call('DrawElements',gl.TRIANGLES,3,gl.UNSIGNED_INT,8192);
  if (multisample) {
    call('BindFramebuffer',gl.DRAW_FRAMEBUFFER,dest);
    call('Enable',gl.SCISSOR_TEST); call('Scissor',0,0,1,1);
    call('ResolveMultisampleFramebufferAPPLE');
    equal(gl.isEnabled(gl.SCISSOR_TEST),true);
  }
  call('BindRenderbuffer',gl.RENDERBUFFER,renderbuffer);
  const bindings = multisample ? [gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)] : null;
  equal(drawable.present(gl.RENDERBUFFER),1);
  if (multisample && (bindings[0] !== gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) || bindings[1] !== gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING))) throw Error('Lost framebuffer bindings');
  call('BindFramebuffer',gl.FRAMEBUFFER,0);
  call('ReadPixels',8,8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,1024);
  const pixel = Array.from(cpu.read(1024,4));
  equal(pixel,[255,0,0,255]); equal(call('GetError'),0); return {kind,samples,pixel};
}
