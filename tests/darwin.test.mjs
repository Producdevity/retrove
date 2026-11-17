import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {darwinSystem,TASK} from '../web/darwin-system.mjs';
import {darwinAlgorithms} from '../web/darwin-algorithms.mjs';
import {formatImports,formatDarwin} from '../web/format.mjs';
import {dispatchImports} from '../web/dispatch.mjs';
import {read32,write32,readString} from '../src/runtime/memory/guest-memory.ts';

function memory() {
  const bytes=new Uint8Array(65536);
  const cpu={read:(p,n)=>bytes.slice(p,p+n),write:(p,b)=>bytes.set(b,p),mappedBytes:65536};
  let next=256;
  const live=new Set(),heap={
    alloc:n=>{const p=next;next+=Math.ceil(n/4)*4;live.add(p);return p;}, zero:n=>heap.alloc(n),
    free:p=>assert.ok(live.delete(p)), string:s=>{const b=new TextEncoder().encode(s+'\0'),p=heap.alloc(b.length);cpu.write(p,b);return p;}
  };
  return {cpu,heap,live};
}
const args=(...words)=>i=>words[i]??0;

test('Darwin iPhone profile reports guest memory and preserves sysctl size semantics',()=>{
  const {cpu,heap}=memory(),errno=heap.zero(4),f=darwinSystem(cpu,heap,errno);
  const out=heap.zero(128),size=heap.zero(4),machine=heap.string('hw.machine');
  assert.equal(f._sysconf(args(29)),4096);
  assert.equal(f._sysctlbyname(args(machine,0,size)),0);
  assert.equal(read32(cpu,size),10);
  write32(cpu,size,3);
  assert.equal(f._sysctlbyname(args(machine,out,size)),-1);
  assert.deepEqual([...cpu.read(out,3)],[105,80,104]);
  assert.equal(read32(cpu,errno),12);
  write32(cpu,size,8);
  assert.equal(f._task_info(args(TASK,4,out,size)),0);
  assert.equal(read32(cpu,out+8),65536);
  assert.equal(f._host_page_size(args(f._mach_host_self(),out)),0);
  assert.equal(read32(cpu,out),4096);
});

test('variadic Darwin printf handles packed 32-bit slots, 64-bit values, width, truncation and ObjC strings',()=>{
  const {cpu,heap}=memory(),errno=heap.zero(4),f=formatImports(cpu,heap,errno);
  const out=heap.zero(128), fmt=heap.string('%s:%#08x:%+04d:%.2f:%llu:%%'), arg=heap.string('test');
  const words=[arg,47,-2,0,0x3ff80000,0xffffffff,1];
  const expected='test:0x00002f:-002:1.50:8589934591:%';
  assert.equal(f._snprintf(args(out,128,fmt,...words)),expected.length);
  assert.equal(readString(cpu,out),expected);
  const ap=heap.zero(28); words.forEach((w,i)=>write32(cpu,ap+i*4,w));
  assert.equal(f._vsnprintf(args(out,4,fmt,ap)),expected.length);
  assert.equal(readString(cpu,out),'tes');
  assert.equal(formatDarwin(cpu,heap.string('%@/%d'),args(2,3),p=>'objc'+p),'objc2/3');
});

test('Darwin libc sort and search call guest comparators with element pointers',async()=>{
  const {cpu}=memory(),ptr=600,key=200;
  const cmp=async(pc,[a,b])=>{assert.equal(pc,65);return (read32(cpu,a)-read32(cpu,b))>>>0;};
  const f=darwinAlgorithms(cpu,cmp);
  [10,4,9,0,23].forEach((v,i)=>write32(cpu,ptr+i*4,v));
  await f._qsort(args(ptr,5,4,65));
  assert.deepEqual(Array.from({length:5},(_,i)=>read32(cpu,ptr+i*4)),[0,4,9,10,23]);
  write32(cpu,key,9);
  assert.equal(await f._bsearch(args(key,ptr,5,4,65)),ptr+8);
  write32(cpu,key,5);
  assert.equal(await f._bsearch(args(key,ptr,5,4,65)),0);
  f._srand(args(1)); assert.equal(f._rand(),16807);
});

