import {read32, write32} from '../src/runtime/memory/guest-memory.ts';
import {GuestMutexes} from '../src/runtime/ios/threads/mutex.ts';
import {ThreadAttributes} from '../src/runtime/ios/threads/attributes.ts';

const PAGE = 4096, MAIN = 1;
const asWait = poll => {
  const value = poll();
  return value === undefined ? {wait: poll} : value;
};

export function threadImports(cpu, heap, returnAddress) {
  const attrs = new ThreadAttributes(), mutexAttrs = new Map(), conditions = new Map();
  const mutexes = new GuestMutexes({read:p=>read32(cpu,p),write:(p,value)=>write32(cpu,p,value)});
  const tlsKeys = new Map(), semaphores = new Map(), workers = new Map();
  function threadPointer(id) {
    // The first visible word contains pthread_self. A private word directly
    // before it holds the SJLJ context chain, outside the guest TLS slots.
    const base = heap.zero(16);
    if (!base) return 0;
    write32(cpu, base + 8, id);
    return base + 8;
  }
  const main = {id: MAIN, tls: new Map(), stackBottom: 0x6fc00000, pointer: threadPointer(MAIN)};
  if (!main.pointer) throw Error('Guest heap exhausted initializing the main thread');
  cpu.threadPointer = main.pointer;
  // Stackless ARM leaves are callable from ARM or Thumb without crossing into
  // JavaScript. Register and unregister are used by each C++ cleanup scope.
  const code = heap.alloc(PAGE, PAGE);
  if (!code) throw Error('Guest heap exhausted installing thread functions');
  const instructions = [
    0xee1d1f70, // mrc p15, 0, r1, c13, c0, 3  (TPIDRURO)
    0xe5112004, // ldr r2, [r1, #-4]
    0xe5802000, // str r2, [r0]
    0xe5010004, // str r0, [r1, #-4]
    0xe12fff1e, // bx lr
    0xee1d1f70, // mrc p15, 0, r1, c13, c0, 3
    0xe5902000, // ldr r2, [r0]
    0xe5012004, // str r2, [r1, #-4]
    0xe12fff1e, // bx lr
    0xee1d0f70, // mrc p15, 0, r0, c13, c0, 3
    0xe5900000, // ldr r0, [r0]
    0xe12fff1e, // bx lr
  ];
  const view = new DataView(new ArrayBuffer(instructions.length * 4));
  instructions.forEach((op, i) => view.setUint32(i * 4, op, true));
  cpu.write(code, new Uint8Array(view.buffer));
  cpu.protect(code, PAGE, 5);
  const nativeFunctions = new Map([['__Unwind_SjLj_Register', code],
    ['__Unwind_SjLj_Unregister', code + 20], ['_pthread_self', code + 36]]);
  const exitHandlers = [];
  let current = main, nextId = 2, nextKey = 1, nextSemaphore = 1;
  function release(t) {
    if (t.state) cpu.freeState(t.state);
    if (t.stack) heap.free(t.stack);
    if (t.pointer) heap.free(t.pointer - 8);
    t.pointer = 0;
    t.state = null; t.stack = 0;
  }
  function reap(t) { release(t); workers.delete(t.id); }
  function create(a) {
    const [out, attr, pc, arg] = [a(0), a(1), a(2), a(3)];
    if (!out || !pc || (attr && !attrs.has(attr))) return 22;
    const id = spawn(pc, [arg], attrs.get(attr) || {});
    if (!id) return 35;
    write32(cpu, out, id);
    return 0;
  }
  function spawn(pc, args, opts, onExit) {
    if (!pc || args.length > 4) return 0;
    const size = opts.size || (512 << 10);
    const stack = heap.zero(size);
    if (!stack) return 0;
    const id = nextId++, pointer = threadPointer(id);
    if (!pointer) { heap.free(stack); return 0; }
    const t = {id, pc, pointer, args: [...args], stack, stackBottom: stack, sp: stack + size - 16,
      tls: new Map(), running: false, done: false, detached: !!opts.detached, onExit};
    workers.set(id, t);
    return id;
  }
  function cond(p) {
    if (!conditions.has(p)) conditions.set(p, []);
    return conditions.get(p);
  }
  function waitCond(a, timed) {
    const q = cond(a(0)), pointer = a(1), id = current.id;
    if (!mutexes.ownsOnce(pointer,id)) return 22;
    let deadline = Infinity;
    if (timed) {
      const t = a(2), ns = read32(cpu, t + 4);
      if (ns >= 1e9) return 22;
      deadline = (read32(cpu,t) | 0) * 1000 + ns / 1e6;
    }
    const waiter = {signaled: false};
    q.push(waiter); mutexes.unlock(pointer,id);
    return asWait(() => {
      if (!waiter.signaled && Date.now() < deadline) return;
      if (mutexes.take(pointer,id) === undefined) return;
      q.splice(q.indexOf(waiter), 1);
      return waiter.signaled ? 0 : 60;
    });
  }

  const funcs = {
    _pthread_attr_init: a => attrs.initialize(a(0)),
    _pthread_attr_destroy: a => attrs.destroy(a(0)),
    _pthread_attr_setstacksize: a => attrs.stackSize(a(0),a(1)),
    _pthread_attr_setdetachstate: a => attrs.detach(a(0),a(1)),
    _pthread_attr_setschedpolicy: a => attrs.policy(a(0),a(1)),
    _pthread_attr_setschedparam: a => a(1) ? attrs.priority(a(0),read32(cpu,a(1)) | 0) : 22,
    _pthread_create: create,
    _pthread_self: () => current.id,
    _pthread_main_np: () => Number(current.id === MAIN),
    _pthread_equal: a => Number(a(0) === a(1)),
    _pthread_mach_thread_np: a => a(0) === MAIN || workers.has(a(0)) ? a(0) : 0,
    _pthread_threadid_np: a => {
      const id = a(0) || current.id;
      if (!a(1)) return 22;
      if (id !== MAIN && !workers.has(id)) return 3;
      write32(cpu,a(1),id); write32(cpu,a(1)+4,0);
      return 0;
    },
    _pthread_setname_np: () => 0,
    _pthread_exit: a => ({threadExit:a(0)}),
    _pthread_detach: a => {
      const t = workers.get(a(0));
      if (!t) return 3;
      if (t.detached || t.joining) return 22;
      t.detached = true;
      if (t.done) reap(t);
      return 0;
    },
    _pthread_join: a => {
      const t = workers.get(a(0)), ptr = a(1);
      if (a(0) === current.id) return 11;
      if (!t) return 3;
      if (t.detached || t.joining) return 22;
      t.joining = true;
      return asWait(() => {
        if (!t.done) return;
        if (ptr) write32(cpu,ptr,t.value);
        reap(t); return 0;
      });
    },
    _pthread_key_create: a => { const key = nextKey++; tlsKeys.set(key,a(1)); write32(cpu,a(0),key); return 0; },
    _pthread_key_delete: a => {
      if (!tlsKeys.delete(a(0))) return 22;
      for (const t of [main,...workers.values()]) t.tls.delete(a(0));
      return 0;
    },
    _pthread_setspecific: a => {
      if (!tlsKeys.has(a(0))) return 22;
      current.tls.set(a(0),a(1)); return 0;
    },
    _pthread_getspecific: a => current.tls.get(a(0)) || 0,
    _pthread_mutexattr_init: a => { mutexAttrs.set(a(0),0); return 0; },
    _pthread_mutexattr_settype: a => {
      if (!mutexAttrs.has(a(0)) || a(1)>2) return 22;
      mutexAttrs.set(a(0),a(1)); return 0;
    },
    _pthread_mutexattr_destroy: a => mutexAttrs.delete(a(0)) ? 0 : 22,
    _pthread_mutex_init: a => {
      const type = a(1) ? mutexAttrs.get(a(1)) : 0;
      if (type === undefined) return 22;
      return mutexes.initialize(a(0),type);
    },
    _pthread_mutex_destroy: a => mutexes.destroy(a(0)),
    _pthread_mutex_lock: a => mutexes.lock(a(0),current.id,false),
    _pthread_mutex_trylock: a => mutexes.lock(a(0),current.id,true),
    _pthread_mutex_unlock: a => mutexes.unlock(a(0),current.id),
    _pthread_cond_init: a => { conditions.set(a(0),[]); return 0; },
    _pthread_cond_destroy: a => { if (cond(a(0)).length) return 16; conditions.delete(a(0)); return 0; },
    _pthread_cond_wait: a => waitCond(a,false),
    _pthread_cond_timedwait: a => waitCond(a,true),
    _pthread_cond_signal: a => { const w = cond(a(0)).find(x => !x.signaled); if(w) w.signaled = true; return 0; },
    _pthread_cond_broadcast: a => { for(const w of cond(a(0))) w.signaled = true; return 0; },
    _semaphore_create: a => {
      const value = a(3) | 0; if (value < 0) return 4;
      const key = nextSemaphore++; semaphores.set(key,{value,alive:true});
      write32(cpu,a(1),key); return 0;
    },
    _semaphore_destroy: a => {
      const s = semaphores.get(a(1)); if (!s) return 4;
      s.alive = false; semaphores.delete(a(1)); return 0;
    },
    _semaphore_signal: a => { const s = semaphores.get(a(0)); if (!s) return 4; s.value++; return 0; },
    _semaphore_wait: a => {
      const s = semaphores.get(a(0)); if (!s) return 4;
      return asWait(() => { if (!s.alive) return 37; if (s.value) { s.value--; return 0; } });
    },
    _usleep: a => { const at = performance.now() + a(0)/1000; return asWait(() => performance.now()>=at ? 0 : undefined); },
    _sleep: a => { const at = performance.now() + a(0)*1000; return asWait(() => performance.now()>=at ? 0 : undefined); }
  };

  async function advance(step, nested, budgetMs = 0) {
    const ready = () => [...workers.values()].filter(t => !t.done && !t.running);
    let batch = ready();
    if (!batch.length) return;
    const deadline = performance.now() + budgetMs;
    const outer = current, outerState = cpu.saveState();
    try {
      // Each runnable thread gets a turn. The idle application loop can spend
      // its remaining time on further rounds without polling blocked threads.
      do {
        let progressed = false;
        for (const t of batch) {
          if (t.done || t.running || !workers.has(t.id)) continue;
          current = t; t.running = true;
          try {
            if (t.wait) {
              const result = t.wait();
              if (result === undefined) continue;
              t.wait = null; t.resume = result;
            }
            if (t.state) {
              cpu.restoreState(t.state);
              cpu.freeState(t.state); t.state = null;
            } else {
              cpu.threadPointer = t.pointer;
              for (let i=0; i<13; i++) cpu.setReg(i,0);
              t.args.forEach((value, i) => cpu.setReg(i, value));
              cpu.setReg(13,t.sp); cpu.setReg(14,returnAddress);
            }
            if (t.resume !== undefined) { cpu.setReg(0,t.resume); t.resume = undefined; }
            progressed = true;
            for (let i = 0; i < 8; i++) {
              const result = await step(t.pc);
              if (result.done) {
                t.value = result.value;
                for (let pass = 0; pass < 4; pass++) {
                  const pending = [...t.tls].filter(([key,value]) => value && tlsKeys.get(key));
                  if (!pending.length) break;
                  for (const [key,value] of pending) {
                    t.tls.delete(key);
                    await nested(tlsKeys.get(key),[value]);
                  }
                }
                for (const handler of exitHandlers) await handler(t.id);
                t.done = true;
                await t.onExit?.(t.value);
                release(t);
                if (t.detached) reap(t);
                break;
              }
              if (result.unwind && result.unwind.thread !== t.id) throw Error('Cross-thread C++ exception');
              t.pc = result.unwind ? result.unwind.restore(cpu) : result.pc;
              t.wait = result.wait;
              if (result.wait || result.budget) break;
            }
            if (!t.done) t.state = cpu.saveState();
          } finally { t.running = false; }
        }
        if (!progressed || performance.now() >= deadline) break;
        batch = ready();
      } while (batch.length);
    } finally {
      current = outer;
      cpu.restoreState(outerState); cpu.freeState(outerState);
    }
  }
  return {funcs, nativeFunctions, advance, spawnDetached: (pc, args, onExit) => spawn(pc, args, {detached:true}, onExit),
    onExit(handler) { exitHandlers.push(handler); },
    get unwindTop() { return read32(cpu, current.pointer - 4); },
    set unwindTop(frame) { write32(cpu, current.pointer - 4, frame); },
    get stackBottom() { return current.stackBottom; },
    close() { for (const t of workers.values()) release(t); workers.clear(); }};
}
