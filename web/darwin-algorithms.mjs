import {secureRandomImports} from "../src/runtime/ios/libc/secure-random.ts";
import {randomImports} from "../src/runtime/ios/libc/random.ts";
import {move, read32, write32} from './memory.mjs';

export function darwinAlgorithms(cpu, callGuest) {
  let seed=1;
  async function sort(a) {
    const base=a(0), count=a(1), width=a(2), compare=a(3);
    if (count<2 || !width) return;
    if (base+count*width > 0x100000000) throw Error('Guest qsort array size overflows its address space');
    const ptr=i=>base+i*width;
    function swap(left,right) {
      const bytes=cpu.read(ptr(left),width).slice();
      move(cpu,ptr(left),ptr(right),width);cpu.write(ptr(right),bytes);
    }
    async function down(root, end) {
      for (let child=root*2+1;child<end;child=root*2+1) {
        if (child+1<end && (await callGuest(compare,[ptr(child),ptr(child+1)])|0)<0) child++;
        if ((await callGuest(compare,[ptr(root),ptr(child)])|0)>=0) break;
        swap(root,child);root=child;
      }
    }
    for (let start=Math.floor(count/2)-1;start>=0;start--) await down(start,count);
    for (let end=count-1;end>0;end--) {swap(0,end);await down(0,end);}
  }
  return {
    ...randomImports(),
    ...secureRandomImports({write:(pointer,bytes)=>cpu.write(pointer,bytes)}),
    _bsearch: async a=>{
      const key=a(0),base=a(1),count=a(2),width=a(3),compare=a(4);
      if (!width) return 0;
      if (base+count*width>0x100000000) throw Error('Guest bsearch array size overflows its address space');
      let low=0,high=count;
      while(low<high) {
        const mid=Math.floor((high+low)/2),ptr=base+mid*width;
        const cmp=(await callGuest(compare,[key,ptr]))|0;
        if (!cmp) return ptr;
        if(cmp>0) low=mid+1; else high=mid;
      }
      return 0;
    },
    _qsort: sort,
    _srand:a=>{seed=a(0);},
    _rand:()=>{seed=((seed||123459876)*16807)%2147483647;return seed;},
    _memset_pattern16:a=>{
      const addr=a(0),n=a(2);
      if(!n) return;
      const pattern=cpu.read(a(1),16).slice(),buf=new Uint8Array(Math.min(65536,n));
      for(let i=0;i<buf.length;i+=16)buf.set(pattern.subarray(0,Math.min(16,buf.length-i)),i);
      for(let i=0;i<n;i+=buf.length)cpu.write(addr+i,buf.subarray(0,Math.min(buf.length,n-i)));
    }
  };
}
