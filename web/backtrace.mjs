import {read32,write32} from './memory.mjs';

// Darwin's ARMv7 frame pointer is r7. Each record contains the previous r7 and saved lr.
export function guestStack(cpu, limit, image) {
  if(!cpu||limit<=0)return [];
  const stack=cpu.getReg(13),frames=[];
  let frame=cpu.getReg(7), address=cpu.getReg(14);
  for(let i=0;i<limit&&address;i++) {
    const pc=address-address%2;
    if(image&&!image.segments.some(s=>(s.protection&4)&&pc>=s.address&&pc<s.address+s.size))break;
    frames.push(address);
    if(!frame||(frame&3)||frame<stack||frame-stack>=32*1024*1024)break;
    let next;
    try {next=read32(cpu,frame);address=read32(cpu,frame+4);}
    catch {break;} // A partially written frame can still describe its caller.
    if(next&&next<frame+8)break;
    frame=next;
  }
  return frames;
}

export function backtraceImports(cpu,heap,errno,image,executable='guest') {
  return {
    _backtrace:a=>{
      const out=a(0),limit=a(1)|0;
      if(!out||limit<=0)return 0;
      const frames=guestStack(cpu,limit,image);
      frames.forEach((p,i)=>write32(cpu,out+4*i,p));
      return frames.length;
    },
    _backtrace_symbols:a=>{
      const addr=a(0),count=a(1)|0;
      if(!addr||count<=0)return 0;
      const encode=new TextEncoder(), lines=[];
      let length=4*count;
      for(let i=0;i<count;i++) {
        const address=read32(cpu,addr+i*4),symbol=image?.symbolAt(address);
        const hex='0x'+address.toString(16).padStart(8,'0');
        const line=encode.encode(i+'   '+(symbol?executable:'???')+'   '+hex+' '+(symbol?symbol.name+' + '+symbol.offset:hex)+'\0');
        lines.push(line);length+=line.length;
      }
      const out=heap.alloc(length);
      if(!out){write32(cpu,errno,12);return 0;}
      let text=out+4*count;
      lines.forEach((line,i)=>{write32(cpu,out+4*i,text);cpu.write(text,line);text+=line.length;});
      return out;
    },
  };
}
