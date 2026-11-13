import {read32, readCStringBytes, write32} from './memory.mjs';

const utf8 = new TextEncoder();
const byteString = bytes => {
  let s = '';
  for (let p = 0; p < bytes.length; p += 8192) s += String.fromCharCode(...bytes.subarray(p,p+8192));
  return s;
};
function narrow(cpu, at, limit) {
  if (limit === undefined) return byteString(readCStringBytes(cpu, at));
  let s = '';
  while (s.length < limit) {
    const pos = at+s.length, part = cpu.read(pos,Math.min(4096-pos%4096,limit-s.length));
    const end = part.indexOf(0);
    if (end !== -1) return s+byteString(part.subarray(0,end));
    s += byteString(part);
  }
  return s;
}
function wide(cpu, at, limit = Infinity) {
  let s = '';
  while (s.length < limit) {
    const cp = read32(cpu,at); at += 4;
    if (!cp) break;
    const bytes = utf8.encode(String.fromCodePoint(cp));
    if (s.length+bytes.length > limit) break;
    s += byteString(bytes);
  }
  return s;
}
function asciiBytes(s) { return Uint8Array.from(s,c=>c.charCodeAt(0)); }

export function formatDarwin(cpu, template, word, describeObject) {
  const bits = new DataView(new ArrayBuffer(8));
    const fmt = narrow(cpu,template);
    let out = '', index = 0, pos = 0;
    const next = () => word(index++) >>> 0;
    const next64 = () => BigInt(next()) | (BigInt(next()) << 32n);
    // ARMv7 Darwin varargs pack 64-bit values at four-byte alignment.
    const spec = /%([-+# 0']*)(\*|[0-9]*)(?:\.(\*|[0-9]*))?(hh|ll|[hlqjztL])?([diuoxXpcCsSneEfgGFaA%@])/y;
    while (pos < fmt.length) {
      const percent = fmt.indexOf('%',pos);
      if (percent < 0) { out += fmt.slice(pos); break; }
      out += fmt.slice(pos,percent);
      spec.lastIndex = percent;
      const match = spec.exec(fmt);
      if (!match) throw Error('Unsupported Darwin printf conversion ' + fmt.slice(percent,percent+18));
      pos = spec.lastIndex;
      let [,flags,w,p,length,kind] = match;
      let width = w === '*' ? next()|0 : Number(w);
      if (width < 0) { flags+='-'; width=-width; }
      const digits = p === '*' ? next()|0 : p === undefined ? -1 : Number(p);
      const precision = digits < 0 ? undefined : digits;
      const long = ['ll','q','j'].includes(length);
      let s = '', prefix = '', pad = ' ';
      if (kind === '%') s='%';
      else if (kind === '@' && describeObject) {
        const ptr = next();
        s = byteString(utf8.encode(ptr ? describeObject(ptr) : '(null)'));
      } else if (kind === 'n') {
        const at = next(), size = length === 'hh' ? 1 : length === 'h' ? 2 : long ? 8 : 4;
        bits.setBigUint64(0,BigInt(out.length),true); cpu.write(at,new Uint8Array(bits.buffer,0,size)); continue;
      } else if ('sS'.includes(kind)) {
        const addr=next(); s=!addr ? '(null)'.slice(0,precision) : kind==='S'||length==='l' ? wide(cpu,addr,precision) : narrow(cpu,addr,precision);
      } else if ('cC'.includes(kind)) {
        const ch=next(); s=kind==='C'||length==='l' ? byteString(utf8.encode(String.fromCodePoint(ch))) : String.fromCharCode(ch&255);
      } else if ('diuoxXp'.includes(kind)) {
        const signed = kind === 'd' || kind === 'i';
        const radix = 'xXp'.includes(kind) ? 16 : kind === 'o' ? 8 : 10;
        let n=long ? next64() : BigInt(next());
        const size = long ? 64 : length === 'hh' ? 8 : length === 'h' ? 16 : 32;
        n = signed ? BigInt.asIntN(size,n) : BigInt.asUintN(size,n);
        if (n < 0n) { n = -n; prefix='-'; }
        else if (signed) prefix = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        s = n===0n && precision===0 ? '' : n.toString(radix);
        if (precision !== undefined) s=s.padStart(precision,'0');
        else if (flags.includes('0')) pad='0';
        if (kind==='p' || (flags.includes('#') && n && radix===16)) prefix='0x';
        if (flags.includes('#') && radix===8 && !s.startsWith('0')) prefix='0';
        if (kind==='X') { s=s.toUpperCase(); prefix=prefix.toUpperCase(); }
      } else {
        if (kind==='@') throw Error('Objective-C format used without an object description');
        bits.setBigUint64(0,next64(),true);
        let n=bits.getFloat64(0,true);
        prefix=n<0 || Object.is(n,-0) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        n=Math.abs(n);
        const code=kind.toLowerCase(), d=precision??6;
        if (Number.isNaN(n)) s='nan';
        else if (n===Infinity) s='inf';
        else {
          if (flags.includes('0')) pad='0';
          let exponent=0;
          if (code==='a') {
            const raw=bits.getBigUint64(0,true)&0x7fffffffffffffffn;
            const biased=Number(raw>>52n), pwr=biased ? biased-1023 : raw ? -1022 : 0;
            let fract=(raw&0xfffffffffffffn).toString(16).padStart(13,'0');
            let lead=biased ? 1 : 0;
            if (precision!==undefined && d<13) {
              const significand=(BigInt(lead)<<52n)|(raw&0xfffffffffffffn);
              const shift=BigInt((13-d)*4), half=1n<<(shift-1n);
              const keep=significand>>shift, rem=significand-(keep<<shift);
              const rounded=keep+(rem>half || (rem===half&&(keep&1n)) ? 1n : 0n);
              const str=rounded.toString(16).padStart(d+1,'0'); lead=parseInt(str[0],16); fract=str.slice(1);
            } else fract=precision===undefined ? fract.replace(/0+$/,'') : fract.padEnd(d,'0');
            prefix+='0x'; s=lead+(fract||flags.includes('#')?'.'+fract:'')+'p'+(pwr<0?'':'+')+pwr;
          } else {
            let style=code, places=d;
            if (code==='g') {
              const significant=Math.max(1,d);
              exponent=Number(n.toExponential(significant-1).split('e')[1]);
              style=exponent < -4 || exponent >= significant ? 'e' : 'f';
              places=style==='e' ? significant-1 : Math.max(0,significant-exponent-1);
            }
            if (style==='f') s=n.toFixed(places);
            else s=n.toExponential(places);
            let [mantissa,power] = s.split('e');
            if (code==='g' && !flags.includes('#') && mantissa.includes('.')) mantissa=mantissa.replace(/0+$/,'').replace(/\.$/,'');
            if (flags.includes('#') && !mantissa.includes('.')) mantissa+='.';
            s=mantissa+(power===undefined?'':'e'+power[0]+power.slice(1).padStart(2,'0'));
          }
        }
        if (kind===kind.toUpperCase()) { s=s.toUpperCase();prefix=prefix.toUpperCase(); }
      }
      const spaces=Math.max(0,width-s.length-prefix.length);
      out += flags.includes('-') ? prefix+s+' '.repeat(spaces) : pad==='0' ? prefix+'0'.repeat(spaces)+s : ' '.repeat(spaces)+prefix+s;
    }
    return out;
  }

export function formatImports(cpu, heap, errno, files, log) {
  const format = (template, words) => formatDarwin(cpu, template, words);
  function buffer(ptr,size,fmt,words,checked=false) {
    const value=format(fmt,words);
    if (checked && value.length+1>size) throw Error('Guest __sprintf_chk destination is too small');
    if (size) cpu.write(ptr,asciiBytes(value.slice(0,size-1)+'\0'));
    return value.length;
  }
  return {
    _snprintf:a=>buffer(a(0),a(1),a(2),i=>a(3+i)),
    _vsnprintf:a=>buffer(a(0),a(1),a(2),i=>read32(cpu,a(3)+i*4)),
    _sprintf:a=>buffer(a(0),0xffffffff,a(1),i=>a(2+i)),
    ___sprintf_chk:a=>buffer(a(0),a(2),a(3),i=>a(4+i),true),
    _printf:a=>files.writeBytes(1,asciiBytes(format(a(0),i=>a(1+i)))),
    _wprintf:async a=>{
      const fmt=wide(cpu,a(0)),ptr=heap.alloc(fmt.length+1);
      if (!ptr) {write32(cpu,errno,12);return -1;}
      try {
        cpu.write(ptr,asciiBytes(fmt+'\0'));
        const str=new TextDecoder().decode(asciiBytes(format(ptr,i=>a(1+i))));
        const bytes=new TextEncoder().encode(str);return await files.writeBytes(1,bytes)===bytes.length?[...str].length:-1;
      } finally {heap.free(ptr);}
    },
    _fprintf:async a=>{
      const stream=a(0),s=format(a(1),i=>a(2+i));
      if (!s.length) return 0;
      const ptr=heap.alloc(s.length);
      if (!ptr) { write32(cpu,errno,12); return -1; }
      try {
        cpu.write(ptr,asciiBytes(s));
        return await files._fwrite(i=>[ptr,1,s.length,stream][i]) === s.length ? s.length : -1;
      } finally { heap.free(ptr); }
    }
  };
}
