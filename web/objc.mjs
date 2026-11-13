import {installPorts} from '../src/runtime/ios/foundation/ports.ts';
import {installScanners} from '../src/runtime/ios/foundation/scanner-host.ts';
import {initialOrientation} from './screen.mjs';
import {coreFoundation} from './corefoundation.mjs';
import {bundleStrings} from './localized-strings.mjs';
import {foundationRunLoop} from './runloop.mjs';
import {cfNetwork} from './cfnetwork.mjs';
import {geometry} from './geometry.mjs';
import {fileManager} from './foundation-files.mjs';
import {foundation} from './foundation.mjs';
import { touchUIKit } from './touch.mjs';
import {moviePlayers} from './movie.mjs';
import { eaglDrawable } from './drawable.mjs';
import { read32, readString, write32 } from './memory.mjs';

const encoder = new TextEncoder();
const decoders = { utf8: new TextDecoder(), utf16: new TextDecoder('utf-16le') };

export function objcImports(cpu, heap, ipa, graphics, callGuest, signal, service = async () => {},
  {onPresent = () => {}, onLifecycle = () => {}, diagnostic = () => {}, mediaHost, threads, sys, audio, hostGate, cxx} = {}) {
  const lastDispatch = new Map();
  const classes = new Map(), names = new Map(), selectors = new Map(), owned = new Map(), poolStacks = new Map();
  const read = address => read32(cpu, address);
  const write = (address, value) => write32(cpu, address, value);
  const zero = size => {
    const address = heap.zero(size);
    if (!address) throw Error('Objective-C guest heap exhausted');
    return address;
  };
  const emptyCache = zero(16);
  const initializing = new Set(), initialized = new Set(), loads = [];
  async function initialize(cls) {
    if (!cls || initialized.has(cls) || initializing.has(cls)) return;
    const info = classes.get(cls);
    if (!info?.supported) throw Error('Unimplemented Objective-C class ' + (info?.name ?? cls));
    initializing.add(cls);
    try {
      await initialize(read(cls + 4));
      const imp = lookup(read(cls), 'initialize');
      if (typeof imp === 'number') await callGuest(imp, [cls, selector('initialize')]);
      initialized.add(cls);
    } finally { initializing.delete(cls); }
  }
  function selector(name) {
    if (!selectors.has(name)) selectors.set(name, heap.string(name));
    return selectors.get(name);
  }
  function hostClass(name, parentName, size = 4, supported = true) {
    if (names.has(name)) return names.get(name);
    const parent = names.get(parentName);
    const address = zero(20), meta = zero(20), cName = heap.string(name);
    for (const [ptr, isMeta] of [[address, false], [meta, true]]) {
      const ro = zero(40);
      write(ptr + 16, ro); write(ro, Number(isMeta)); write(ro + 8, isMeta ? 20 : size); write(ro + 16, cName);
      classes.set(ptr, { name, pointer: ptr, isMeta, owner: address, size: isMeta ? 20 : size,
        supported, methods: new Map() });
    }
    names.set(name, address);
    write(address, meta); write(address + 4, parent ?? 0);
    write(meta, parent ? read(read(parent)) : meta);
    write(meta + 4, parent ? read(parent) : address);
    return address;
  }
  function method(cls, meta, name, fn) {
    const ptr = names.get(cls);
    classes.get(meta ? read(ptr) : ptr).methods.set(name, fn);
  }
  function lookup(start, name) {
    const seen = new Set();
    for (let ptr = start; ptr; ptr = read(ptr + 4)) {
      const info = classes.get(ptr);
      if (!info || seen.has(ptr)) throw Error('Invalid Objective-C class hierarchy at 0x' + ptr.toString(16));
      if (!info.supported) throw Error('Unimplemented Objective-C class ' + info.name + ' (' + name + ')');
      seen.add(ptr);
      if (info.methods.has(name)) return info.methods.get(name);
    }
    return null;
  }
  function subclass(start, cls) {
    const seen = new Set();
    for (let ptr = start; ptr && !seen.has(ptr); ptr = read(ptr + 4)) {
      if (ptr === cls) return true;
      seen.add(ptr);
    }
    return false;
  }
  async function dispatch(arg, mode = 'normal', stret = false) {
    const r = stret ? 1 : 0;
    let self = arg(r), start;
    if (mode !== 'normal') {
      const superInfo = self;
      self = read(superInfo);
      const current = read(superInfo + 4);
      start = mode === 'super2' ? read(current + 4) : current;
      cpu.setReg(r, self);
    }
    if (!self) {
      if (!stret) cpu.setReg(1, 0);
      return stret ? arg(0) : 0;
    }
    start ??= read(self);
    const name = readString(cpu, arg(r + 1));
    const first = classes.get(start);
    const id=threadId();
    let latest=lastDispatch.get(id);
    if(!latest){latest={};lastDispatch.set(id,latest);}
    latest.cls=first;latest.method=name;
    if (!first) throw Error('Unknown Objective-C receiver class at 0x' + start.toString(16));
    await initialize(first.owner);
    const implementation = lookup(start, name);
    if (typeof implementation === 'number') return { jump: implementation };
    if (!implementation) {
      const info = classes.get(start);
      throw Error('Unimplemented Objective-C method ' + (info?.isMeta ? '+' : '-') + '[' + info?.name + ' ' + name + ']');
    }
    if (stret !== Boolean(implementation.stret)) throw Error('Unsupported return ABI for ' + name);
    if (stret) { await implementation(self, index => arg(index + 3), arg(0)); return arg(0); }
    return implementation(self, index => arg(index + 2));
  }
  function alloc(cls) {
    const info = classes.get(cls);
    if (!info || info.isMeta || !info.supported || info.size < 4) throw Error('Unsupported class allocation');
    const self = zero(info.size);
    write(self, cls);
    owned.set(self, { count: 1, buffers: [] });
    return self;
  }
  function retain(self) { const obj = owned.get(self); if (obj) obj.count++; return self; }
  function destroy(self) {
    const obj = owned.get(self);
    if (!obj) return;
    for (const p of obj.buffers) heap.free(p);
    owned.delete(self); heap.free(self);
  }
  function release(self) {
    const obj = owned.get(self);
    if (!obj || --obj.count > 0) return;
    const dealloc = lookup(read(self), 'dealloc');
    if (typeof dealloc === 'number') {
      cpu.setReg(0, self); cpu.setReg(1, selector('dealloc')); return { jump: dealloc };
    }
    return dealloc(self);
  }
  async function releaseFromHost(self) {
    const obj = owned.get(self);
    if (obj?.count === 1) {
      const imp = lookup(read(self), 'dealloc');
      if (typeof imp === 'number') {
        obj.count = 0;
        await callGuest(imp, [self, selector('dealloc')]);
        return;
      }
    }
    await release(self);
  }
  const poolStack = () => {
    const id = threads?.funcs._pthread_self() ?? 1;
    if (!poolStacks.has(id)) poolStacks.set(id, []);
    return poolStacks.get(id);
  };
  function poolPush() { const token = zero(4); poolStack().push({ token, objects: [] }); return token; }
  async function poolPop(token) {
    const pools = poolStack();
    const index = pools.findIndex(p => p.token === token);
    if (index < 0) throw Error('Invalid Objective-C autorelease pool');
    while (pools.length > index) {
      const p = pools.pop();
      for (const self of p.objects.reverse()) await releaseFromHost(self);
      heap.free(p.token);
    }
  }
  function autorelease(self) { if (owned.has(self)) poolStack().at(-1)?.objects.push(self); return self; }

  hostClass('NSObject', null);
  hostClass('NSString', 'NSObject', 16); hostClass('NSConstantString', 'NSString', 16);
  hostClass('NSMutableString','NSString',16);
  hostClass('NSBundle', 'NSObject'); hostClass('NSAutoreleasePool', 'NSObject');
  hostClass('EAGLContext', 'NSObject'); hostClass('EAGLSharegroup', 'NSObject');
  hostClass('NSBlock','NSObject');
  const blockClasses=new Map(['Stack','Global','Malloc'].map(kind=>['__NSConcrete'+kind+'Block',hostClass('NS'+kind+'Block','NSBlock')]));
  async function allocateObject(cls) {
    const ptr = alloc(cls);
    const lineage=[];
    for(let cur=cls;cur;cur=read(cur+4))lineage.push(cur);
    for(const cur of lineage.reverse()){
      const imp=classes.get(cur).methods.get('.cxx_construct');
      if(typeof imp==='number' && !(await callGuest(imp,[ptr,selector('.cxx_construct')]))) {destroy(ptr);return 0;}
    }
    return ptr;
  }
  method('NSObject', true, 'alloc', allocateObject);
  method('NSObject', true, 'allocWithZone:', allocateObject);
  method('NSObject', true, 'new',async cls=>send(await send(cls,'alloc'),'init'));
  method('NSObject', true, 'class', self => self);
  method('NSObject', false, 'class', self => read(self));
  for (const meta of [false, true]) {
    method('NSObject', meta, 'self', self => self);
    method('NSObject', meta, 'superclass', self => read((meta ? self : read(self)) + 4));
    method('NSObject', meta, 'respondsToSelector:', (self, a) => Number(!!lookup(read(self), readString(cpu, a(0)))));
    method('NSObject', meta, 'isKindOfClass:', (self, a) => Number(subclass(read(self), a(0))));
    method('NSObject', meta, 'isMemberOfClass:', (self, a) => Number(read(self) === a(0)));
    method('NSObject', meta, 'isEqual:', (self, a) => Number(self === a(0)));
    method('NSObject', meta, 'retain', retain); method('NSObject', meta, 'release', release);
    method('NSObject', meta, 'autorelease', autorelease);
    method('NSObject', meta, 'retainCount', self => owned.get(self)?.count ?? 0xffffffff);
  }
  method('NSObject', false, 'init', self => self);
  method('NSObject', false, 'dealloc', self => {
    const linked=associations.get(self);associations.delete(self);
    const destructors=[];
    for(let cur=read(self);cur;cur=read(cur+4)){
      const imp=classes.get(cur).methods.get('.cxx_destruct'); if(typeof imp==='number')destructors.push(imp);
    }
    if(!linked?.size&&!destructors.length)return destroy(self);
    return (async()=>{for(const obj of linked?.values()??[])if(obj.policy)await releaseFromHost(obj.value);for(const imp of destructors)await callGuest(imp,[self,selector('.cxx_destruct')]);destroy(self);})();
  });
  method('NSObject', false, 'hash', self => self >>> 2);
  method('NSAutoreleasePool', false, 'init', self => { owned.get(self).token = poolPush(); return self; });
  const drain = async self => { const obj = owned.get(self); if (obj.token) await poolPop(obj.token); destroy(self); };
  method('NSAutoreleasePool', false, 'dealloc', drain); method('NSAutoreleasePool', false, 'drain', drain);

  function makeString(text, self = alloc(names.get('NSString'))) {
    const bytes = encoder.encode(text);
    const data = zero(bytes.length + 1);
    cpu.write(data, bytes);
    const obj = owned.get(self);
    if (!obj) throw Error('Cannot initialize a constant NSString');
    for (const old of obj.buffers) heap.free(old);
    obj.buffers = [data];
    write(self + 4, 0x7c8); write(self + 8, data); write(self + 12, bytes.length);
    return self;
  }
  function text(self) {
    if (!self || !subclass(read(self), names.get('NSString'))) throw Error('Expected NSString');
    const utf16 = Boolean(read(self + 4) & 16);
    const len = read(self + 12);
    if (len > 16 * 1024 * 1024) throw Error('Invalid NSString length');
    return (utf16 ? decoders.utf16 : decoders.utf8).decode(cpu.read(read(self + 8), utf16 ? len * 2 : len));
  }
  const string = s => autorelease(makeString(s));
  const utf8Cache = new Map();
  function makeUTF16(bytes, self = alloc(names.get('NSString'))) {
    const obj=owned.get(self);
    if(!obj)throw Error('Cannot modify constant NSString');
    const data=zero(bytes.length+2);cpu.write(data,bytes);
    for(const p of obj.buffers)heap.free(p);
    obj.buffers=[data];
    const cached=utf8Cache.get(self);if(cached){heap.free(cached);utf8Cache.delete(self);}
    write(self+4,0x7d0);write(self+8,data);write(self+12,bytes.length/2);return self;
  }

  const utf8 = self => {
    if (!(read(self + 4) & 16)) return read(self + 8);
    if (!utf8Cache.has(self)) utf8Cache.set(self, heap.string(text(self)));
    return utf8Cache.get(self);
  };
  method('NSString', true, 'stringWithUTF8String:', (cls, a) => a(0) ? autorelease(makeString(readString(cpu, a(0)),alloc(cls))) : 0);
  function decodeText(bytes,encoding){
    if(encoding===1 && bytes.some(n=>n>127))return null;
    const names={1:'utf-8',4:'utf-8',10:'utf-16le',0x90000100:'utf-16be',0x94000100:'utf-16le'};
    if(encoding===5)return Array.from(bytes,c=>String.fromCharCode(c)).join('');
    if(!names[encoding])return null;
    try{return new TextDecoder(names[encoding],{fatal:true}).decode(bytes);}catch{return null;}
  }
  method('NSString',false,'initWithData:encoding:',(s,a)=>{
    const data=a(0),v=data?decodeText(cpu.read(read(data+4),read(data+8)),a(1)):null;
    if(v===null){destroy(s);return 0;}return makeString(v,s);
  });
  method('NSString',false,'initWithBytes:length:encoding:',(s,a)=>{
    const v=decodeText(cpu.read(a(0),a(1)),a(2));if(v===null){destroy(s);return 0;}return makeString(v,s);
  });
  method('NSString',false,'initWithFormat:',(self,a)=>makeString(foundationObjects.formatted(a(0),i=>a(i+1)),self));
  method('NSString',false,'initWithFormat:arguments:',(self,a)=>{const args=a(1);return makeString(foundationObjects.formatted(a(0),i=>read(args+i*4)),self);});
  method('NSString',false,'initWithString:',(self,a)=>makeString(text(a(0)),self));
  method('NSString',true,'stringWithString:',(cls,a)=>autorelease(makeString(text(a(0)),alloc(cls))));
  method('NSMutableString',true,'stringWithCapacity:',cls=>autorelease(makeString('',alloc(cls))));
  method('NSMutableString',false,'initWithCapacity:',self=>makeString('',self));
  method('NSMutableString',false,'setString:',(s,a)=>{makeString(text(a(0)),s);});
  method('NSMutableString',false,'appendString:',(s,a)=>{makeString(text(s)+text(a(0)),s);});
  method('NSMutableString',false,'appendFormat:',(s,a)=>{makeString(text(s)+foundationObjects.formatted(a(0),i=>a(i+1)),s);});
  method('NSMutableString',false,'copy',s=>makeString(text(s)));
  method('NSString',false,'mutableCopy',s=>makeString(text(s),alloc(names.get('NSMutableString'))));
  method('NSString', false, 'initWithUTF8String:', (self, a) => a(0) ? makeString(readString(cpu, a(0)), self) : 0);
  method('NSString', false, 'length', self => text(self).length);
  method('NSString', false, 'UTF8String', utf8);
  method('NSString', false, 'fileSystemRepresentation', utf8);
  method('NSString', false, 'description', self => self);
  method('NSString', false, 'copy', retain); method('NSString', false, 'copyWithZone:', retain);
  method('NSString', false, 'isEqualToString:', (self, a) => Number(!!a(0) && text(self) === text(a(0))));
  method('NSString', false, 'isEqual:', (self, a) =>
    Number(!!a(0) && subclass(read(a(0)), names.get('NSString')) && text(self) === text(a(0))));
  method('NSString', false, 'stringByAppendingString:', (self, a) => string(text(self) + text(a(0))));
  method('NSString', false, 'stringByAppendingPathComponent:', (self, a) => {
    const base = text(self).replace(/\/+$/, ''), item = text(a(0)).replace(/^\/+/, '');
    return string(base + '/' + item);
  });
  method('NSString', false, 'hasPrefix:', (self, a) => Number(text(self).startsWith(text(a(0)))));
  method('NSString', false, 'hasSuffix:', (self, a) => Number(text(self).endsWith(text(a(0)))));
  hostClass('NSData', 'NSObject', 12);
  hostClass('NSMutableData','NSData',12);
  function createData(source, count, self) {
    if (!source && count) return 0;
    const value = self ?? alloc(names.get('NSData'));
    if (count) {
      const bytes = heap.alloc(count);
      if (!bytes) { destroy(value); return 0; }
      for (let at = 0; at < count; at += 65536)
        cpu.write(bytes + at, cpu.read(source + at, Math.min(65536, count - at)));
      owned.get(value).buffers.push(bytes);
      write(value + 4, bytes);
    }
    write(value + 8, count);
    return value;
  }
  method('NSData', false, 'initWithBytes:length:', (s,a)=>createData(a(0),a(1),s));
  method('NSData', false, 'initWithData:', (s,a)=>createData(read(a(0)+4),read(a(0)+8),s));
  method('NSData', false, 'length', self => read(self + 8));
  method('NSData', false, 'bytes', self => read(self + 4));
  method('NSData', true, 'dataWithBytes:length:', (_, a) => autorelease(createData(a(0), a(1))));
  function resizeData(s,length) {
    const state=owned.get(s);if(!state)throw Error('Invalid NSMutableData');
    const prior=read(s+4),previous=read(s+8);
    if(length===previous)return;
    const dst=length?zero(length):0;
    for(let off=0;off<Math.min(previous,length);off+=65536)
      cpu.write(dst+off,cpu.read(prior+off,Math.min(65536,length-off,previous-off)));
    if(prior){heap.free(prior);state.buffers=state.buffers.filter(p=>p!==prior);}
    if(dst)state.buffers.push(dst);write(s+4,dst);write(s+8,length);
  }
  method('NSMutableData',true,'dataWithLength:',(cls,a)=>{const s=alloc(cls);resizeData(s,a(0));return autorelease(s);});
  method('NSMutableData',true,'dataWithCapacity:',cls=>autorelease(alloc(cls)));
  method('NSMutableData',false,'mutableBytes',s=>read(s+4));
  method('NSMutableData',false,'setLength:',(s,a)=>resizeData(s,a(0)));
  method('NSMutableData',false,'appendData:',(s,a)=>{
    const v=a(0),size=read(v+8),old=read(s+8);resizeData(s,old+size);
    for(let i=0;i<size;i+=65536)cpu.write(read(s+4)+old+i,cpu.read(read(v+4)+i,Math.min(size-i,65536)));
  });
  method('NSData',false,'copy',retain);
  method('NSMutableData',false,'copy',s=>createData(read(s+4),read(s+8)));
  method('NSData',false,'mutableCopy',s=>{
    const p=alloc(names.get('NSMutableData')),n=read(s+8);resizeData(p,n);
    for(let i=0;i<n;i+=65536)cpu.write(read(p+4)+i,cpu.read(read(s+4)+i,Math.min(n-i,65536)));
    return p;
  });
  method('NSString',false,'dataUsingEncoding:allowLossyConversion:',(s,a)=>{
    if(a(0)!==4)return 0;const p=utf8(s),n=encoder.encode(text(s)).length;return autorelease(createData(p,n));
  });
  let bundle;
  const mainBundle=()=>bundle??=alloc(names.get('NSBundle'));
  method('NSBundle', true, 'mainBundle', mainBundle);
  method('NSBundle', true, 'bundleForClass:', (_,a)=>classes.has(a(0))?mainBundle():0);
  for (const name of ['bundlePath', 'resourcePath']) method('NSBundle', false, name, () => string('/' + ipa.bundlePath));
  method('NSBundle', false, 'bundleIdentifier', () => ipa.info.CFBundleIdentifier ? string(ipa.info.CFBundleIdentifier) : 0);
  method('NSBundle', false, 'executablePath', () => string('/' + ipa.executablePath));
  const localized = bundleStrings(ipa);
  method('NSBundle', false, 'localizedStringForKey:value:table:', async (_, a) => {
    const [key,fallback,table] = [a(0),a(1),a(2)];
    if (!key) return 0;
    const result = await localized(text(key), table && text(table) || 'Localizable');
    return result === undefined ? autorelease(retain(fallback && text(fallback) ? fallback : key)) : string(result);
  });
  method('NSBundle', false, 'pathForResource:ofType:', (_, a) => {
    if (!a(0)) return 0;
    const name = text(a(0)), ext = a(1) ? text(a(1)) : '';
    const path = ipa.bundlePath + '/' + name + (ext ? '.' + ext : '');
    return ipa.has(path) ? string('/' + path) : 0;
  });

  hostClass('CALayer', 'NSObject');
  hostClass('CAEAGLLayer', 'CALayer');
  const drawable = eaglDrawable(graphics);
  const currentContexts = new Map();
  const threadId = () => threads?.funcs._pthread_self() ?? 1;
  const currentContext = () => currentContexts.get(threadId()) ?? 0;
  async function clearContext(id) {
    const context = currentContexts.get(id);
    if (context) {
      currentContexts.delete(id);
      await releaseFromHost(context);
    }
  }
  threads?.onExit?.(id=>{lastDispatch.delete(id);return clearContext(id);});
  method('EAGLContext', false, 'renderbufferStorage:fromDrawable:', (self, a) => {
    if (currentContext() !== self || !a(1) || !subclass(read(a(1)), names.get('CAEAGLLayer'))) return 0;
    return drawable.allocate(a(0), a(1));
  });
  method('EAGLContext', false, 'presentRenderbuffer:', (self, a) => {
    let result = 0;
    try {
      if (currentContext() === self) result = drawable.present(a(0));
      return result;
    } finally { onPresent(result); }
  });
  const contexts = new Map();
  const initContext = (self, a) => {
    if (a(0) !== 2) throw Error('Only EAGLRenderingAPIOpenGLES2 is supported');
    graphics();
    contexts.set(self, retain(a(1)) || alloc(names.get('EAGLSharegroup')));
    return self;
  };
  method('EAGLContext', false, 'initWithAPI:', (self, a) => initContext(self, i => i === 0 ? a(0) : 0));
  method('EAGLContext', false, 'initWithAPI:sharegroup:', initContext);
  method('EAGLContext', false, 'sharegroup', self => contexts.get(self) ?? 0);
  method('EAGLContext', false, 'API', () => 2);
  method('EAGLContext', false, 'dealloc', async self => {
    await releaseFromHost(contexts.get(self));
    contexts.delete(self);
    destroy(self);
  });
  method('EAGLContext', true, 'setCurrentContext:', async (_, a) => {
    const context = a(0), id = threadId();
    if (context && !contexts.has(context)) return 0;
    if (currentContext() === context) return 1;
    retain(context);
    await clearContext(id);
    if (context) currentContexts.set(id, context);
    return 1;
  });
  method('EAGLContext', true, 'currentContext', currentContext);

  hostClass('UIResponder', 'NSObject');
  hostClass('UIApplication', 'UIResponder');
  hostClass('CADisplayLink', 'NSObject');
  hostClass('NSRunLoop', 'NSObject');
  let application = 0, delegate = 0, idleDisabled = false;
  const runLoops = new Map();
  const displays = new Map();
  // The emulated iOS 7 device has a 60 Hz screen. Modern browsers can
  // deliver RAF at 120 Hz or skip an update when a guest frame runs long.
  const refreshMs = 1000 / 60;
  const displayTime = new DataView(new ArrayBuffer(8));
  const timeBits = seconds => {
    displayTime.setFloat64(0, seconds, true);
    return displayTime.getBigUint64(0, true);
  };
  function nextRefresh() {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const raf = typeof requestAnimationFrame === 'function' && !globalThis.document?.hidden;
      const handle = raf ? requestAnimationFrame(finish) : setTimeout(() => finish(performance.now()), refreshMs);
      function finish(time) {
        signal?.removeEventListener('abort', cancel);
        resolve(time);
      }
      function cancel() {
        if (raf) cancelAnimationFrame(handle);
        else clearTimeout(handle);
        reject(signal.reason);
      }
      signal?.addEventListener('abort', cancel, {once:true});
    });
  }
  async function send(self, name, args = [], optional = false) {
    if (!self) return 0;
    const cls = read(self);
    await initialize(classes.get(cls).owner);
    const imp = lookup(cls, name);
    if (typeof imp === 'number') return callGuest(imp, [self, selector(name), ...args]);
    if (imp) return imp(self, i => args[i] ?? 0);
    if (optional) return 0;
    throw Error('Unimplemented Objective-C method [' + classes.get(cls).name + ' ' + name + ']');
  }
  function getRunLoop(thread = threads?.funcs._pthread_self() ?? 1) {
    if(!runLoops.has(thread))runLoops.set(thread,alloc(names.get('NSRunLoop')));
    return runLoops.get(thread);
  }
  method('NSRunLoop', true, 'mainRunLoop', () => getRunLoop(1));
  method('NSRunLoop', true, 'currentRunLoop', () => getRunLoop());
  method('CADisplayLink', true, 'displayLinkWithTarget:selector:', (_, a) => {
    const target = a(0), action = a(1);
    if (!target || !action) return 0;
    const self = alloc(names.get('CADisplayLink'));
    displays.set(self, { target: retain(target), action: readString(cpu, action), interval: 1, next: 0, timestamp: 0, paused: false, scheduled: false });
    return autorelease(self);
  });
  method('CADisplayLink', false, 'addToRunLoop:forMode:', (self, a) => {
    if (a(0) !== getRunLoop(1)) throw Error('Unsupported display link run loop');
    const d = displays.get(self);
    if (!d.scheduled) {
      retain(self);
      d.next = performance.now() + refreshMs * d.interval;
      d.scheduled = true;
    }
  });
  method('CADisplayLink', false, 'removeFromRunLoop:forMode:', (self, a) => {
    if (a(0) !== getRunLoop(1)) return;
    const d = displays.get(self);
    if (!d.scheduled) return;
    d.scheduled = false;
    release(self);
  });
  method('CADisplayLink', false, 'invalidate', self => {
    const d = displays.get(self);
    if (!d) return;
    displays.delete(self);
    release(d.target);
    if (d.scheduled) release(self);
  });
  method('CADisplayLink', false, 'setFrameInterval:', (self, a) => {
    const d = displays.get(self);
    d.interval = Math.max(1, a(0) | 0);
    d.next = performance.now() + refreshMs * d.interval;
  });
  method('CADisplayLink', false, 'timestamp', self => timeBits(displays.get(self).timestamp / 1000));
  method('CADisplayLink', false, 'duration', () => timeBits(refreshMs / 1000));
  method('CADisplayLink', false, 'frameInterval', self => displays.get(self).interval);
  method('CADisplayLink', false, 'setPaused:', (self, a) => { displays.get(self).paused = Boolean(a(0)); });
  method('CADisplayLink', false, 'isPaused', self => Number(displays.get(self).paused));
  method('UIApplication', true, 'sharedApplication', () => application);
  method('UIApplication', false, 'delegate', () => delegate);
  method('UIApplication', false, 'setDelegate:', (_, a) => { delegate = a(0); });
  method('UIApplication', false, 'isIdleTimerDisabled', () => Number(idleDisabled));
  method('UIApplication', false, 'setIdleTimerDisabled:', (_, a) => { idleDisabled = Boolean(a(0)); });
  let quartz;
  const input = touchUIKit({getOrientation:()=>statusOrientation,getCoreGraphics:()=>quartz,hostClass,method,names,alloc,destroy,autorelease,retain,releaseFromHost,send,lookup,
    selector,selectorName:p=>readString(cpu,p),read,write,graphics,signal,text,string,ipa,mediaHost,diagnostic});
  const isKind = (obj, name) => !!obj && subclass(read(obj), names.get(name));
  installScanners({hostClass,method,alloc,destroy,retain,release:releaseFromHost,autorelease,text,string,write});
  installPorts({hostClass,method,alloc,destroy,retain,release:releaseFromHost,autorelease,text,string,write,send,waitMethod:(cls,name,fn)=>method(cls,false,name,fn)});
  let dispatchService;
  const foundationObjects = foundation({cpu, heap, hostClass, method, names, alloc, destroy, autorelease, retain, release:releaseFromHost,
    read, write, string, text, utf8, send, lookup, selector, array:input.array, items:input.items, threads, sys, ipa, isKind,getDispatch:()=>dispatchService,callBlock:callGuest,dataFrom:createData});
  const cf=coreFoundation({cpu,heap,read,write,zero,names,alloc,hostClass,method,destroy,send,callGuest,hostGate,
    retain,release:releaseFromHost,text,makeString,makeUTF16,foundation:foundationObjects,items:input.items,getRunLoop,threads});
  fileManager({release:releaseFromHost,destroy,cpu,heap,sys,hostClass,method,names,alloc,string,text,utf8,write,read,array:input.array,autorelease,send,retain,property:foundationObjects.property,dataFrom:createData});
  const scheduler=foundationRunLoop({cpu,hostClass,method,names,alloc,autorelease,retain,release:releaseFromHost,send,threads,destroy,read,callGuest,withAnimation:input.withAnimation,getDispatch:()=>dispatchService});
  let statusBarHidden=!!ipa.info.UIStatusBarHidden, statusOrientation=initialOrientation(ipa.info), shakeToEdit=true, badge=0;
  for(const name of ['setStatusBarHidden:','setStatusBarHidden:animated:','setStatusBarHidden:withAnimation:'])
    method('UIApplication',false,name,(_,a)=>{statusBarHidden=!!a(0);});
  method('UIApplication',false,'isStatusBarHidden',()=>Number(statusBarHidden));
  method('UIApplication',false,'statusBarOrientation',()=>statusOrientation);
  method('UIApplication',false,'setStatusBarOrientation:animated:',(_,a)=>{statusOrientation=a(0);});
  method('UIApplication',false,'setApplicationSupportsShakeToEdit:',(_,a)=>{shakeToEdit=!!a(0);});
  method('UIApplication',false,'applicationSupportsShakeToEdit',()=>Number(shakeToEdit));
  method('UIApplication',false,'setApplicationIconBadgeNumber:',(_,a)=>{badge=a(0)|0;});
  method('UIApplication',false,'applicationIconBadgeNumber',()=>badge);
  const movies = moviePlayers({hostClass, method, names, alloc, destroy, retain, release: releaseFromHost,
    string, text, send, ipa, mediaHost, diagnostic});
  hostClass('AVAudioSession', 'NSObject');
  let avSession;
  method('AVAudioSession', true, 'sharedInstance', () => avSession ??= alloc(names.get('AVAudioSession')));
  method('AVAudioSession', false, 'setActive:error:', (_, a) => Number(audio?.setSessionActive(!!a(0)) === 0));
  async function applicationMain(a) {
    const cls = a(2) ? names.get(text(a(2))) : names.get('UIApplication');
    const delegateName = a(3) ? text(a(3)) : null;
    onLifecycle('UIKit application launch', {delegate: delegateName?.slice(0, 192)});
    if (!cls || !subclass(cls, names.get('UIApplication'))) throw Error('Unknown UIApplication principal class');
    if (application) throw Error('UIApplicationMain called twice');
    async function instantiate(ptr) { return send(await send(ptr, 'alloc'), 'init'); }
    application = await instantiate(cls);
    if (delegateName) {
      const delegateClass = names.get(delegateName);
      if (!delegateClass) throw Error('Unknown UIApplication delegate ' + delegateName);
      await send(application, 'setDelegate:', [await instantiate(delegateClass)]);
    }
    const responder = await send(application, 'delegate');
    if (responder) {
      onLifecycle('UIKit delegate launch callbacks');
      await send(responder, 'application:willFinishLaunchingWithOptions:', [application, 0], true);
      if (lookup(read(responder), 'application:didFinishLaunchingWithOptions:')) {
        await send(responder, 'application:didFinishLaunchingWithOptions:', [application, 0]);
      } else await send(responder, 'applicationDidFinishLaunching:', [application], true);
      await send(responder, 'applicationDidBecomeActive:', [application], true);
    }
    input.connect();
    onLifecycle('UIKit event loop', {keyWindow: input.hasWindow(), displayLinks: displays.size, scene:input.scene(p=>classes.get(read(p))?.name)});
    try {
      while (input.hasWindow() || dispatchService?.hasPendingMain?.() || scheduler.pending() || foundationObjects.pending() || [...displays.values()].some(d => d.scheduled)) {
        const time = await nextRefresh();
        const token = poolPush();
        try {
          await foundationObjects.pollMain();
          await scheduler.pump();
          await input.pump();
          for (const [ptr, d] of [...displays]) {
            if (!d.scheduled || d.paused || time + 0.5 < d.next) continue;
            const period = d.interval * refreshMs;
            d.next += (Math.floor((time + 0.5 - d.next) / period) + 1) * period;
            d.timestamp = time;
            await send(d.target, d.action, [ptr]);
          }
          await service(8, true);
        } finally { await poolPop(token); }
      }
    } finally { input.disconnect(); }
    throw Error('UIApplication launched without a supported event source (key window or CADisplayLink)');
  }

  function loadMethods(ptr, table) {
    if (!ptr) return;
    const stride = read(ptr) & 0xffff, count = read(ptr + 4);
    if (stride !== 12 || count > 65536) throw Error('Invalid Objective-C method list');
    for (let i = 0; i < count; i++) {
      const at = ptr + 8 + i * stride;
      const old = read(at), name = readString(cpu, old), canonical = selector(name);
      if (old !== canonical) write(at, canonical);
      table.set(name, read(at + 8));
    }
  }
  function register(ptr, isMeta, owner) {
    if (classes.has(ptr)) return;
    const data = (read(ptr + 16) & ~3) >>> 0;
    const name = readString(cpu, read(data + 16)), size = read(data + 8);
    if (size > 64 * 1024 * 1024) throw Error('Invalid Objective-C class size for ' + name);
    const info = { name, pointer: ptr, isMeta, owner, size: Math.max(size, 4), supported: true, methods: new Map() };
    classes.set(ptr, info); loadMethods(read(data + 20), info.methods);
    if (!isMeta) {
      names.set(name, ptr);
      register(read(ptr), true, ptr);
    }
  }
  function install(image) {
    const sections = image.segments.flatMap(segment => segment.sections);
    function each(sectionName, visit) {
      for (const section of sections.filter(s => s.name === sectionName)) {
        if (section.size % 4 !== 0) throw Error('Invalid Objective-C ' + sectionName);
        for (let at = section.address; at < section.address + section.size; at += 4) visit(read(at), at);
      }
    }
    each('__objc_selrefs', (p, at) => write(at, selector(readString(cpu, p))));
    each('__objc_classlist', p => register(p, false, p));
    const loaded = new Set();
    function queueClass(p) {
      if (!p || loaded.has(p)) return;
      loaded.add(p);
      queueClass(read(p + 4));
      const imp = classes.get(read(p))?.methods.get('load');
      if (typeof imp === 'number') loads.push({cls: p, imp});
    }
    each('__objc_nlclslist', p => queueClass(p));
    const nonLazyCategories = new Set();
    each('__objc_nlcatlist', c => nonLazyCategories.add(c));
    each('__objc_catlist', cat => {
      const cls = read(cat + 4);
      if (!classes.has(cls)) throw Error('Unknown class in Objective-C category');
      loadMethods(read(cat + 8), classes.get(cls).methods);
      const methods = new Map();
      loadMethods(read(cat + 12), methods);
      for (const [name, imp] of methods) classes.get(read(cls)).methods.set(name, imp);
      if (nonLazyCategories.has(cat) && methods.has('load')) loads.push({cls, imp: methods.get('load')});
    });
  }
  const exportedStringNames = new Map([
    ['_NSDefaultRunLoopMode', 'kCFRunLoopDefaultMode'], ['_kCFRunLoopDefaultMode', 'kCFRunLoopDefaultMode'],
    ['_NSRunLoopCommonModes', 'kCFRunLoopCommonModes'], ['_kCFRunLoopCommonModes', 'kCFRunLoopCommonModes'],
    ['_NSFilePathErrorKey', 'NSFilePath'], ['_NSUnderlyingErrorKey', 'NSUnderlyingError'],
    ['_NSLocalizedDescriptionKey', 'NSLocalizedDescription']
  ]);
  for (const name of ['UIApplicationDidBecomeActiveNotification', 'UIApplicationDidEnterBackgroundNotification',
    'UIApplicationDidReceiveMemoryWarningNotification', 'UIApplicationWillEnterForegroundNotification',
    'UIApplicationWillTerminateNotification', 'UIDeviceOrientationDidChangeNotification', 'UIKeyboardWillHideNotification',
    'UIKeyboardWillShowNotification', 'UIKeyboardFrameEndUserInfoKey', 'UIScreenDidConnectNotification',
    'UIScreenDidDisconnectNotification', 'NSPOSIXErrorDomain', 'NSCocoaErrorDomain', 'NSFilePosixPermissions'])
    exportedStringNames.set('_' + name, name);
  for (const [name, value] of [['kEAGLColorFormatRGBA8','RGBA8'],['kEAGLDrawablePropertyColorFormat','EAGLDrawablePropertyColorFormat'],
    ['kEAGLDrawablePropertyRetainedBacking','EAGLDrawablePropertyRetainedBacking'],['AVAudioSessionInterruptionTypeKey','AVAudioSessionInterruptionTypeKey'],
    ['AVAudioSessionRouteChangeReasonKey','AVAudioSessionRouteChangeReasonKey']]) exportedStringNames.set('_'+name,value);
  for(const name of ['GCControllerDidConnectNotification','GCControllerDidDisconnectNotification','GKPlayerAuthenticationDidChangeNotificationName'])
    exportedStringNames.set('_'+name,name);
  for(const name of ['NSFileModificationDate','NSFileSystemFreeSize','NSFileSystemSize','NSMetadataItemFSContentChangeDateKey',
    'NSMetadataItemFSNameKey','NSMetadataItemURLKey','NSMetadataQueryDidFinishGatheringNotification','NSMetadataQueryDidUpdateNotification',
    'NSMetadataQueryUbiquitousDocumentsScope','NSMetadataUbiquitousItemDownloadingStatusKey','NSMetadataUbiquitousItemHasUnresolvedConflictsKey',
    'NSMetadataUbiquitousItemIsDownloadingKey','NSMetadataUbiquitousItemIsUploadedKey','NSMetadataUbiquitousItemIsUploadingKey',
    'NSMetadataUbiquitousItemPercentDownloadedKey','NSMetadataUbiquitousItemPercentUploadedKey','NSURLIsExcludedFromBackupKey',
    'NSURLIsUbiquitousItemKey','NSURLUbiquitousItemDownloadingStatusCurrent','NSURLUbiquitousItemDownloadingStatusKey',
    'NSURLUbiquitousItemHasUnresolvedConflictsKey'])exportedStringNames.set('_'+name,name);
  for(const [name,value] of [['NSFontAttributeName','NSFont'],['NSForegroundColorAttributeName','NSColor'],['NSGregorianCalendar','gregorian']])
    exportedStringNames.set('_'+name,value);
  const cg = geometry(cpu,heap);
  for (const name of ['MPMoviePlayerPlaybackDidFinishNotification', 'MPMoviePlayerPlaybackDidFinishReasonUserInfoKey',
    'AVAudioSessionInterruptionTypeKey','AVAudioSessionRouteChangeReasonKey'])
    exportedStringNames.set('_' + name, name);
  const exportedStrings = new Map();
  const directories = new Map([[5, 'Library'], [9, 'Documents'], [13, 'Library/Caches'], [14, 'Library/Application Support']]);
  let defaultAllocator;
  function resolveData(name) {
    if (cxx && name.startsWith('_OBJC_EHTYPE_$_')) {
      const cls = name.slice(15);
      if (names.has(cls)) return cxx.objcType(cls, names.get(cls));
    }
    if(name.startsWith('_kCF')){const address=cf.resolveData(name);if(address!=null)return address;}
    if(blockClasses.has(name))return blockClasses.get(name);
    if(cg.constants.has(name))return cg.constants.get(name);
    if (name === '_kCFAllocatorDefault') return defaultAllocator ??= zero(4);
    const constant = exportedStringNames.get(name);
    if (constant) {
      if (!exportedStrings.has(constant)) {
        const instance = makeString(constant, alloc(names.get('NSConstantString')));
        // Exported NSString constants live for the lifetime of the guest.
        owned.delete(instance);
        const address = zero(4);
        write(address, instance);
        exportedStrings.set(constant, address);
      }
      return exportedStrings.get(constant);
    }
    if (name === '___CFConstantStringClassReference') return names.get('NSConstantString');
    if (name === '__objc_empty_cache' || name === '__objc_empty_vtable') return emptyCache;
    const m = /^_OBJC_(CLASS|METACLASS)_\$_(.+)$/.exec(name);
    if (!m) return null;
    const cls = names.get(m[2]) ?? hostClass(m[2], 'NSObject', 4, false);
    return m[1] === 'CLASS' ? cls : read(cls);
  }
  const associations=new Map(), monitors=new Map();
  const setProperty=copy=>async a=>{
    const base=a(0),slot=base+a(3),replacement=a(2);
    if(!copy && read(slot)===replacement)return;
    const value=copy?await send(replacement,'copy'):retain(replacement);
    const old=read(slot);write(slot,value);await releaseFromHost(old);
  };
  let uncaughtHandler=0;
  const funcs = {
    ...cg.funcs, ...cf.funcs, ...cfNetwork({cpu,read,write,hostClass,method,names,alloc,destroy,text,callGuest,heap,array:input.array,dataFrom:createData,release:releaseFromHost}),
    _objc_getProperty:a=>{const v=read(a(0)+a(2));return a(3)?autorelease(retain(v)):v;},
    _objc_setProperty_atomic:setProperty(false), _objc_setProperty_nonatomic:setProperty(false),
    _objc_setProperty_atomic_copy:setProperty(true), _objc_setProperty_nonatomic_copy:setProperty(true),
    _objc_setAssociatedObject:async a=>{
      const owner=a(0),key=a(1),object=a(2),policy=a(3)&255;
      if(!owner)return;
      let map=associations.get(owner);if(!map)associations.set(owner,map=new Map());
      const value=object?(policy===3?await send(object,'copy'):policy===1?retain(object):object):0;
      const old=map.get(key);if(value)map.set(key,{value,policy});else map.delete(key);
      if(old?.policy)await releaseFromHost(old.value);
    },
    _objc_getAssociatedObject:a=>associations.get(a(0))?.get(a(1))?.value??0,
    _objc_enumerationMutation:()=>{throw Error('Collection mutated during guest fast enumeration');},
    _objc_sync_enter:a=>{
      const obj=a(0),owner=threads?.funcs._pthread_self()??1;
      if(!obj)return 0;
      const take=()=>{const m=monitors.get(obj);if(m&&m.owner!==owner)return;
        if(m)m.depth++;else monitors.set(obj,{owner,depth:1});return 0;};
      return take()??{wait:take};
    },
    _objc_sync_exit:a=>{
      const obj=a(0),m=monitors.get(obj);if(!obj)return 0;
      if(!m||m.owner!==(threads?.funcs._pthread_self()??1))return -1;
      if(!--m.depth)monitors.delete(obj);return 0;
    },
    _NSSetUncaughtExceptionHandler: a=>{uncaughtHandler=a(0);},
    _NSGetUncaughtExceptionHandler: ()=>uncaughtHandler,
    _objc_exception_throw: async a=>{
      const exception = a(0);
      if (cxx) return cxx.throwObjC(exception, async () => {
        if (uncaughtHandler) await callGuest(uncaughtHandler,[exception]);
      });
      if(uncaughtHandler)await callGuest(uncaughtHandler,[exception]);
      throw Error('Uncaught guest Objective-C exception at 0x'+exception.toString(16));
    },
    _NSLog: a => { const message=foundationObjects.formatted(a(0), i=>a(i+1)); diagnostic('debug','guest-output',message.slice(0,512)); },
    _CFRetain: a => retain(a(0)), _CFRelease: a => release(a(0)),
    _CFDataCreate: a => {
      if (a(0)) throw Error('CFDataCreate with a custom allocator is unsupported');
      return createData(a(1), a(2));
    },
    _CFDataGetLength: a => read(a(0) + 8), _CFDataGetBytePtr: a => read(a(0) + 4),
    _NSSearchPathForDirectoriesInDomains: a => {
      const directory = directories.get(a(0));
      const paths = a(1) & 1 && directory ? [string((a(2) ? '/' : '~/') + directory)] : [];
      return autorelease(input.array(paths));
    },
    _NSHomeDirectory: () => string('/'), _NSTemporaryDirectory: () => string('/tmp/'),
    _UIApplicationMain: applicationMain,
    _objc_msgSend: a => dispatch(a),
    _objc_msgSendSuper2: a => dispatch(a, 'super2'),
    _objc_msgSendSuper: a => dispatch(a, 'super'),
    _objc_msgSend_stret: a => dispatch(a, 'normal', true),
    _objc_msgSendSuper2_stret: a => dispatch(a, 'super2', true),
    _sel_registerName: a => selector(readString(cpu, a(0))),
    _sel_getUid: a => selector(readString(cpu, a(0))),
    _sel_getName: a => a(0),
    _sel_isEqual: a => Number(a(0) === a(1)),
    _objc_getClass: a => names.get(readString(cpu, a(0))) ?? 0,
    _objc_lookUpClass: a => names.get(readString(cpu, a(0))) ?? 0,
    _object_getClass: a => a(0) ? read(a(0)) : 0,
    _class_getSuperclass: a => a(0) ? read(a(0) + 4) : 0,
    _objc_retain: a => retain(a(0)), _objc_release: a => release(a(0)),
    _objc_autorelease: a => autorelease(a(0)),
    _objc_retainAutoreleasedReturnValue: a => retain(a(0)),
    _objc_autoreleaseReturnValue: a => autorelease(a(0)),
    _objc_autoreleasePoolPush: poolPush, _objc_autoreleasePoolPop: a => poolPop(a(0)),
    _NSClassFromString: a => { const cls=a(0)&&names.get(text(a(0))); return classes.get(cls)?.supported?cls:0; },
    _NSStringFromClass: a => a(0) ? string(classes.get(a(0)).name) : 0,
    _NSSelectorFromString: a => a(0) ? selector(text(a(0))) : 0,
    _NSStringFromSelector: a => a(0) ? string(readString(cpu, a(0))) : 0,
  };
  return { funcs, resolveData, install, isKindOf:isKind, attachCoreGraphics:cg=>{quartz=cg;}, currentThreadId:()=>threads?.funcs._pthread_self() ?? 0, setDispatch:d=>{dispatchService=d;}, blockClasses, retainObject:retain, releaseObject:releaseFromHost, pumpMovies: movies.pump,
    audioReasonDictionary(key,value){return autorelease(foundationObjects.dictionary(names.get('NSDictionary'),[[string(key),foundationObjects.number(value)]]));},
    async audioSessionNotification(notification,key,value){
      const info=this.audioReasonDictionary(key,value);
      const center=await send(names.get('NSNotificationCenter'),'defaultCenter');
      await send(center,'postNotificationName:object:userInfo:',[string(notification),avSession??=alloc(names.get('AVAudioSession')),info]);
    },
    async fileURLPath(url) { return await send(url, 'isFileURL') ? text(await send(url, 'path')) : null; },
    close() { movies.close(); input.close(); }, get lastSelector() {
    const latest=lastDispatch.get(threadId());if(!latest)return;
    const {cls:lastClass,method:lastMethod}=latest;
    return (lastClass?.isMeta ? '+' : '-') + '[' + (lastClass?.name || '?').slice(0, 96) + ' ' + lastMethod.slice(0, 128) + ']';
  }, async start() {
    for (const {cls, imp} of loads) await callGuest(imp, [cls, selector('load')]);
  } };
}