test('async main queue uses a copied stack block, invokes guest helpers and drains once',async()=>{
  const {cpu,heap,live}=memory(), calls=[];
  const threads={funcs:{_pthread_self:()=>1,_pthread_main_np:()=>1}};
  const d=dispatchImports(cpu,heap,threads,async(pc,argv)=>{calls.push([pc,argv]);},
    {blockClasses:new Map([['__NSConcreteMallocBlock',90]])});
  const src=heap.zero(24),desc=heap.zero(16);
  [81,1<<25,0,65,desc,123].forEach((x,i)=>write32(cpu,src+i*4,x));
  [0,24,66,67].forEach((x,i)=>write32(cpu,desc+i*4,x));
  await d.funcs._dispatch_async(args(d.data.get('__dispatch_main_q'),src));
  const copy=calls[0][1][0]; assert.notEqual(copy,src);
  assert.equal(read32(cpu,copy),90);assert.equal(read32(cpu,copy+20),123);
  await d.pollMain();await d.pollMain();
  assert.deepEqual(calls.map(x=>x[0]),[66,65,67]);assert.ok(!live.has(copy));
  const predicate=heap.zero(4);
  await d.funcs._dispatch_once(args(predicate,src));await d.funcs._dispatch_once(args(predicate,src));
  assert.equal(read32(cpu,predicate),0xffffffff);assert.equal(calls.length,4);
});

test('guest BSD sockets exchange bytes over loopback and report unreachable external addresses',async()=>{
  const {networkImports}=await import('../web/network.mjs');
  const {cpu,heap}=memory(),states=new Map(),errno=heap.zero(4),sa=heap.zero(16);
  const table={get:fd=>states.get(fd),exists:fd=>states.has(fd),
    install:device=>{const fd=3+states.size;states.set(fd,{device});return fd;}};
  const f=networkImports(cpu,heap,errno,table);
  const listen=f._socket(args(2,1,0)),client=f._socket(args(2,1,0));
  cpu.write(sa,Uint8Array.of(16,2,0x5a,0xc1,127,0,0,1));
  assert.equal(f._bind(args(listen,sa,16)),0);assert.equal(f._listen(args(listen,5)),0);
  const waiting=f._accept(args(listen,0,0));
  assert.equal(waiting.wait(),undefined);
  assert.equal(f._connect(args(client,sa,16)),0);
  const fd=waiting.wait(),set=heap.zero(4),now=heap.zero(8),msg=heap.string('hi'),buf=heap.zero(4);
  write32(cpu,set,1<<fd);assert.equal(f._select(args(fd+1,set,0,0,now)),0);
  assert.equal(f._send(args(client,msg,2,0)),2);
  write32(cpu,set,1<<fd);assert.equal(f._select(args(fd+1,set,0,0,now)),1);
  assert.equal(f._recv(args(fd,buf,2,0)),2);assert.equal(readString(cpu,buf),'hi');
  cpu.write(sa+4,Uint8Array.of(192,0,2,1));
  assert.equal(f._connect(args(f._socket(args(2,1,0)),sa,16)),-1);assert.equal(read32(cpu,errno),51);
  const addr=f._inet_addr(args(heap.string('127.1'))); assert.equal(addr,0x0100007f);
  assert.equal(readString(cpu,f._inet_ntoa(args(addr))),'127.0.0.1');
});

