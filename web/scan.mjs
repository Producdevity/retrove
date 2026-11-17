import {read32,readCStringBytes,readString,write32} from '../src/runtime/memory/guest-memory.ts';

const encoder=new TextEncoder();
function wideText(cpu,ptr) {
  let s='',n=0;
  for(;;){const c=read32(cpu,ptr+n*4);if(!c)return s;s+=String.fromCodePoint(c);n++;}
}
const space=c=>c!==undefined&&/[\t\n\v\f\r ]/.test(c);
const spec=/%(?:(\d+)\$)?(\*)?(\d*)(hh|ll|[hlqjztL])?([diouxXpeEfFgGaAcsnCSc%\[])/y;

export function scanDarwin(cpu, input, format, arg, wide=false) {
  let i=0, f=0, next=0,assigned=0,completed=0;
  while(f<format.length) {
    if(space(format[f])) { while(space(format[f]))f++;while(space(input[i]))i++;continue; }
    if(format[f]!=='%') { if(input[i]!==format[f]) return {count:i===input.length&&!completed?-1:assigned,used:i}; i++;f++;continue; }
    spec.lastIndex=f;
    const m=spec.exec(format);
    if(!m)throw Error('Unsupported Darwin scanf conversion '+format.slice(f,f+16));
    f=spec.lastIndex;
    const [,position,suppress,width,length,code]=m, max=width?Number(width):Infinity;
    if(code==='%') {if(input[i]!=='%')break;i++;continue;}
    const out=suppress?0:arg(position?Number(position)-1:next++);
    const integerBytes=length==='hh'?1:length==='h'?2:['ll','q','j'].includes(length)?8:4;
    const writeInt=val=>{
      if(suppress)return;
      const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt.asUintN(64,val),true);
      cpu.write(out,bytes.subarray(0,integerBytes));
    };
    if(code==='n'){writeInt(BigInt(i));completed++;continue;}
    if(!'cC['.includes(code))while(space(input[i]))i++;
    if(i>=input.length)return {count:completed?assigned:-1,used:i};
    let chunk=input.slice(i,Number.isFinite(max)?i+max:undefined),value;
    if('diouxXp'.includes(code)) {
      const base='xXp'.includes(code)?16:code==='o'?8:code==='i'?0:10;
      const re=base===10?/^[+-]?\d+/:base===8?/^[+-]?[0-7]+/:base===16?/^[+-]?(?:0[xX])?[0-9a-fA-F]+/:/^[+-]?(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9]\d*)/;
      const token=re.exec(chunk)?.[0];if(!token)break;
      const neg=token[0]==='-',s=token.replace(/^[+-]/,'');
      const radix=base||(/^0x/i.test(s)?16:s.startsWith('0')?8:10);
      const v=BigInt(radix===16?'0x'+s.replace(/^0x/i,''):radix===8?'0o'+s:s);
      writeInt(neg?-v:v);i+=token.length;
    } else if('eEfFgGaA'.includes(code)) {
      const token=/^[+-]?(?:inf(?:inity)?|nan(?:\([a-z0-9_]*\))?|0x(?:[0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)(?:p[+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(chunk)?.[0];
      if(!token)break;
      if(/^[+-]?inf/i.test(token))value=token[0]==='-'?-Infinity:Infinity;
      else if(/^[+-]?0x/i.test(token)) {
        const [mantissa,pow]=token.replace(/^[+-]?0x/i,'').split(/p/i),[a,b='']=mantissa.split('.');
        value=(parseInt(a+b,16)*2**((Number(pow)||0)-4*b.length))*(token[0]==='-'?-1:1);
      } else value=Number(token);
      if(!suppress){
        const double=length==='l'||length==='L',bytes=new Uint8Array(double?8:4),v=new DataView(bytes.buffer);
        if(double)v.setFloat64(0,value,true);else v.setFloat32(0,value,true);cpu.write(out,bytes);
      }
      i+=token.length;
    } else {
      let n=0;
      if(code==='['){
        const negate=format[f]==='^'; if(negate)f++;
        const start=f;if(format[f]===']')f++;
        while(f<format.length&&format[f]!==']')f++;
        if(f>=format.length)throw Error('Unclosed guest scanf scanset');
        const set=format.slice(start,f++);
        const inSet=c=>{
          for(let j=0;j<set.length;j++){
            if(set[j+1]==='-'&&j+2<set.length){if(c>=set[j]&&c<=set[j+2])return true;j+=2;}
            else if(c===set[j])return true;
          }
          return false;
        };
        while(n<chunk.length&&inSet(chunk[n])!==negate)n++;
      } else if('cC'.includes(code)){n=width?Number(width):1;if(chunk.length<n)return {count:completed?assigned:-1,used:input.length};}
      else while(n<chunk.length&&!space(chunk[n]))n++;
      if(!n)break;
      if(!suppress) {
        const terminated=!('cC'.includes(code)),txt=chunk.slice(0,n);
        const destWide=length==='l'||code==='C'||code==='S';
        if(destWide){const chars=Array.from(txt);chars.forEach((ch,j)=>write32(cpu,out+4*j,ch.codePointAt(0)));if(terminated)write32(cpu,out+chars.length*4,0);}
        else {const bytes=wide?encoder.encode(txt):Uint8Array.from(txt,c=>c.charCodeAt(0));cpu.write(out,bytes);if(terminated)cpu.write(out+bytes.length,Uint8Array.of(0));}
      }
      i+=n;
    }
    if(!suppress)assigned++;completed++;
  }
  return {count:assigned,used:i};
}
export function scanImports(cpu,heap,files) {
  const narrow=ptr=>{
    const bytes=readCStringBytes(cpu,ptr),parts=[];
    for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    return parts.join('');
  };
  return {
    _sscanf:a=>scanDarwin(cpu,narrow(a(0)),readString(cpu,a(1)),i=>a(2+i)).count,
    _swscanf:a=>scanDarwin(cpu,wideText(cpu,a(0)),wideText(cpu,a(1)),i=>a(2+i),true).count,
    _fscanf:async a=>{
      const file=a(0),fmt=readString(cpu,a(1)),word=i=>a(2+i),start=await files._ftell(()=>file);
      if(start<0)return -1;
      const p=heap.alloc(4096);if(!p)return -1;
      let text='';
      try {
        for(;;) {
          const n=await files._fread(i=>[p,1,4096,file][i]);
          text+=String.fromCharCode(...cpu.read(p,n));
          const result=scanDarwin(cpu,text,fmt,word);
          if(n<4096 || result.used<text.length) {
            if(result.used<text.length)await files._fseek(i=>[file,start+result.used,0][i]);
            return result.count;
          }
        }
      } finally {heap.free(p);}
    }
  };
}
