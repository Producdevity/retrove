import {Colors} from "../src/runtime/graphics/core-graphics/colors/model.ts";
import {colorImports} from "../src/runtime/graphics/core-graphics/colors/bindings.ts";
import {colorSpaceImports} from "../src/runtime/graphics/core-graphics/color-space.ts";
import {pathImports} from "../src/runtime/graphics/core-graphics/path-imports.ts";
import {drawingStateImports} from "../src/runtime/graphics/core-graphics/drawing-state.ts";
import {bitmapImports,bitmapImageMetadata} from "../src/runtime/graphics/core-graphics/bitmap-imports.ts";
import {imageMetadataImports,rgbaImageMetadata,ImageComponents} from "../src/runtime/graphics/core-graphics/image-metadata.ts";
// Quartz objects live independently of Objective-C objects and retain their backing storage.
export function coreGraphics(cpu, heap, objc) {
  const objects = new Map(), stacks = new Map(), scratch = new DataView(new ArrayBuffer(4));
  const thread = () => objc.currentThreadId?.() ?? 0;
  const number = word => { scratch.setUint32(0, word, true); return scratch.getFloat32(0, true); };
  const numbers = (a, first, count) => Array.from({ length: count }, (_, i) => number(a(first + i)));
  function create(kind, fields) {
    const p = heap.zero(4);
    if (p) objects.set(p, { kind, refs: 1, ...fields });
    return p;
  }
  function retain(p) {
    if(colors.has(p))return colors.retain(p);
    const object = objects.get(p);
    if (object) object.refs++;
    return object ? p : 0;
  }
  async function release(p) {
    if(colors.has(p))return colors.release(p);
    const object = objects.get(p);
    if (!object || --object.refs) return;
    objects.delete(p);
    heap.free(p);
    if (object.kind === 'context' && object.bitmap) {object.bitmap.close();await release(object.bitmap.space);}
    if (object.kind === 'provider') await objc.releaseObject(object.data);
    if (object.kind === 'image') {
      await release(object.provider);
      await release(object.space);
    }
  }
  function pixels(p) {
    const image = objects.get(p);
    if (image?.kind !== 'image') return null;
    if (!image.rgba) {
      const provider = objects.get(image.provider);
      const pointer = objc.funcs._CFDataGetBytePtr(() => provider.data);
      const {width, height, bytes, stride, alpha, little, decode, components} = image;
      const input = cpu.read(pointer, stride * (height - 1) + width * bytes);
      const rgba = new Uint8ClampedArray(width * height * 4);
      const first = [2, 4, 6].includes(alpha), hasAlpha = [1, 2, 3, 4].includes(alpha);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = y * stride + x * bytes, out = (y * width + x) * 4;
          const channel = i => input[offset + (little ? bytes - 1 - i : i)];
          const a = hasAlpha ? channel(first ? 0 : bytes - 1) : 255;
          for (let i = 0; i < 3; i++) {
            const sample = components === 1 ? 0 : i;
            let v = channel(sample + Number(first));
            if (alpha === 1 || alpha === 2) v = a ? Math.min(255, v * 255 / a) : 0;
            if (decode) v = decode[2*sample] * 255 + v * (decode[2*sample+1] - decode[2*sample]);
            rgba[out + i] = v;
          }
          rgba[out + 3] = a;
        }
      }
      image.rgba = rgba;
    }
    return image;
  }
  function createImage(width, height, rgba) {
    if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) return 0;
    const copy=new Uint8ClampedArray(rgba),space=create('space',{components:ImageComponents.RGB});
    if(!space)return 0;
    const pointer=create('image',{...rgbaImageMetadata(width,height,space),rgba:copy});
    if(!pointer){objects.delete(space);heap.free(space);}
    return pointer;
  }
  function imageFromProvider(a) {
    const [width,height,bpc,bpp,stride,space,info,provider,decodePtr,interpolate] = Array.from({length:10}, (_, i) => a(i));
    const components = objects.get(space)?.components, source = objects.get(provider);
    const bytes = bpp / 8, alpha = info & 31, order = (info >>> 12) & 7;
    if (!width || !height || !components || source?.kind !== 'provider' || bpc !== 8 || (info & 256) ||
        alpha > 6 || bytes !== components + Number(alpha !== 0) || stride < width * bytes ||
        height * width > 0x4000000 || order > 4 ||
        (order && (bytes !== (order === 1 || order === 3 ? 2 : 4)))) return 0;
    if (stride * (height - 1) + width * bytes > objc.funcs._CFDataGetLength(() => source.data)) return 0;
    let decode;
    if (decodePtr) {
      const buffer = cpu.read(decodePtr, components * 8);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      decode = Array.from({length: 2 * components}, (_,i) => view.getFloat32(i * 4, true));
    }
    const p = create('image', {width,height,bytes,stride,space,components,provider,alpha,decode,little:order===1||order===2,interpolate:!!interpolate,bitsPerComponent:bpc,bitmapInfo:info});
    if (p) { retain(provider); retain(space); }
    return p;
  }
  function current() { return stacks.get(thread())?.at(-1) ?? 0; }
  async function withContext(canvas, callback) {
    const id = thread(), stack = stacks.get(id) ?? [];
    const p = create('context', {canvas, saves:0, antialias:true, bounds:null});
    if (!p) throw Error('Unable to allocate a Quartz drawing context');
    stacks.set(id, stack); stack.push(p); canvas.save();
    try { return await callback(); }
    finally {
      for (let i=objects.get(p).saves; i>=0; i--) canvas.restore();
      stack.pop();
      if (!stack.length) stacks.delete(id);
      await release(p);
    }
  }
  function context(p) {
    const object = objects.get(p);
    return object?.kind === 'context' ? object.canvas : null;
  }
  function setColor(channels, fill, stroke) {
    const c = context(current());
    if (!c) return;
    const color = 'rgba(' + channels.slice(0,3).map(v => Math.round(v*255)).join(',') + ',' + channels[3] + ')';
    if (fill) c.fillStyle = color;
    if (stroke) c.strokeStyle = color;
  }
  // Canvas antialiases vector edges unconditionally. For Quartz contexts that
  // disable it, sample the actual Cairo/WebKit path once at each pixel center.
  function deviceBounds(c,x,y,w,h) {
    const m=c.getTransform(), x1=m.a*x+m.c*y+m.e, y1=m.b*x+m.d*y+m.f;
    const u=m.a*w,v=m.c*h,r=m.b*w,s=m.d*h;
    return [x1+Math.min(0,u)+Math.min(0,v), y1+Math.min(0,r)+Math.min(0,s),
      x1+Math.max(0,u)+Math.max(0,v), y1+Math.max(0,r)+Math.max(0,s)];
  }
  function addBounds(o,rect) {
    if(!o.bounds){o.bounds=rect;return;}
    o.bounds=[Math.min(o.bounds[0],rect[0]),Math.min(o.bounds[1],rect[1]),
      Math.max(o.bounds[2],rect[2]),Math.max(o.bounds[3],rect[3])];
  }
  function rasterize(c,bounds,contains,stroke) {
    if(!bounds)return;
    const m=c.getTransform(), margin=stroke?c.lineWidth*Math.max(1,c.miterLimit)*Math.max(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)):0;
    const left=Math.max(0,Math.floor(bounds[0]-margin)), right=Math.min(c.canvas.width,Math.ceil(bounds[2]+margin));
    const top=Math.max(0,Math.floor(bounds[1]-margin)),bottom=Math.min(c.canvas.height,Math.ceil(bounds[3]+margin));
    const spans=[];
    for(let y=top;y<bottom;y++) {
      let start=-1;
      for(let x=left;x<=right;x++) {
        const inside=x<right&&contains(x+0.5,y+0.5);
        if(inside&&start<0)start=x;
        else if(!inside&&start>=0){spans.push([start,y,x-start]);start=-1;}
      }
    }
    c.save();c.setTransform(1,0,0,1,0,0);
    try {
      if(stroke)c.fillStyle=c.strokeStyle;
      for(const [x,y,w] of spans)c.fillRect(x,y,w,1);
    } finally {c.restore();}
  }
  const colors=new Colors({allocate:n=>heap.zero(n),free:p=>heap.free(p),read:(p,n)=>cpu.read(p,n),write:(p,b)=>cpu.write(p,b),spaceComponents:p=>objects.get(p)?.kind==='space'?objects.get(p).components:undefined,createSpace:components=>create('space',{components}),retainSpace:retain,releaseSpace:release});
  const funcs = {
    ...colorImports({colors,text:p=>objc.stringText(p)}),
    ...drawingStateImports({context,rgba:p=>colors.rgba(p)}),
    ...colorSpaceImports({components:p=>objects.get(p)?.kind==='space'?objects.get(p).components:undefined}),
    ...pathImports({context,reset:p=>{const object=objects.get(p);if(object?.kind==='context')object.bounds=null;},bounds:(p,x,y,w,h)=>{const object=objects.get(p);if(object?.kind==='context')addBounds(object,deviceBounds(object.canvas,x,y,w,h));},draw:(p,mode)=>funcs._CGContextDrawPath(i=>[p,mode][i]??0)}),
    ...bitmapImports({
      read:(p,n)=>cpu.read(p,n),write:(p,b)=>cpu.write(p,b),allocate:n=>heap.zero(n),free:p=>heap.free(p),
      components:p=>objects.get(p)?.kind==='space'?objects.get(p).components:undefined,
      create:bitmap=>{const p=create('context',{canvas:bitmap.canvas,bitmap,saves:0,antialias:true,bounds:null});if(p)retain(bitmap.space);return p;},
      context:p=>objects.get(p)?.kind==='context'?objects.get(p):undefined,
      image:p=>pixels(p)??undefined,
      snapshot:bitmap=>{const p=create('image',{...bitmapImageMetadata(bitmap),rgba:new Uint8ClampedArray(bitmap.rgba())});if(p)retain(bitmap.space);return p;},
    }),
    _CGContextRetain:a=>retain(a(0)),
    _CGContextRelease:a=>release(a(0)),
    ...imageMetadataImports({image:pointer=>{const object=objects.get(pointer);return object?.kind==='image'?object:undefined;}}),
    _CGColorSpaceCreateDeviceRGB: () => create('space', {components:3}),
    _CGColorSpaceCreateDeviceGray: () => create('space', {components:1}),
    _CGColorSpaceRelease: a => release(a(0)),
    _CGColorSpaceRetain: a => retain(a(0)),
    _CGDataProviderCreateWithCFData: a => {
      const data = a(0);
      if (!data) return 0;
      const p = create('provider', {data});
      if (p) objc.retainObject(data);
      return p;
    },
    _CGDataProviderRelease: a => release(a(0)),
    _CGImageCreate: imageFromProvider,
    _CGImageRetain: a => retain(a(0)),
    _CGImageRelease: a => release(a(0)),
    _UIGraphicsGetCurrentContext: current,
    _CGContextSaveGState: a => {
      const o=objects.get(a(0));
      if(o?.kind==='context'){o.canvas.save();o.saves++;}
    },
    _CGContextRestoreGState: a => {
      const o=objects.get(a(0));
      if(o?.saves){o.canvas.restore();o.saves--;}
    },
    _CGContextScaleCTM: a => context(a(0))?.scale(...numbers(a,1,2)),
    _CGContextSetAllowsAntialiasing: a => {
      const o=objects.get(a(0));if(o?.kind==='context'){o.antialias=!!a(1);o.canvas.imageSmoothingEnabled=o.antialias;}
    },
    _CGContextMoveToPoint: a => {
      const o=objects.get(a(0));if(o?.kind!=='context')return;
      const [x,y]=numbers(a,1,2);o.canvas.moveTo(x,y);addBounds(o,deviceBounds(o.canvas,x,y,0,0));
    },
    _CGContextClosePath: a => context(a(0))?.closePath(),
    _CGContextAddArc: a => {
      const o=objects.get(a(0));if(o?.kind!=='context')return;
      const [x,y,r,from,to]=numbers(a,1,5);
      o.canvas.arc(x,y,r,from,to,!!a(6));addBounds(o,deviceBounds(o.canvas,x-r,y-r,2*r,2*r));
    },
    _CGContextFillRect: a => {
      const o=objects.get(a(0));if(o?.kind!=='context')return;
      o.bitmap?.refresh();
      const c=o.canvas, rect=numbers(a,1,4);
      if(o.antialias){c.fillRect(...rect);o.bitmap?.commit();return;}
      const path=new Path2D();path.rect(...rect);
      rasterize(c,deviceBounds(c,...rect),(x,y)=>c.isPointInPath(path,x,y),false);o.bitmap?.commit();
    },
    _CGContextDrawPath: a => {
      const o=objects.get(a(0)),mode=a(1);
      if(o?.kind!=='context')return;
      o.bitmap?.refresh();
      const c=o.canvas,rule=mode===1||mode===4?'evenodd':'nonzero';
      if ([0,1,3,4].includes(mode)) {
        if(o.antialias)c.fill(rule);
        else rasterize(c,o.bounds,(x,y)=>c.isPointInPath(x,y,rule),false);
      }
      if ([2,3,4].includes(mode)) {
        if(o.antialias)c.stroke();
        else rasterize(c,o.bounds,(x,y)=>c.isPointInStroke(x,y),true);
      }
      c.beginPath();o.bounds=null;o.bitmap?.commit();
    },
  };
  return { funcs, data:new Map(), colors, owns:p=>colors.has(p)||objects.has(p), retainCount:p=>colors.get(p)?.refs??objects.get(p)?.refs, equal:(a,b)=>colors.has(a)||colors.has(b)?colors.equal(a,b):objects.has(a)||objects.has(b)?a===b:undefined, hash:p=>colors.has(p)?colors.hash(p):objects.has(p)?p:undefined, createImage, pixels, retain, release, setColor, withContext, currentCanvas:()=>context(current()) };
}
