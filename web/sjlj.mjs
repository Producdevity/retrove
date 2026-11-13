import {read32, readString, write32} from './memory.mjs';

export class GuestLandingPad {
  constructor(pc, fp, sp, thread) {
    this.pc = pc; this.fp = fp; this.sp = sp; this.thread = thread;
  }
  restore(cpu) { cpu.setReg(7, this.fp); cpu.setReg(13, this.sp); return this.pc; }
}

// Clang's ARMv7 Darwin SjLj function context: previous, call-site number,
// four landing-pad arguments, personality, LSDA, saved r7, pc and sp.
export function sjljExceptions(cpu, heap, {threads, nested, hostGate, objc}) {
  const data = new Map(), exceptions = new Map(), caught = new Map(), typeNames = new Map();
  const read = p => read32(cpu, p), write = (p, x) => write32(cpu, p, x);
  const thread = threads.funcs._pthread_self;
  const gate = (name, fn) => hostGate({library:'libc++abi', name}, fn);
  const nop = gate('type_info destructor', () => 0);
  const deleting = gate('type_info deleting destructor', a => heap.free(a(0)));
  const canCatch = gate('type_info::can_catch', a => {
    const value = adjusted({type:a(1), object:read(a(2))}, a(0));
    if (value === undefined) return 0;
    write(a(2), value);
    return 1;
  });
  function table(symbol, methods) {
    const address = heap.zero(8 + 4 * methods.length);
    if (!address) throw Error('Unable to allocate C++ virtual table');
    methods.forEach((pc, i) => write(address + 8 + 4*i, pc));
    data.set(symbol, address);
    return address + 8;
  }
  const vtables = new Map(), metatypes = new Map();
  for (const name of ['class','si_class','fundamental','pbase','pointer']) {
    const cls = '__' + name + '_type_info', mangled = 'N10__cxxabiv1' + cls.length + cls + 'E';
    const methods = [nop, deleting, nop, nop, canCatch];
    if (name === 'class' || name === 'si_class') {
      for (const query of ['search_above_dst','search_below_dst','has_unambiguous_public_base']) {
        methods.push(gate(cls + '::' + query, () => { throw Error('Unsupported standalone C++ RTTI query ' + query); }));
      }
    }
    vtables.set(name, table('__ZTV' + mangled, methods));
    const info = heap.zero(12);
    write(info + 4, heap.string(mangled)); metatypes.set(name, info);
    write(vtables.get(name) - 4, info);
    data.set('__ZTI' + mangled, info);
  }
  for (const [name, info] of metatypes) {
    const base = {si_class:'class', pointer:'pbase'}[name];
    write(info, vtables.get(base ? 'si_class' : 'class'));
    if (base) write(info+8, metatypes.get(base));
  }
  const builtin = (name, kind, bytes = 8) => {
    const p = heap.zero(bytes);
    if (!p) throw Error('Unable to allocate C++ type information');
    write(p, vtables.get(kind)); write(p + 4, heap.string(name));
    typeNames.set(p, name); data.set('__ZTI' + name, p);
    return p;
  };
  const wchar = builtin('w', 'fundamental');
  for (const [name, flags] of [['Pw', 0], ['PKw', 1]]) {
    const ptr = builtin(name, 'pointer', 16);
    write(ptr + 8, flags); write(ptr + 12, wchar);
  }
  const objcTypes = new Map(), objcVptr = table('_objc_ehtype_vtable', [nop,nop,nop,nop,canCatch]);
  function objcType(name, cls = 0) {
    if (objcTypes.has(name)) return objcTypes.get(name);
    const p = heap.zero(12);
    write(p, objcVptr); write(p + 4, heap.string(name)); write(p + 8, cls);
    objcTypes.set(name, p); typeNames.set(p, name);
    return p;
  }
  const objcId = objcType('id');
  data.set('_OBJC_EHTYPE_id', objcId);
  write(objcVptr-4, objcId);

  const standard = new Map();
  for (const [name, base, message] of [['St9exception',null,'std::exception'],
       ['St9bad_alloc','St9exception','std::bad_alloc'], ['St11logic_error','St9exception',''],
       ['St12length_error','St11logic_error','vector'], ['St12out_of_range','St11logic_error','vector']]) {
    const type = builtin(name, base ? 'si_class' : 'class', base ? 12 : 8);
    if (base) write(type+8, data.get('__ZTI' + base));
    const text = heap.string(message);
    const what = gate(name + '::what', () => text);
    const vptr = table('__ZTV' + name, [nop, deleting, what]);
    write(vptr - 4, type);
    standard.set(name, {type, vptr, text});
  }

  function nameOf(type) {
    return typeNames.get(type) ?? readString(cpu, read(type + 4) & 0x7fffffff);
  }
  function adjusted(exception, type) {
    if (exception.objcObject !== undefined) {
      if (!type) return exception.objcObject;
      if (read(type) !== objcVptr) return undefined;
      const matches = type === objcId || objc().isKindOf(exception.objcObject, nameOf(type));
      return matches ? exception.objcObject : undefined;
    }
    if (type && read(type) === objcVptr) return undefined;
    const thrown = nameOf(exception.type);
    const pointer = thrown.startsWith('P');
    const value = pointer ? read(exception.object) : exception.object;
    if (!type) return value;
    const target = nameOf(type);
    if (exception.type === type || target === thrown) return value;
    if (pointer && (target === 'PK' + thrown.slice(1) || target === 'Pv' && !thrown.startsWith('PK') || target === 'PKv')) return value;
    // Single public, non-virtual inheritance is encoded with the base
    // type_info pointer at offset 8. Pointee qualifiers aren't class bases.
    if (!pointer) {
      for (let base = exception.type, count = 0; base && count < 256; count++) {
        if (read(base) !== vtables.get('si_class')) break;
        base = read(base + 8);
        if (base && (type === base || target === nameOf(base))) return value;
      }
    }
    return undefined;
  }

  function site(frame, exception) {
    const cursor = {ptr:read(frame + 28)};
    let index = read(frame + 4);
    if (!cursor.ptr || index === 0xffffffff) return;
    if (!index) throw Error('C++ exception crossed a non-throwing call');
    function byte() { return cpu.read(cursor.ptr++, 1)[0]; }
    function leb(signed = false) {
      let value = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        const b = byte(); value += (b & 127) * 2 ** shift;
        if (!(b & 128)) return signed && (b & 64) ? value - 2 ** (shift + 7) : value;
      }
      throw Error('Invalid integer in C++ exception table');
    }
    if (byte() !== 0xff) throw Error('Unsupported C++ landing-pad address encoding');
    const encoding = byte();
    let typeEnd = 0;
    if (encoding !== 0xff) {
      if (![0,3,0x1b,0x9b].includes(encoding)) throw Error('Unsupported C++ type table encoding ' + encoding);
      const length = leb(); typeEnd = cursor.ptr + length;
    }
    byte(); // The SjLj call-site table always uses ULEB pairs.
    const length = leb(), end = cursor.ptr + length;
    function catchType(i) {
      if (!typeEnd) throw Error('Missing C++ type table');
      const slot = typeEnd - 4 * i;
      let value = read(slot);
      if (value && (encoding & 0x10)) value = (slot + value) >>> 0;
      return value && (encoding & 0x80) ? read(value) : value;
    }
    while (cursor.ptr < end) {
      const pad = leb(), action = leb();
      if (cursor.ptr > end) throw Error('Truncated C++ call-site table');
      if (--index) continue;
      if (!action) return {pad, cleanup:true};
      cursor.ptr = end + action - 1;
      let cleanup = false;
      const visited = new Set();
      while (!visited.has(cursor.ptr)) {
        visited.add(cursor.ptr);
        const selector = leb(true), nextField = cursor.ptr, delta = leb(true);
        if (selector > 0) {
          const value = adjusted(exception, catchType(selector));
          if (value !== undefined) return {pad, selector, value, handler:true};
        } else if (selector < 0) {
          const resume = cursor.ptr;
          cursor.ptr = typeEnd - selector - 1;
          let allowed = false, entry;
          while ((entry = leb()) !== 0) if (adjusted(exception, catchType(entry)) !== undefined) allowed = true;
          cursor.ptr = resume;
          if (!allowed) return {pad, selector, value:exception.object, handler:true};
        } else cleanup = true;
        if (!delta) return {pad, cleanup};
        cursor.ptr = nextField + delta;
      }
      throw Error('Cyclic C++ exception action table');
    }
    throw Error('C++ call site outside its exception table');
  }

  function initialize(exception) {
    exception.pads = [];
    const seen = new Set();
    for (let frame = threads.unwindTop; frame; frame = read(frame)) {
      if (seen.has(frame)) throw Error('Cyclic C++ unwind frames');
      seen.add(frame);
      if (!read(frame + 24)) continue;
      const result = site(frame, exception);
      if (!result || (!result.cleanup && !result.handler)) continue;
      exception.pads.push({...result, frame});
      if (result.handler) return resume(exception);
    }
    if (exception.objcObject !== undefined) throw Error('Uncaught guest Objective-C exception at 0x' + exception.objcObject.toString(16));
    throw Error('Uncaught guest C++ exception of type ' + nameOf(exception.type));
  }
  function resume(exception) {
    const next = exception?.pads.shift();
    if (!next) throw Error('No handler for guest C++ exception');
    const {frame, pad, selector, value} = next;
    threads.unwindTop = frame;
    write(frame + 4, pad);
    write(frame + 8, exception.header);
    write(frame + 12, selector || 0);
    exception.adjusted = value;
    return new GuestLandingPad(read(frame + 36), read(frame + 32), read(frame + 40), thread());
  }
  function exceptionFor(header) {
    const e = exceptions.get(header);
    if (!e) throw Error('Unknown guest C++ exception');
    return e;
  }
  // Like libc++abi's emergency exception allocator, retain a small buffer so
  // operator new can still throw bad_alloc after the primary heap is full.
  const reserve = heap.zero(256);
  function freeException(header) {
    if (!exceptions.delete(header)) return;
    if (header !== reserve) heap.free(header);
  }
  const funcs = {
    ___cxa_allocate_exception: a => {
      const size = 32 + Math.max(1, a(0));
      let header = heap.zero(size);
      if (!header && size <= 256 && reserve && !exceptions.has(reserve)) {
        header = reserve; cpu.write(header, new Uint8Array(size));
      }
      if (!header) throw Error('Guest heap exhausted allocating C++ exception');
      const object = header + 32;
      exceptions.set(header, {object, header, handlers:0});
      return object;
    },
    ___cxa_free_exception: a => freeException(a(0) - 32),
    ___cxa_throw: a => {
      const e = exceptionFor(a(0) - 32);
      e.type = a(1); e.destroy = a(2);
      return initialize(e);
    },
    ___cxa_begin_catch: a => {
      const e = exceptionFor(a(0)), id = thread();
      const stack = caught.get(id) ?? [];
      if (!stack.length || stack.at(-1) !== e) stack.push(e);
      caught.set(id, stack);
      if (e.handlers < 0) e.handlers = -e.handlers;
      e.handlers++;
      return e.adjusted;
    },
    ___cxa_end_catch: async () => {
      const stack = caught.get(thread()), e = stack?.at(-1);
      if (!e) throw Error('Guest ended a C++ catch outside a handler');
      const rethrown = e.handlers < 0;
      e.handlers += rethrown ? 1 : -1;
      if (e.handlers) return;
      stack.pop();
      if (!stack.length) caught.delete(thread());
      if (!rethrown) {
        if (e.destroy) await nested(e.destroy, [e.object]);
        if (e.objcObject !== undefined) await objc().releaseObject(e.objcObject);
        freeException(e.header);
      }
    },
    ___cxa_rethrow: () => {
      const e = caught.get(thread())?.at(-1);
      if (!e) throw Error('Guest rethrew outside a C++ catch');
      e.handlers = -e.handlers;
      return initialize(e);
    },
    ___cxa_call_unexpected: () => { throw Error('Guest C++ exception violated a dynamic exception specification'); },
    __Unwind_SjLj_Resume: a => resume(exceptionFor(a(0))),
    ___gxx_personality_sj0: a => {
      if (a(0) !== 1) return 3;
      const flags = a(1), e = exceptionFor(a(4)), frame = a(5);
      const result = site(frame, e);
      if (!result) return 8;
      if (flags & 1) return result.handler ? 6 : 8;
      if (!(flags & 2) || !(result.cleanup || result.handler && (flags & 4))) return 8;
      write(frame + 4, result.pad); write(frame + 8, e.header); write(frame + 12, result.selector || 0);
      return 7;
    }
  };
  function raiseStandard(name) {
    const {type, vptr, text} = standard.get(name);
    const object = funcs.___cxa_allocate_exception(() => 8);
    write(object, vptr); write(object+4, text);
    return funcs.___cxa_throw(i => [object, type, 0][i]);
  }
  for (const [suffix, name] of [['length_error','St12length_error'], ['out_of_range','St12out_of_range']]) {
    funcs['__ZNKSt3__120__vector_base_commonILb1EE20__throw_' + suffix + 'Ev'] = () => raiseStandard(name);
  }
  funcs.___objc_personality_v0 = funcs.___gxx_personality_sj0;
  funcs._objc_begin_catch = funcs.___cxa_begin_catch;
  funcs._objc_end_catch = funcs.___cxa_end_catch;
  funcs._objc_exception_rethrow = funcs.___cxa_rethrow;
  async function throwObjC(object, uncaught) {
    const payload = funcs.___cxa_allocate_exception(() => 4);
    write(payload, object);
    const e = exceptionFor(payload - 32);
    e.objcObject = objc().retainObject(object); e.type = objcId;
    try { return initialize(e); }
    catch (error) { if (error.message.startsWith('Uncaught guest Objective-C exception')) await uncaught(); throw error; }
  }
  return {funcs, data, raiseStandard, objcType, throwObjC};
}
