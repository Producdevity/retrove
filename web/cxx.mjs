import {sjljExceptions} from './sjlj.mjs';
import {gnuContainerImports} from '../src/runtime/cxx/gnu-tree.ts';
import {CowStrings, EMPTY_REP_SYMBOL, gnuStringImports} from '../src/runtime/cxx/gnu-string.ts';
import { read32, readCStringBytes, write32 } from '../src/runtime/memory/guest-memory.ts';
import { pureMathImports } from '../src/runtime/ios/libc/pure-math.ts';

export function cxxImports(cpu, heap, currentThread = () => 1, unwind) {
  const bits = new DataView(new ArrayBuffer(8));
  const u64 = (a, i) => BigInt(a(i) >>> 0) | (BigInt(a(i+1) >>> 0) << 32n);
  const i64 = (a, i) => BigInt.asIntN(64,u64(a,i));
  function f32(a,i) { bits.setUint32(0,a(i),true); return bits.getFloat32(0,true); }
  function f64(a,i) { bits.setBigUint64(0,u64(a,i),true); return bits.getFloat64(0,true); }
  function decimal(pointer) {
    const match=/^\s*[+-]?[0-9]+/.exec(new TextDecoder().decode(readCStringBytes(cpu,pointer)));
    return match ? Number(BigInt.asUintN(32,BigInt(match[0].trim()))) : 0;
  }
  function word(n) { bits.setFloat32(0,n,true); return bits.getUint32(0,true); }
  function wide(n) { bits.setFloat64(0,n,true); return bits.getBigUint64(0,true); }
  function writeDouble(at,n) {
    const w=wide(n);
    write32(cpu,at,Number(w & 0xffffffffn)); write32(cpu,at+4,Number(w >> 32n));
  }
  function exactDivide(a,b) {
    if (!b) throw Error('Guest integer division by zero');
    return Math.trunc(a/b);
  }
  const top = new Map();
  const newObject = a => {
    const ptr=heap.alloc(Math.max(1,a(0)));
    if (!ptr && exceptions) return exceptions.raiseStandard('St9bad_alloc');
    if (!ptr) throw Error('C++ operator new exhausted guest memory (bad_alloc unwinding unsupported)');
    return ptr;
  };
  const funcs = {
    __Znwm:newObject, __Znam:newObject,
    __Unwind_SjLj_Register: a => {
      const thread=currentThread(), p=a(0);
      write32(cpu,p,top.get(thread) ?? 0);
      top.set(thread,p);
    },
    __Unwind_SjLj_Unregister: a => {
      const thread=currentThread(), p=a(0);
      if(top.get(thread)!==p) throw Error('Guest SJLJ context stack is inconsistent');
      const previous=read32(cpu,p);
      if(previous)top.set(thread,previous); else top.delete(thread);
    },
    ___cxa_pure_virtual: () => {throw Error('Guest called a pure virtual method');},
    __ZSt9terminatev: () => {throw Error('Guest called std::terminate()');},
    ___divmodsi4: a => {
      const x=a(0)|0,y=a(1)|0, q=exactDivide(x,y);
      write32(cpu,a(2),(x-q*y)>>>0);return q>>>0;
    },
    _atoi: a => decimal(a(0)),
    // long is 32 bits on ARMv6, so atol shares atoi's result.
    _atol: a => decimal(a(0)),
  };
  // libm and compiler-rt functions of their arguments alone; execution workers run the same ones.
  Object.assign(funcs, pureMathImports());
  for(const [name,readValue,encode,sink,at] of [['_modf',f64,wide,writeDouble,2],
    ['_modff',f32,word,(p,n)=>write32(cpu,p,word(n)),1]]) {
    funcs[name]=a=>{
      const n=readValue(a,0), whole=Math.trunc(n); sink(a(at),whole);
      let fraction=n-whole;
      if(n===whole)fraction=n<0 || Object.is(n,-0)?-0:0;
      return encode(fraction);
    };
  }
  funcs._frexp=a=>{
    let value=f64(a,0), exp=0;
    if(Number.isFinite(value) && value!==0) {
      let encoded=wide(value), raw=Number((encoded>>52n)&0x7ffn);
      if(!raw) {
        encoded=wide(value*2**54);raw=Number((encoded>>52n)&0x7ffn);exp-=54;
      }
      exp+=raw-1022;
      bits.setBigUint64(0,(encoded & 0x800fffffffffffffn) | (1022n<<52n),true);
      value=bits.getFloat64(0,true);
    }
    write32(cpu,a(2),exp);return wide(value);
  };
  funcs._ldexp=a=>{
    let x=f64(a,0), n=a(2)|0;
    if(!Number.isFinite(x) || x===0)return wide(x);
    n=Math.max(-2200,Math.min(2200,n));
    if(n>1023){x*=2**1023;n-=1023;if(n>1023){x*=2**1023;n-=1023;}}
    if(n < -1022){x*=2**(-969);n+=969;if(n < -1022){x*=2**(-969);n+=969;}}
    return wide(x*2**n);
  };
  funcs.___sincos_stret=a=>{
    const n=f64(a,1);writeDouble(a(0),Math.sin(n));writeDouble(a(0)+8,Math.cos(n));return a(0);
  };
  funcs.___sincosf_stret=a=>{
    const n=f32(a,1);write32(cpu,a(0),word(Math.sin(n)));write32(cpu,a(0)+4,word(Math.cos(n)));return a(0);
  };
  // libc++ random_shuffle uses one mutex-protected, default-seeded mt19937.
  const mt = new Uint32Array(624);
  mt[0] = 5489;
  for (let i = 1; i < mt.length; i++) mt[i] = Math.imul(1812433253, mt[i-1] ^ (mt[i-1] >>> 30)) + i;
  let index = mt.length, randomOwner = 0;
  funcs.__ZNSt3__18__rs_getEv = a => {
    const owner = currentThread(), result = a(0);
    const take = () => {
      if (randomOwner) return;
      randomOwner = owner;
      return result;
    };
    return take() ?? {wait:take};
  };
  funcs.__ZNSt3__112__rs_defaultD1Ev = () => {
    if (randomOwner !== currentThread()) throw Error('Guest released a random generator on the wrong thread');
    randomOwner = 0;
  };
  funcs.__ZNSt3__112__rs_defaultclEv = () => {
    if (index === mt.length) {
      for (let i = 0; i < mt.length; i++) {
        const x = (mt[i] & 0x80000000) | (mt[(i+1) % 624] & 0x7fffffff);
        mt[i] = mt[(i+397) % 624] ^ (x >>> 1) ^ (x & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let x = mt[index++];
    x ^= x >>> 11;
    x ^= (x << 7) & 0x9d2c5680;
    x ^= (x << 15) & 0xefc60000;
    return (x ^ (x >>> 18)) >>> 0;
  };
  const exceptions = unwind && sjljExceptions(cpu, heap, unwind);
  const data = exceptions?.data ?? new Map();
  const words = {read:p => read32(cpu, p), write:(p, x) => write32(cpu, p, x)};
  const strings = new CowStrings({...words, readBytes:(p, n) => cpu.read(p, n), writeBytes:(p, bytes) => cpu.write(p, bytes),
    allocate:n => heap.alloc(n), free:p => heap.free(p), zero:n => heap.zero(n),
    lengthError:message => {
      if (!exceptions) throw Error('std::length_error: ' + message);
      return exceptions.raiseStandard('St12length_error', heap.string(message));
    }});
  data.set(EMPTY_REP_SYMBOL, strings.emptyRep);
  Object.assign(funcs, gnuContainerImports(words), gnuStringImports(strings));
  return {...exceptions, funcs:Object.assign(funcs, exceptions?.funcs), data};

}