test('narrow and wide scanf return assignment counts and packed ARM fields',async()=>{
  const {scanDarwin,scanImports}=await import('../web/scan.mjs');
  const {cpu,heap}=memory(),n=heap.zero(2),name=heap.zero(10),len=heap.zero(4),num=heap.zero(8);
  const r=scanDarwin(cpu,'0xff tag=Bob; 1.5','%hi tag=%3[a-zA-Z]; %lf%n',args(n,name,num,len));
  assert.equal(r.count,3);assert.equal(read32(cpu,len),17);assert.deepEqual([...cpu.read(n,2)],[255,0]);
  assert.equal(new DataView(cpu.read(num,8).buffer).getFloat64(0,true),1.5);assert.equal(readString(cpu,name),'Bob');
  const w=s=>{const p=heap.zero((s.length+1)*4);Array.from(s).forEach((v,i)=>write32(cpu,p+i*4,v.charCodeAt(0)));return p;};
  const f=scanImports(cpu,heap,{});
  assert.equal(f._swscanf(args(w('9'),w('%u'),len)),1);assert.equal(read32(cpu,len),9);
  assert.equal(scanDarwin(cpu,'','%i',args(n)).count,-1);
  assert.equal(scanDarwin(cpu,'x','%i',args(n)).count,0);
});

test('Darwin calendar exposes time_t32 and tm offsets plus C-locale strftime',async()=>{
  const {calendarImports}=await import('../web/calendar.mjs');
  const {cpu,heap}=memory(),err=heap.zero(4),p=heap.zero(4),out=heap.zero(100);
  const f=calendarImports(cpu,heap,err,()=>1);
  write32(cpu,p,946684800);const time=f._gmtime(args(p));
  assert.equal(read32(cpu,time+20),100);assert.equal(read32(cpu,time+24),6);
  assert.equal(f._strftime(args(out,100,heap.string('%F %T %a %z'),time)),29);
  assert.equal(readString(cpu,out),'2000-01-01 00:00:00 Sat +0000');
});

test('ARMv7 backtrace walks the r7 chain and returns one freeable symbol buffer',async()=>{
  const {backtraceImports}=await import('../web/backtrace.mjs');
  const {cpu,heap}=memory();
  cpu.getReg=r=>({7:2000,13:1900,14:0x1005})[r];
  write32(cpu,2000,2016);write32(cpu,2004,0x1021);
  write32(cpu,2016,0);write32(cpu,2020,0x1048);
  const f=backtraceImports(cpu,heap,64,{segments:[{address:0x1000,size:0x100,protection:5}],symbolAt:p=>({name:'fun',offset:p-0x1000})},'game');
  const out=heap.zero(24);
  assert.equal(f._backtrace(args(out,6)),3);
  assert.deepEqual([0,1,2].map(i=>read32(cpu,out+i*4)),[0x1005,0x1021,0x1048]);
  const names=f._backtrace_symbols(args(out,3));
  assert.match(readString(cpu,read32(cpu,names)),/game +0x00001005 fun \+ 5/);
  assert.match(readString(cpu,read32(cpu,names+8)),/fun \+ 72/);
  heap.free(names);
});

test('Darwin uname writes the complete native five-field structure and preserves adjacent memory',()=>{
 const {cpu,heap}=memory(),errno=heap.zero(4),f=darwinSystem(cpu,heap,errno),p=4096;cpu.write(p-1,new Uint8Array(1282).fill(0xab));
 assert.equal(f._uname(args(p)),0);
 assert.deepEqual(Array.from({length:5},(_,i)=>readString(cpu,p+i*256)),['Darwin','localhost','14.0.0','Retrove iOS compatibility runtime','iPhone5,1']);
 assert.equal(cpu.read(p-1,1)[0],0xab);assert.equal(cpu.read(p+1280,1)[0],0xab);
 for(let i=0;i<5;i++){const bytes=cpu.read(p+i*256,256),nul=bytes.indexOf(0);assert.ok(nul>0);assert.equal(bytes.slice(nul).some(Boolean),false);}
 assert.equal(f._uname(args(0)),-1);assert.equal(read32(cpu,errno),14);
});
