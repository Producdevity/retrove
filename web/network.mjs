// Safari has no raw TCP/UDP API. The guest has an isolated IPv4 loopback device.
import {read32,readString,write32} from '../src/runtime/memory/guest-memory.ts';

const LOCAL=0x0100007f, STREAM=1, DGRAM=2, WINDOW=262144;
function ipv4(text) {
  const parts=text.split('.');
  if (!parts.length || parts.length>4) return null;
  let result=0n;
  for(let i=0;i<parts.length;i++){
    const s=parts[i],hex=/^0[xX][0-9a-fA-F]+$/.test(s),oct=/^0[0-7]+$/.test(s);
    if(!hex&&!oct&&!/^(?:0|[1-9][0-9]*)$/.test(s)) return null;
    const number=BigInt(oct?'0o'+s:s),width=i===parts.length-1?8*(5-parts.length):8;
    if(number>=(1n<<BigInt(width))) return null;
    result=(result<<BigInt(width))|number;
  }
  const n=Number(result);return ((n>>>24)|((n>>>8)&0xff00)|((n<<8)&0xff0000)|(n<<24))>>>0;
}

export function networkImports(cpu,heap,errno,table) {
  const fail=n=>{write32(cpu,errno,n);return -1;};
  const bound=new Map(),interfaces=new Set();
  let nextPort=49152,ntoa,host;
  // Darwin EAI_* codes; only loopback and numeric IPv4 names resolve on the isolated device.
  const EAI={FAMILY:5,MEMORY:6,NONAME:8,SERVICE:9,SOCKTYPE:10},PASSIVE=1,SERVICES={http:80,https:443};
  const addressInfos=new Set(),gaiMessages=new Map();
  function port(service){
    if(!service)return 0;
    if(/^\d+$/.test(service))return Number(service)<65536?Number(service):null;
    return SERVICES[service.toLowerCase()]??null;
  }
  const portKey=(type,port)=>type+':'+port;
  function idlePort(type){
    for(let i=0;i<16384;i++){const p=nextPort; nextPort=p===65535?49152:p+1;if(!bound.has(portKey(type,p)))return p;}
    return 0;
  }
  function sockaddr(p,size) {
    if (!p || size<8) return null;
    const b=cpu.read(p,8);
    return b[1]===2 ? {port:b[2]*256+b[3],ip:read32(cpu,p+4)} : null;
  }
  function addrBytes(ip,port) {
    const b=new Uint8Array(16);b.set([16,2,port>>>8,port&255]);new DataView(b.buffer).setUint32(4,ip,true);return b;
  }
  const sock=fd=>table.get(fd)?.device;
  const check=(fd,body)=>sock(fd)?body(sock(fd)):fail(table.exists(fd)?38:9);
  function wait(s,flags,poll) {
    const immediate=poll();
    if(immediate!==undefined)return immediate;
    if(table.get(s.fd)?.nonblocking || (flags&0x80))return fail(35);
    return {wait:()=>s.closed?fail(9):poll()};
  }
  function recv(s,ptr,n,flags) {
    if (!n) return 0;
    if (!s.peer && !s.eof && s.type===STREAM) return fail(57);
    return wait(s,flags,()=>{
      if(!s.rx.length)return s.eof?0:undefined;
      const first=s.rx[0],length=Math.min(n,first.length);
      if(length)cpu.write(ptr,first.subarray(0,length));
      if(!(flags&2)){
        if(length===first.length||s.type===DGRAM){s.rx.shift();s.pendingBytes-=first.length;}
        else{s.rx[0]=first.subarray(length);s.pendingBytes-=length;}
      }
      return length;
    });
  }
  function send(s,ptr,n,flags) {
    const dest=s.type===DGRAM?bound.get(portKey(DGRAM,s.remote)):s.peer;
    if(!dest || dest.closed) return fail(s.type===DGRAM?61:s.eof?32:57);
    if(s.type===DGRAM&&n>65507)return fail(40);
    return wait(s,flags,()=>{
      if(dest.closed)return fail(32);
      const room=WINDOW-dest.pendingBytes;
      if (n && (!room || (s.type===DGRAM && n>room)))return;
      const length=Math.min(room,n);
      if(length||s.type===DGRAM){dest.rx.push(cpu.read(ptr,length).slice());dest.pendingBytes+=length;}
      return length;
    });
  }
  function create(type) {
    const s={type,port:0,ip:LOCAL,closed:false,listening:false,rx:[],pending:[],pendingBytes:0,eof:false,
      read:(p,n)=>recv(s,p,n,0),write:(p,n)=>send(s,p,n,0),
      close:async()=>{
        s.closed=true;
        if(bound.get(portKey(type,s.port))===s)bound.delete(portKey(type,s.port));
        if(s.peer){s.peer.peer=null;s.peer.eof=true;}
        for(const pending of s.pending.splice(0))if(table.exists(pending.fd))await table.close(pending.fd);
      }
    };
    s.fd=table.install(s);return s;
  }
  function bind(s,address) {
    if(s.port)return fail(22);
    if(address.ip!==0&&(address.ip&255)!==127)return fail(49);
    const port=address.port||idlePort(s.type),key=portKey(s.type,port);
    if(!port||bound.has(key))return fail(48);
    s.ip=address.ip;s.port=port;bound.set(key,s);return 0;
  }
  const timeout=a=>{
    if(!a) return Infinity;
    const sec=read32(cpu,a)|0,us=read32(cpu,a+4)|0;
    return sec<0||us<0||us>=1000000?NaN:performance.now()+1000*sec+us/1000;
  };
  return {
    _socket:a=>a(0)!==2?fail(47):![STREAM,DGRAM].includes(a(1))?fail(44):
      a(2) && a(2)!==(a(1)===STREAM?6:17)?fail(43):create(a(1)).fd,
    _bind:a=>check(a(0),s=>{const addr=sockaddr(a(1),a(2));return addr?bind(s,addr):fail(22);}),
    _listen:a=>check(a(0),s=>{
      if(s.type!==STREAM||s.peer)return fail(45);
      if(!s.port && bind(s,{ip:0,port:0})<0)return -1;
      s.listening=true;s.backlog=Math.max(1,a(1)|0);return 0;
    }),
    _connect:a=>check(a(0),s=>{
      const adr=sockaddr(a(1),a(2));if(!adr)return fail(22);
      if((adr.ip&255)!==127)return fail(51); // ENETUNREACH outside the guest.
      if(s.peer||s.listening)return fail(56);
      if(!s.port&&bind(s,{ip:LOCAL,port:0})<0)return -1;
      s.remote=adr.port;
      if(s.type===DGRAM)return 0;
      const listener=bound.get(portKey(STREAM,adr.port));
      if(!listener?.listening||listener.pending.length>=listener.backlog)return fail(61);
      const server=create(STREAM);server.port=listener.port;server.peer=s;s.peer=server;listener.pending.push(server);
      return 0;
    }),
    _accept:a=>check(a(0),s=>{
      const dest=a(1),len=a(2);
      if(!s.listening)return fail(22);
      if(dest&&!len)return fail(14);
      return wait(s,0,()=>{
        if(!s.pending.length)return;
        const c=s.pending.shift();
        if(dest){const b=addrBytes(LOCAL,c.peer?.port||0);cpu.write(dest,b.subarray(0,read32(cpu,len)));write32(cpu,len,b.length);}
        return c.fd;
      });
    }),
    _recv:a=>check(a(0),s=>recv(s,a(1),a(2),a(3))),
    _send:a=>check(a(0),s=>send(s,a(1),a(2),a(3))),
    _setsockopt:a=>check(a(0),s=>{
      if(!a(3)||a(4)<4)return fail(22);
      if(!((a(1)===0xffff&&[4,8,0x20,0x1022].includes(a(2))) || (a(1)===6&&a(2)===1&&s.type===STREAM)))return fail(42);
      // Loopback has no packet coalescing, keepalive probes or outbound signals.
      (s.options??=new Map()).set(a(1)+':'+a(2),read32(cpu,a(3)));return 0;
    }),
    _select:a=>{
      const n=a(0)|0;if(n<0||n>1024)return fail(22);
      const size=Math.ceil(n/32)*4,deadline=timeout(a(4));if(Number.isNaN(deadline))return fail(22);
      const args=[a(1),a(2),a(3)].map(ptr=>({ptr,bits:ptr?cpu.read(ptr,size).slice():null}));
      function poll(){
        let ready=0;
        const masks=args.map(({bits})=>bits&&new Uint8Array(size));
        for(let i=0;i<n;i++)for(let set=0;set<3;set++) {
          const mask=1<<(i%8),index=i>>>3;
          if(!(args[set].bits?.[index]&mask))continue;
          if(!table.exists(i))return fail(9);
          const s=sock(i),r=set===2?false:!s?true:set===0?s.rx.length||s.eof||s.pending.length:
            s.type===DGRAM || (!s.listening&&s.peer&&s.peer.pendingBytes<WINDOW);
          if(r){masks[set][index]|=mask;ready++;}
        }
        if(!ready&&performance.now()<deadline)return;
        args.forEach(({ptr},i)=>{if(ptr)cpu.write(ptr,masks[i]);});
        return ready;
      }
      return poll()??{wait:poll};
    },
    _inet_addr:a=>ipv4(readString(cpu,a(0)))??0xffffffff,
    _inet_ntoa:a=>{
      const s=[0,8,16,24].map(shift=>(a(0)>>>shift)&255).join('.')+'\0';
      ntoa??=heap.zero(16);cpu.write(ntoa,new TextEncoder().encode(s));return ntoa;
    },
    _if_nametoindex:a=>readString(cpu,a(0))==='lo0'?1:0,
    _getifaddrs:a=>{
      if(!a(0))return fail(14);
      const p=heap.zero(64);if(!p)return fail(12);
      const name=p+28,address=p+32,mask=p+48;
      cpu.write(name,new TextEncoder().encode('lo0\0'));cpu.write(address,addrBytes(LOCAL,0));cpu.write(mask,addrBytes(255,0));
      [0,name,0x8049,address,mask,0,0].forEach((v,i)=>write32(cpu,p+4*i,v));
      interfaces.add(p);write32(cpu,a(0),p);return 0;
    },
    _freeifaddrs:a=>{if(interfaces.delete(a(0)))heap.free(a(0));},
    _getaddrinfo:a=>{
      const node=a(0)?readString(cpu,a(0)):'',service=a(1)?readString(cpu,a(1)):'',hints=a(2);
      const flags=hints?read32(cpu,hints):0,family=hints?read32(cpu,hints+4):0,socktype=hints?read32(cpu,hints+8)||STREAM:STREAM;
      if(!node&&!service)return EAI.NONAME;
      if(family!==0&&family!==2)return EAI.FAMILY;
      if(socktype!==STREAM&&socktype!==DGRAM)return EAI.SOCKTYPE;
      const number=port(service);if(number===null)return EAI.SERVICE;
      const ip=node?ipv4(node)??(['localhost','localhost.localdomain'].includes(node.toLowerCase())?LOCAL:null):flags&PASSIVE?0:LOCAL;
      if(ip===null)return EAI.NONAME;
      const info=heap.zero(48);if(!info)return EAI.MEMORY;
      [flags,2,socktype,socktype===STREAM?6:17,16,0,info+32,0].forEach((v,i)=>write32(cpu,info+4*i,v));
      cpu.write(info+32,addrBytes(ip,number));addressInfos.add(info);write32(cpu,a(3),info);return 0;
    },
    _freeaddrinfo:a=>{if(addressInfos.delete(a(0)))heap.free(a(0));},
    _gai_strerror:a=>{
      if(!gaiMessages.has(a(0))){
        const text=(a(0)===EAI.NONAME?'nodename nor servname provided, or not known':a(0)===EAI.SERVICE?'servname not supported for ai_socktype':'Unknown error')+'\0';
        const p=heap.zero(text.length);cpu.write(p,new TextEncoder().encode(text));gaiMessages.set(a(0),p);
      }
      return gaiMessages.get(a(0));
    },
    _gethostbyname:a=>{
      const name=readString(cpu,a(0)),ip=ipv4(name)??(['localhost','localhost.localdomain'].includes(name.toLowerCase())?LOCAL:null);
      if(ip===null)return 0;
      host??=heap.zero(296);
      const bytes=new TextEncoder().encode(name+'\0');if(bytes.length>255)return 0;
      cpu.write(host+40,bytes);write32(cpu,host,host+40);write32(cpu,host+4,host+20);
      write32(cpu,host+8,2);write32(cpu,host+12,4);write32(cpu,host+16,host+24);
      write32(cpu,host+24,host+32);write32(cpu,host+32,ip);return host;
    }
  };
}
