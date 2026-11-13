import {GraphicsObjects} from '../src/runtime/graphics/objects.ts';
import { read32, readString, write32 } from './memory.mjs';
import { decodePVRTC } from './pvrtc.mjs';

const ARRAY_BUFFER = 0x8892;
const ELEMENT_ARRAY_BUFFER = 0x8893;
const STATIC_DRAW = 0x88e4;
const HALF_FLOAT_OES = 0x8d61, HALF_FLOAT = 0x140b, BGRA = 0x80e1, RGBA = 0x1908, UBYTE = 0x1401;
const bytesPerType = new Map([[0x1400,1],[0x1401,1],[0x1402,2],[0x1403,2],[0x1405,4],[0x1406,4]]);
const pixelComponents = new Map([[0x1906,1],[0x1909,1],[0x190a,2],[0x1907,3],[RGBA,4],[BGRA,4],[0x1902,1]]);
const packedTypes = new Set([0x8363,0x8033,0x8034]);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function values(arg, count) { return Array.from({ length: count }, (_, i) => arg(i)); }
function signed(value) { return value | 0; }

export function glesImports(cpu, heap, getContext, diagnostic) {
  const api = {};
  const objects = new GraphicsObjects();
  const strings = new Map();
  const uniformLocations = new Map();
  const compilerWarnings = new Set();
  const clientArrays = new Map();
  const enabledAttribs = new Set();
  const bufferData = new Map();
  const mapped = new Map();
  let pendingError = 0;
  const setError = code => { pendingError ||= code; };
  const scratch = new DataView(new ArrayBuffer(4));
  let nextLocation = 0, array = 0, elements = 0;
  let indexStaging, context;
  let packAlign = 4, unpackAlign = 4;

  function gl() {
    context ??= getContext();
    if (!context) throw new Error('WebGL 1 context is unavailable');
    if (context.isContextLost()) throw new Error('WebGL context lost');
    return context;
  }
  function bind(name, impl) { api['_gl' + name] = impl; }
  const id=(object,kind)=>objects.register(object,kind);
  const obj=handle=>objects.get(handle);
  function f(word) { scratch.setUint32(0, word, true); return scratch.getFloat32(0,true); }
  function writeNumber(pointer, value, kind) {
    if (kind === 'boolean') { cpu.write(pointer, Uint8Array.of(Number(value) !== 0 ? 1 : 0)); return; }
    if (kind === 'float') { scratch.setFloat32(0, value, true); value = scratch.getUint32(0,true); }
    write32(cpu,pointer,value);
  }
  function sourceBuffer(pointer, length, Type = Uint8Array) {
    if (!Number.isSafeInteger(length) || length < 0 || length > 256 * 1024 * 1024) throw new Error('Invalid GLES buffer length: ' + length);
    const bytes = cpu.read(pointer,length);
    return new Type(bytes.buffer, bytes.byteOffset,length / Type.BYTES_PER_ELEMENT);
  }
  function writeString(text, capacity, lengthPointer, dest) {
    const b = encoder.encode(text || '');
    const n = Math.max(0, Math.min(b.length, signed(capacity) - 1));
    if (capacity > 0 && dest) {
      if (n) cpu.write(dest,b.subarray(0,n));
      cpu.write(dest + n, Uint8Array.of(0));
    }
    if (lengthPointer) write32(cpu,lengthPointer,n);
  }
  const simple = {
    ActiveTexture:1, BlendEquation:1, BlendEquationSeparate:2, BlendFunc:2,
    BlendFuncSeparate:4, Clear:1, ClearStencil:1, ColorMask:4, CullFace:1, DepthFunc:1,
    DepthMask:1, Disable:1, Enable:1, Finish:0, Flush:0, FrontFace:1,
    GenerateMipmap:1, Hint:2, Scissor:4, StencilFunc:3, StencilFuncSeparate:4,
    StencilMask:1, StencilMaskSeparate:2, StencilOp:3, StencilOpSeparate:4,
    TexParameteri:3, Viewport:4, CheckFramebufferStatus:1, GetError:0, IsEnabled:1,
  };
  for (const [name,n] of Object.entries(simple)) {
    const method = name[0].toLowerCase() + name.slice(1);
    bind(name, a => gl()[method](...values(a,n)));
  }
  for (const [name,method,n] of [
    ['ClearColor','clearColor',4], ['ClearDepthf','clearDepth',1], ['DepthRangef','depthRange',2],
    ['BlendColor','blendColor',4], ['LineWidth','lineWidth',1], ['PolygonOffset','polygonOffset',2],
  ]) bind(name,a => gl()[method](...values(a,n).map(f)));
  bind('SampleCoverage', a => gl().sampleCoverage(f(a(0)),!!a(1)));
  bind('TexParameterf', a => gl().texParameterf(a(0),a(1),f(a(2))));
  bind('PixelStorei', a => {
    gl().pixelStorei(a(0),a(1));
    if (![1,2,4,8].includes(a(1))) return;
    if (a(0) === 0x0cf5) unpackAlign = a(1);
    if (a(0) === 0x0d05) packAlign = a(1);
  });
  bind('GetString', a => {
    const pname = a(0);
    if (!strings.has(pname)) {
      let text;
      switch (pname) {
        case 0x1f02: text = 'OpenGL ES 2.0 WebGL'; break;
        case 0x8b8c: text = 'OpenGL ES GLSL ES 1.00'; break;
        case 0x1f03: {
          const names = ['GL_OES_mapbuffer'];
          if (gl().getExtension('OES_standard_derivatives')) names.push('GL_OES_standard_derivatives');
          if (gl().blitFramebuffer) names.push('GL_APPLE_framebuffer_multisample','GL_OES_rgb8_rgba8','GL_OES_vertex_half_float');
          if (gl().blitFramebuffer || gl().getExtension('OES_element_index_uint')) names.push('GL_OES_element_index_uint');
          if (gl().blitFramebuffer || gl().getExtension('OES_texture_half_float')) names.push('GL_OES_texture_half_float');
          names.push('GL_IMG_texture_compression_pvrtc','GL_EXT_texture_format_BGRA8888');
          text = names.join(' '); break;
        }
        case 0x1f00: case 0x1f01: text = gl().getParameter(pname); break;
        default: return 0;
      }
      strings.set(pname,heap.string(text));
    }
    return strings.get(pname);
  });
  for (const [name,kind] of [['GetIntegerv','int'],['GetFloatv','float'],['GetBooleanv','boolean']]) {
    bind(name, a => {
      const pname = a(0);
      let answer;
      if (pname===0x86a2 || pname===0x86a3) {
        pvrtc();
        const formats = [...new Set([...(gl().getParameter(0x86a3)||[]),0x8c00,0x8c01,0x8c02,0x8c03])];
        answer = pname===0x86a2 ? formats.length : formats;
      } else if (pname === 0x8d57 && !gl().blitFramebuffer) answer = 0; // MAX_SAMPLES_APPLE
      else answer = gl().getParameter(pname);
      const list = ArrayBuffer.isView(answer) || Array.isArray(answer) ? answer : [answer];
      for (let i=0; i<list.length; i++) {
        let value = list[i];
        if (value === null || typeof value === 'object') value = id(value);
        writeNumber(a(1) + (kind === 'boolean' ? i : 4*i), value, kind);
      }
    });
  }
  for (const kind of ['Buffer','Texture','Framebuffer','Renderbuffer']) {
    bind('Gen' + kind + 's', a => {
      for (let i=0; i<signed(a(0)); i++) write32(cpu,a(1)+i*4,id(gl()['create'+kind](),kind));
    });
    bind('Delete' + kind + 's', a => {
      for (let i=0; i<signed(a(0)); i++) {
        const number = read32(cpu,a(1)+i*4);
        if (!objects.is(number,kind)) continue;
        const target = obj(number);
        gl()['delete'+kind](target);
        objects.remove(number);
        if (kind === 'Buffer') {
          bufferData.delete(number);
          if (mapped.has(number)) { heap.free(mapped.get(number)); mapped.delete(number); }
          if (array === number) array = 0;
          if (elements === number) elements = 0;
        }
      }
    });
    bind('Bind' + kind, a => {
      gl()['bind'+kind](a(0),obj(a(1)));
      if (kind === 'Buffer') {
        if (a(0) === ARRAY_BUFFER) array = a(1);
        if (a(0) === ELEMENT_ARRAY_BUFFER) elements = a(1);
      }
    });
    bind('Is' + kind, a => Number(objects.is(a(0),kind) && gl()['is'+kind](obj(a(0)))));
  }
  bind('BufferData', a => {
    const bytes = a(2) ? sourceBuffer(a(2),a(1)) : null;
    gl().bufferData(a(0),bytes ?? a(1),a(3));
    const name = a(0)===ARRAY_BUFFER ? array : elements;
    if (name) {
      if (mapped.has(name)) {heap.free(mapped.get(name)); mapped.delete(name);}
      bufferData.set(name,{size:a(1),bytes});
    }
  });
  bind('BufferSubData', a => {
    const bytes = sourceBuffer(a(3),a(2));
    gl().bufferSubData(a(0),a(1),bytes);
    const backing = bufferData.get(a(0)===ARRAY_BUFFER ? array : elements);
    if (backing && a(1)+bytes.length<=backing.size) {
      backing.bytes ??= new Uint8Array(backing.size);
      backing.bytes.set(bytes,a(1));
    }
  });
  bind('GetError',() => {const code=pendingError; pendingError=0; return code || gl().getError();});
  function boundBuffer(target) { return target===ARRAY_BUFFER ? array : target===ELEMENT_ARRAY_BUFFER ? elements : 0; }
  bind('MapBufferOES',a => {
    if (a(1)!==0x88b9) { setError(0x0500); return 0; } // GL_WRITE_ONLY_OES
    const name=boundBuffer(a(0)), backing=bufferData.get(name);
    if (!name || !backing || mapped.has(name)) {setError(0x0502); return 0;}
    const pointer=heap.alloc(backing.size);
    if (!pointer) {setError(0x0505); return 0;}
    cpu.write(pointer,backing.bytes ?? new Uint8Array(backing.size));
    mapped.set(name,pointer);
    return pointer;
  });
  bind('UnmapBufferOES',a => {
    const name=boundBuffer(a(0)), pointer=mapped.get(name), backing=bufferData.get(name);
    if (!pointer || !backing) {setError(0x0502); return 0;}
    const bytes=sourceBuffer(pointer,backing.size);
    gl().bufferSubData(a(0),0,bytes); backing.bytes=bytes;
    mapped.delete(name); heap.free(pointer);
    return 1;
  });
  bind('GetBufferPointervOES',a => {
    if (a(1)!==0x88bd) {setError(0x0500); return;}
    write32(cpu,a(2),mapped.get(boundBuffer(a(0))) ?? 0);
  });
  bind('CreateShader', a => id(gl().createShader(a(0)),'Shader'));
  bind('CreateProgram', () => id(gl().createProgram(),'Program'));
  for (const name of ['CompileShader','DeleteShader','LinkProgram','UseProgram','DeleteProgram','ValidateProgram']) {
    const method = name[0].toLowerCase() + name.slice(1);
    bind(name, a => gl()[method](obj(a(0))));
  }
  for(const kind of ['Shader','Program'])bind('Is'+kind,a=>Number(objects.is(a(0),kind)&&gl()['is'+kind](obj(a(0)))));
  bind('AttachShader', a => gl().attachShader(obj(a(0)),obj(a(1))));
  bind('DetachShader', a => gl().detachShader(obj(a(0)),obj(a(1))));
  bind('BindAttribLocation', a => gl().bindAttribLocation(obj(a(0)),a(1),readString(cpu,a(2))));
  bind('GetAttachedShaders',a => {
    const shaders = (gl().getAttachedShaders(obj(a(0))) || []).slice(0,a(1));
    if (a(2)) write32(cpu,a(2),shaders.length);
    shaders.forEach((shader,i)=>write32(cpu,a(3)+4*i,id(shader,'Shader')));
  });
  bind('GetAttribLocation', a => gl().getAttribLocation(obj(a(0)),readString(cpu,a(1))));
  bind('GetUniformLocation', a => {
    const u = gl().getUniformLocation(obj(a(0)),readString(cpu,a(1)));
    if (u == null) return -1;
    const number = nextLocation++;
    uniformLocations.set(number,u);
    return number;
  });
  function location(number) {
    if (number === 0xffffffff || number === -1) return null;
    if (!uniformLocations.has(number)) throw new Error('Unknown GLES uniform location ' + number);
    return uniformLocations.get(number);
  }
  bind('ShaderSource', a => {
    const source = [];
    for (let i=0; i<signed(a(1)); i++) {
      const p = read32(cpu,a(2) + 4*i);
      const n = a(3) ? signed(read32(cpu,a(3) + 4*i)) : -1;
      source.push(n < 0 ? readString(cpu,p) : decoder.decode(sourceBuffer(p,n)));
    }
    let joined=source.join('');
    if (joined.includes('GL_OES_standard_derivatives')) {
      gl().getExtension('OES_standard_derivatives');
      // BioShock places its optional extension after declarations. GLSL ES
      // requires the directive before declarations and after any #version line.
      const block=joined.match(/^#define USE_DERIVATIVES 0\r?\n#ifdef GL_OES_standard_derivatives\r?\n\t#extension GL_OES_standard_derivatives : enable\r?\n\t#undef USE_DERIVATIVES\r?\n\t#define USE_DERIVATIVES 1\r?\n#endif\r?\n/m);
      if (block) {
        const header=joined.match(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*#version[^\n]*\n/);
        const insertion=header?.[0].length || 0;
        if (block.index>insertion) joined=joined.slice(0,insertion)+block[0]+joined.slice(insertion,block.index)+joined.slice(block.index+block[0].length);
      }
    }
    gl().shaderSource(obj(a(0)),joined);
  });
  for (const kind of ['Program','Shader']) {
    bind('Get'+kind+'iv', a => {
      const target = obj(a(0)), pname = a(1);
      let value;
      if (pname === 0x8b84) value = (gl()['get'+kind+'InfoLog'](target) || '').length + 1;
      else if (kind === 'Shader' && pname === 0x8b88) value = (gl().getShaderSource(target) || '').length + 1;
      else if (kind === 'Program' && (pname === 0x8b87 || pname === 0x8b8a)) {
        const isUniform = pname === 0x8b87;
        const total = gl().getProgramParameter(target,isUniform ? 0x8b86 : 0x8b89);
        value = 0;
        for (let i=0;i<total;i++) value = Math.max(value,gl()[isUniform ? 'getActiveUniform':'getActiveAttrib'](target,i).name.length+1);
      } else value = gl()['get'+kind+'Parameter'](target,pname);
      if (diagnostic && !value && compilerWarnings.size < 12 &&
          ((kind === 'Shader' && pname === 0x8b81) || (kind === 'Program' && pname === 0x8b82))) {
        const log = gl()['get'+kind+'InfoLog'](target) || 'The driver returned an empty log.';
        const event = kind === 'Shader' ? 'Guest shader compilation failed' : 'Guest program link failed';
        if (!compilerWarnings.has(event + log)) {
          compilerWarnings.add(event + log);
          diagnostic('warn','graphics',event,{handle:a(0),log:log.slice(0,2048)});
        }
      }
      write32(cpu,a(2),Number(value));
    });
    bind('Get'+kind+'InfoLog', a => writeString(gl()['get'+kind+'InfoLog'](obj(a(0))),a(1),a(2),a(3)));
  }
  for (const kind of ['ActiveAttrib','ActiveUniform']) {
    bind('Get'+kind, a => {
      const info = gl()['get'+kind](obj(a(0)),a(1));
      if (!info) return;
      if (a(4)) write32(cpu,a(4),info.size);
      if (a(5)) write32(cpu,a(5),info.type);
      writeString(info.name,a(2),a(3),a(6));
    });
  }
  for (let n=1; n<=4; n++) for (const type of ['f','i']) {
    bind('Uniform'+n+type,a => gl()['uniform'+n+type](location(a(0)),...Array.from({length:n},(_,i)=>type==='f' ? f(a(i+1)) : signed(a(i+1)))));
    bind('Uniform'+n+type+'v',a => gl()['uniform'+n+type+'v'](location(a(0)),sourceBuffer(a(2),a(1)*n*4,type==='f'?Float32Array:Int32Array)));
  }
  for (const n of [2,3,4]) bind('UniformMatrix'+n+'fv',a =>
    gl()['uniformMatrix'+n+'fv'](location(a(0)),!!a(2),sourceBuffer(a(3),a(1)*n*n*4,Float32Array)));
  for (let n=1; n<=4; n++) {
    bind('VertexAttrib'+n+'f',a => gl()['vertexAttrib'+n+'f'](a(0),...Array.from({length:n},(_,i)=>f(a(i+1)))));
    bind('VertexAttrib'+n+'fv',a => gl()['vertexAttrib'+n+'fv'](a(0),sourceBuffer(a(1),n*4,Float32Array)));
  }
  bind('EnableVertexAttribArray',a => { gl().enableVertexAttribArray(a(0)); enabledAttribs.add(a(0)); });
  bind('DisableVertexAttribArray',a => { gl().disableVertexAttribArray(a(0)); enabledAttribs.delete(a(0)); });
  bind('VertexAttribPointer',a => {
    const [index,size,guestType,normalized,stride,pointer] = values(a,6);
    const type = guestType === HALF_FLOAT_OES && gl().blitFramebuffer ? HALF_FLOAT : guestType;
    if (array) {
      const old = clientArrays.get(index);
      if (old?.staging) gl().deleteBuffer(old.staging);
      clientArrays.delete(index);
      gl().vertexAttribPointer(index,size,type,!!normalized,stride,pointer);
    } else {
      clientArrays.set(index,{size,type,normalized:!!normalized,stride,pointer,staging:clientArrays.get(index)?.staging});
    }
  });
  function stageAttributes(lastIndex) {
    if (lastIndex < 0) return;
    for (const [index,attr] of clientArrays) {
      if (!enabledAttribs.has(index)) continue;
      const width = (attr.type === HALF_FLOAT ? 2 : bytesPerType.get(attr.type)) * attr.size;
      if (!width) throw new Error('Unsupported GLES vertex type 0x'+attr.type.toString(16));
      const length = (attr.stride || width)*lastIndex + width;
      attr.staging ??= gl().createBuffer();
      gl().bindBuffer(ARRAY_BUFFER,attr.staging);
      gl().bufferData(ARRAY_BUFFER,sourceBuffer(attr.pointer,length),STATIC_DRAW);
      gl().vertexAttribPointer(index,attr.size,attr.type,attr.normalized,attr.stride,0);
    }
    gl().bindBuffer(ARRAY_BUFFER,obj(array));
  }
  bind('DrawArrays',a => {
    if (clientArrays.size && a(2)) stageAttributes(signed(a(1))+signed(a(2))-1);
    gl().drawArrays(a(0),signed(a(1)),signed(a(2)));
  });
  bind('DrawElements',a => {
    const [mode,count,type,pointer] = values(a,4);
    const width = type === 0x1401 ? 1 : type === 0x1403 ? 2 : type === 0x1405 && (gl().blitFramebuffer || gl().getExtension('OES_element_index_uint')) ? 4 : 0;
    if (!width) throw new Error('Unsupported GLES index type 0x'+type.toString(16));
    const live = [...clientArrays.keys()].some(index => enabledAttribs.has(index));
    let indices;
    if (!elements) {
      indices = sourceBuffer(pointer,count*width);
      indexStaging ??= gl().createBuffer();
      gl().bindBuffer(ELEMENT_ARRAY_BUFFER,indexStaging);
      gl().bufferData(ELEMENT_ARRAY_BUFFER,indices,STATIC_DRAW);
    } else if (live) {
      const backing = bufferData.get(elements);
      if (backing && !backing.bytes) backing.bytes = new Uint8Array(backing.size);
      const bytes = backing?.bytes;
      if (!bytes || pointer+count*width>bytes.length) throw new Error('GLES element buffer data unavailable for client vertex arrays');
      indices = bytes.subarray(pointer,pointer+count*width);
    }
    if (live && count) {
      let max = 0;
      const view = new DataView(indices.buffer,indices.byteOffset,indices.byteLength);
      for (let i=0; i<count; i++) {
        const index = width === 1 ? indices[i] : width === 2 ? view.getUint16(i*2,true) : view.getUint32(i*4,true);
        if (index>max) max=index;
      }
      stageAttributes(max);
    }
    gl().drawElements(mode,count,type,elements ? pointer : 0);
    if (!elements) gl().bindBuffer(ELEMENT_ARRAY_BUFFER,null);
  });
  bind('DrawRangeElements',a => {
    const p=[a(0),a(3),a(4),a(5)];
    return api._glDrawElements(i=>p[i]);
  });
  // EXT_discard_framebuffer is a hint. WebGL 1 always preserves these attachments.
  bind('DiscardFramebufferEXT',() => {});
  function pixels(w,h,format,type,alignment,pointer) {
    const n = pixelComponents.get(format), width = packedTypes.has(type) || type === HALF_FLOAT || type === HALF_FLOAT_OES ? 2 : bytesPerType.get(type);
    if (!n || !width) throw new Error('Unsupported GLES pixel format/type: 0x'+format.toString(16)+'/0x'+type.toString(16));
    const row = w*width*(packedTypes.has(type) ? 1 : n);
    const bytes = h ? (h-1)*Math.ceil(row/alignment)*alignment + row : 0;
    const Type = type === 0x1406 ? Float32Array : width === 4 ? Uint32Array : width === 2 ? Uint16Array : Uint8Array;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 256 * 1024 * 1024) throw new Error('Invalid GLES pixel data length');
    return pointer === undefined ? new Type(bytes / width) : sourceBuffer(pointer,bytes,Type);
  }
  function uploadPixels(p, sub) {
    const width = p[sub ? 4 : 3], height = p[sub ? 5 : 4], format = p[6];
    if (format === BGRA && ![UBYTE, 0x8367].includes(p[7])) { setError(0x500); return; }
    if (format === BGRA) {
      p[6] = RGBA;
      if (!sub && p[2] === BGRA) p[2] = RGBA;
      p[7] = UBYTE; // Apple 8_8_8_8_REV and unsigned byte have the same byte order on ARM.
    }
    if (p[7] === HALF_FLOAT_OES) {
      if (gl().blitFramebuffer) p[7] = HALF_FLOAT;
      else if (!gl().getExtension('OES_texture_half_float')) { setError(0x500); return; }
    }
    // WebGL 2 requires sized internal formats for RGBA16F and RGB16F uploads.
    if (!sub && p[7] === HALF_FLOAT && p[2] === RGBA) p[2] = 0x881a;
    if (!sub && p[7] === HALF_FLOAT && p[2] === 0x1907) p[2] = 0x881b;
    const data = p[8] ? pixels(width, height, p[6], p[7], unpackAlign, p[8]) : null;
    if (data && format === BGRA) {
      const stride = Math.ceil(width * 4 / unpackAlign) * unpackAlign;
      for (let y = 0; y < height; y++) for (let i = y * stride; i < y * stride + width * 4; i += 4) {
        const blue = data[i]; data[i] = data[i+2]; data[i+2] = blue;
      }
    }
    gl()[sub ? 'texSubImage2D' : 'texImage2D'](...p.slice(0,8), data);
  }
  bind('TexImage2D', a => uploadPixels(values(a,9), false));
  bind('TexSubImage2D', a => uploadPixels(values(a,9), true));
  bind('ReadPixels',a => {
    const p=values(a,7);
    const data=pixels(p[2],p[3],p[4],p[5],packAlign);
    gl().readPixels(...p.slice(0,6),data);
    cpu.write(p[6],new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
  });
  const pvrtc = () => gl().getExtension('WEBGL_compressed_texture_pvrtc') || gl().getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc');
  function enableCompressed(format) {
    if (format>=0x8c00 && format<=0x8c03) {
      return !!pvrtc();
    }
    if (format>=0x83f0 && format<=0x83f3) {
      if (gl().getExtension('WEBGL_compressed_texture_s3tc')) return true;
    } else if (format===0x8d64 && gl().getExtension('WEBGL_compressed_texture_etc1')) return true;
    throw new Error('Unsupported GLES compressed texture format 0x'+format.toString(16));
  }
  async function uploadCompressed(p, sub) {
    const format = sub ? p[6] : p[2];
    // A null pointer allocates an uninitialized complete compressed mip.
    const noData = !p.at(-1) && !sub;
    const data = noData ? new Uint8Array(p.at(-2)) : sourceBuffer(p.at(-1),p.at(-2));
    if (enableCompressed(format)) {
      gl()[sub ? 'compressedTexSubImage2D' : 'compressedTexImage2D'](...p.slice(0,-2),data);
      return;
    }
    const width = sub ? p[4] : p[3], height = sub ? p[5] : p[4];
    const rgba = noData ? null : await decodePVRTC(format,width,height,data);
    gl().pixelStorei(0x0cf5,1);
    try {
      if (sub) gl().texSubImage2D(p[0],p[1],p[2],p[3],width,height,0x1908,0x1401,rgba);
      else gl().texImage2D(p[0],p[1],0x1908,width,height,p[5],0x1908,0x1401,rgba);
    } finally { gl().pixelStorei(0x0cf5,unpackAlign); }
  }
  bind('CompressedTexImage2D',a => uploadCompressed(values(a,8),false));
  bind('CompressedTexSubImage2D',a => uploadCompressed(values(a,9),true));
  bind('CopyTexImage2D',a => gl().copyTexImage2D(...values(a,8)));
  bind('CopyTexSubImage2D',a => gl().copyTexSubImage2D(...values(a,8)));
  bind('FramebufferRenderbuffer',a => gl().framebufferRenderbuffer(a(0),a(1),a(2),obj(a(3))));
  bind('FramebufferTexture2D',a => gl().framebufferTexture2D(a(0),a(1),a(2),obj(a(3)),a(4)));
  bind('RenderbufferStorage',a => gl().renderbufferStorage(...values(a,4)));
  bind('RenderbufferStorageMultisampleAPPLE', a => {
    if (!gl().renderbufferStorageMultisample) { setError(0x0502); return; }
    gl().renderbufferStorageMultisample(...values(a,5));
  });
  bind('ResolveMultisampleFramebufferAPPLE', () => {
    const g = gl();
    if (!g.blitFramebuffer || !g.getParameter(g.READ_FRAMEBUFFER_BINDING)) { setError(0x0502); return; }
    const type = g.getFramebufferAttachmentParameter(g.READ_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
    if (type !== g.RENDERBUFFER) { setError(0x0502); return; }
    const rb = g.getFramebufferAttachmentParameter(g.READ_FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
    const previous = g.getParameter(g.RENDERBUFFER_BINDING);
    const scissor = g.isEnabled(g.SCISSOR_TEST);
    try {
      g.bindRenderbuffer(g.RENDERBUFFER, rb);
      const w = g.getRenderbufferParameter(g.RENDERBUFFER,g.RENDERBUFFER_WIDTH);
      const h = g.getRenderbufferParameter(g.RENDERBUFFER,g.RENDERBUFFER_HEIGHT);
      if (scissor) g.disable(g.SCISSOR_TEST);
      g.blitFramebuffer(0,0,w,h,0,0,w,h,g.COLOR_BUFFER_BIT,g.NEAREST);
    } finally {
      if (scissor) g.enable(g.SCISSOR_TEST);
      g.bindRenderbuffer(g.RENDERBUFFER,previous);
    }
  });
  bind('GetRenderbufferParameteriv',a => write32(cpu,a(2),gl().getRenderbufferParameter(a(0),a(1))));
  bind('GetFramebufferAttachmentParameteriv',a => {
    const result=gl().getFramebufferAttachmentParameter(a(0),a(1),a(2));
    write32(cpu,a(3),typeof result==='object' ? id(result) : result);
  });
  bind('GetBufferParameteriv',a => write32(cpu,a(2),gl().getBufferParameter(a(0),a(1))));
  bind('GetTexParameteriv',a => write32(cpu,a(2),gl().getTexParameter(a(0),a(1))));
  bind('GetTexParameterfv',a => writeNumber(a(2),gl().getTexParameter(a(0),a(1)),'float'));
  return api;
}
