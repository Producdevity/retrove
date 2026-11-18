import {backtraceImports} from './backtrace.mjs';
import {scanImports} from './scan.mjs';
import {networkImports} from './network.mjs';
import {calendarImports} from './calendar.mjs';
import {darwinAlgorithms} from './darwin-algorithms.mjs';
import {fill, move, read32, readCStringBytes, readString, write32} from '../src/runtime/memory/guest-memory.ts';
import {defaultRuneLocale, stringImports} from './strings.mjs';
import {guestZlibStreams} from './guest-zlib.mjs';
import {formatImports} from './format.mjs';
import {fileImports} from './files.mjs';
import {darwinSystem, TASK} from './darwin-system.mjs';
import {virtualMemoryImports} from './vm.mjs';

export function systemImports(cpu, heap, ipa, log, threadID = () => 1, diagnostic, missingAsset, hostGate, callGuest, image) {
  const data = new Map();
  const word = (name, value) => {
    const p = heap.zero(4);
    write32(cpu, p, value);
    data.set(name, p);
    return p;
  };
  const errno = heap.zero(4);
  const errorStrings = new Map();
  const errorMessages={0:'Undefined error: 0',1:'Operation not permitted',2:'No such file or directory',3:'No such process',
    4:'Interrupted system call',5:'Input/output error',9:'Bad file descriptor',11:'Resource deadlock avoided',
    12:'Cannot allocate memory',13:'Permission denied',14:'Bad address',16:'Resource busy',17:'File exists',
    19:'Operation not supported by device',20:'Not a directory',21:'Is a directory',22:'Invalid argument',
    24:'Too many open files',27:'File too large',28:'No space left on device',29:'Illegal seek',
    30:'Read-only file system',32:'Broken pipe',34:'Result too large',35:'Resource temporarily unavailable',
    38:'Socket operation on non-socket',40:'Message too long',42:'Protocol not available',43:'Protocol not supported',
    45:'Operation not supported',47:'Address family not supported by protocol family',48:'Address already in use',
    49:"Can't assign requested address",50:'Network is down',51:'Network is unreachable',54:'Connection reset by peer',
    56:'Socket is already connected',57:'Socket is not connected',60:'Operation timed out',61:'Connection refused',
    63:'File name too long',66:'Directory not empty',78:'Function not implemented',84:'Value too large to be stored in data type',93:'Attribute not found'};
  const errorText=n=>Object.hasOwn(errorMessages,n)?errorMessages[n]:'Unknown error: '+(n|0);
  const guard = new Uint32Array(1);
  crypto.getRandomValues(guard);
  word('___stack_chk_guard', guard[0] & 0xffffff00);
  word('_mach_task_self_', TASK);
  data.set('__DefaultRuneLocale', defaultRuneLocale(cpu, heap));
  const double = new DataView(new ArrayBuffer(8));
  const absoluteTime = () => BigInt(Math.floor(performance.now() * 1e6));
  const compareSwap = a => {
    if (read32(cpu, a(2)) !== a(0)) return 0;
    write32(cpu, a(2), a(1));
    return 1;
  };
  // The guest environment starts in the portable C locale.
  const cLocale = heap.string('C');
  const decimalPoint = heap.string('.');
  const localeInfo = heap.zero(56);
  for (let i = 0; i < 10; i++) write32(cpu, localeInfo + 4 * i, decimalPoint + (i ? 1 : 0));
  fill(cpu, localeInfo + 40, 127, 14);
  const guardsInProgress = new Map(), signals = new Map();
  const finalizers = [];
  const resize = (address, size) => {
    if (!address) return heap.alloc(size);
    const old = heap.live.get(address);
    if (old === undefined) throw new Error('Invalid guest realloc');
    if (size && size <= old) return address;
    const p = heap.alloc(size);
    if (p) { move(cpu, p, address, Math.min(old, size)); heap.free(address); }
    return p;
  };
  const cmp = (l, r, n) => {
    for (let i = 0; i < n; i++) {
      const diff = (l[i] || 0) - (r[i] || 0);
      if (diff) return diff;
    }
    return 0;
  };
  const alloc = a => heap.alloc(a(0));
  const del = a => { heap.free(a(0)); };
  const fileFuncs = fileImports(cpu, ipa, heap, errno, log, undefined, diagnostic, missingAsset, data);
  const funcs = {
    ...virtualMemoryImports(cpu, errno),
    ...darwinSystem(cpu, heap, errno),
    ...darwinAlgorithms(cpu, callGuest),
    ...scanImports(cpu, heap, fileFuncs),
    ...backtraceImports(cpu, heap, errno, image, ipa.info?.CFBundleExecutable),
    ...networkImports(cpu, heap, errno, fileFuncs.descriptors),
    ...calendarImports(cpu, heap, errno, threadID),
    _malloc: alloc, _free: del, _calloc: a => heap.zero(a(0) * a(1)),
    _realloc: a => resize(a(0), a(1)),
    _posix_memalign: a => {
      const alignment = a(1);
      if (alignment < 4 || (alignment & (alignment - 1))) return 22;
      const pointer = heap.alloc(a(2), Math.max(16, alignment));
      if (!pointer) return 12;
      write32(cpu, a(0), pointer);
      return 0;
    },
    __Znwj: alloc, __Znaj: alloc, __ZdlPv: del, __ZdaPv: del,
    ___error: () => errno,
    _strerror:a=>{const n=a(0)|0;if(!errorStrings.has(n))errorStrings.set(n,heap.string(errorText(n)));return errorStrings.get(n);},
    _perror:async a=>{const prefix=a(0)?readString(cpu,a(0)):'';await fileFuncs.writeBytes(2,new TextEncoder().encode((prefix?prefix+': ':'')+errorText(read32(cpu,errno))+'\n'));},
    ___assert_rtn:a=>{throw Error('Guest assertion failed: '+readString(cpu,a(3))+' ('+readString(cpu,a(1))+':'+a(2)+', '+(a(0)?readString(cpu,a(0)):'?')+')');},
    _system:a=>a(0)?127<<8:0, // This browser process has no command interpreter.
    _sched_yield:()=>{let yielded=false;return {wait(){if(yielded)return 0;yielded=true;}};},
    _malloc_size: a => heap.live.get(a(0)) || 0,
    _memcpy: a => { move(cpu, a(0), a(1), a(2)); return a(0); },
    _memset: a => { fill(cpu, a(0), a(1), a(2)); return a(0); },
    _bzero: a => fill(cpu, a(0), 0, a(1)),
    ___memcpy_chk: a => { if (a(2) > a(3)) throw Error('Guest __memcpy_chk overflows its destination'); move(cpu, a(0), a(1), a(2)); return a(0); },
    ___memset_chk: a => { if (a(2) > a(3)) throw Error('Guest __memset_chk overflows its destination'); fill(cpu, a(0), a(1), a(2)); return a(0); },
    _memcmp: a => {
      let done = 0;
      while (done < a(2)) {
        const count = Math.min(a(2) - done, 16384);
        const d = cmp(cpu.read(a(0) + done, count), cpu.read(a(1) + done, count), count);
        if (d) return d;
        done += count;
      }
      return 0;
    },
    ...stringImports(cpu, errno),
    ...guestZlibStreams(cpu, heap, hostGate),
    _strdup: a => {
      const s = readCStringBytes(cpu, a(0));
      const ptr = heap.alloc(s.length + 1);
      if (ptr) { cpu.write(ptr, s); cpu.write(ptr + s.length, Uint8Array.of(0)); }
      return ptr;
    },
    _strcmp: a => {
      const l = readCStringBytes(cpu, a(0)), r = readCStringBytes(cpu, a(1));
      return cmp(l, r, Math.max(l.length, r.length, 1));
    },
    _getpid: () => 1,
    _signal: a => {
      const n=a(0), handler=a(1);
      if (!n || n>31 || n===9 || n===17 || handler===0xffffffff) { write32(cpu,errno,22); return 0xffffffff; }
      const previous=signals.get(n)??0;
      signals.set(n,handler); return previous;
    },
    _raise: async a => {
      const n=a(0), handler=signals.get(n)??0;
      if (!n || n>31) { write32(cpu,errno,22); return -1; }
      if (handler===1 || (!handler && [16,19,20,28,29].includes(n))) return 0;
      if (handler) { await callGuest(handler,[n]); return 0; }
      throw Error('Guest received Darwin signal '+n);
    },
    _localeconv: () => localeInfo,
    _setlocale: a => {
      if (a(0) > 6) return 0;
      if (!a(1)) return cLocale;
      const locale = readString(cpu, a(1));
      return locale === '' || locale === 'C' || locale === 'POSIX' ? cLocale : 0;
    },
    _OSAtomicAdd32Barrier: a => {
      const value = (read32(cpu, a(1)) + a(0)) >>> 0;
      write32(cpu, a(1), value);
      return value;
    },
    _OSAtomicCompareAndSwap32Barrier: compareSwap,
    _OSAtomicCompareAndSwapPtrBarrier: compareSwap,
    _time: a => {
      const seconds = Math.floor(Date.now() / 1000);
      if (a(0)) write32(cpu, a(0), seconds);
      return seconds;
    },
    _CFAbsoluteTimeGetCurrent: () => {
      double.setFloat64(0, Date.now() / 1000 - 978307200, true);
      return double.getBigUint64(0, true);
    },
    _mach_absolute_time: absoluteTime,
    _mach_wait_until: a => {
      const deadline = BigInt(a(0)) | (BigInt(a(1)) << 32n);
      const poll = () => absoluteTime() >= deadline ? 0 : undefined;
      return poll() ?? {wait: poll};
    },
    _mach_timebase_info: a => { write32(cpu, a(0), 1); write32(cpu, a(0) + 4, 1); return 0; },
    _gettimeofday: a => {
      const now = Date.now();
      if (a(0)) {
        write32(cpu, a(0), Math.floor(now / 1000));
        write32(cpu, a(0) + 4, (now % 1000) * 1000);
      }
      return 0;
    },
    ___cxa_atexit: a => { finalizers.push({pc:a(0), arg:a(1), image:a(2)}); return 0; },
    ___cxa_guard_acquire: a => {
      const address = a(0), owner = threadID();
      if (guardsInProgress.get(address) === owner) throw new Error('Reentrant local static initialization');
      const poll = () => {
        if (cpu.read(address, 1)[0] & 1) return 0;
        if (guardsInProgress.has(address)) return;
        guardsInProgress.set(address,owner);
        return 1;
      };
      return poll() ?? {wait:poll};
    },
    ___cxa_guard_release: a => { cpu.write(a(0), Uint8Array.of(1)); guardsInProgress.delete(a(0)); },
    ___cxa_guard_abort: a => { guardsInProgress.delete(a(0)); },
    ___stack_chk_fail: () => { throw new Error('Guest stack check failed'); },
    _abort: () => { throw new Error('Guest called abort()'); },
    _exit: a => ({exit: a(0) | 0}),
    ...formatImports(cpu, heap, errno, fileFuncs, log),
    ...fileFuncs
  };
  funcs._memmove = funcs._memcpy;
  funcs.___memmove_chk = funcs.___memcpy_chk;
  return {data, funcs, finalizers, setMetadata:fileFuncs.setMetadata,closeFiles:fileFuncs.closeFiles};
}
