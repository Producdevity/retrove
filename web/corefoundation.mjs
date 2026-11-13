// CF collection callbacks are optional. Raw pointer collections must never send
// Objective-C messages to their elements. The collection itself is toll-free bridged.
const utf8 = new TextEncoder();
function encoded(str, encoding) {
  if (encoding === 0x08000100) return utf8.encode(str);
  if (encoding === 0x0600 || encoding === 0x0201) {
    const bytes = Array.from(str, c => c.codePointAt(0));
    return bytes.some(n => n > (encoding === 0x0600 ? 127 : 255)) ? null : Uint8Array.from(bytes);
  }
  if ([0x100, 0x10000100, 0x14000100].includes(encoding)) {
    const bytes = new Uint8Array(str.length * 2), view = new DataView(bytes.buffer);
    for (let i=0; i<str.length; i++) view.setUint16(i*2,str.charCodeAt(i),encoding !== 0x10000100);
    return bytes;
  }
  return null;
}

export function coreFoundation({cpu,heap,read,write,zero,names,alloc,hostClass,method,destroy,send,callGuest,hostGate,
  retain,release,text,makeString,makeUTF16,foundation,items,getRunLoop,threads}) {
  const collections = new Map(), constants = new Map(), loops = new Map();
  hostClass('CFMutableArray','NSMutableArray');
  hostClass('CFMutableDictionary','NSMutableDictionary');
  hostClass('CFUUID','NSObject',20);
  hostClass('NSMutableString','NSString',16);
  const callbacks = {
    retain: a=>retain(a(1)), release: a=>release(a(1)), description: a=>makeString(foundation.description(a(0))),
    equal: a=>send(a(0),'isEqual:',[a(1)]), hash: a=>send(a(0),'hash')
  };
  function resolveData(name) {
    if (constants.has(name)) return constants.get(name);
    let ptr;
    if (name === '_kCFNumberNaN') { ptr=zero(4); write(ptr,retain(foundation.number(NaN))); }
    else if (['_kCFTypeDictionaryKeyCallBacks','_kCFTypeDictionaryValueCallBacks','_kCFTypeArrayCallBacks'].includes(name)) {
      const ops = Object.keys(callbacks).slice(0,name.includes('KeyCall') ? 5 : 4);
      ptr=zero(4*(ops.length+1));
      for (const [i,op] of ops.entries()) write(ptr+4*(i+1),hostGate({name:'CFType.'+op},callbacks[op]));
    } else return null;
    constants.set(name,ptr); return ptr;
  }
  function collection(cls, a, isDict) {
    if(a(0)) throw Error('Custom CF collection allocator is unsupported');
    const capture=ptr=>ptr?Array.from({length:4},(_,i)=>read(ptr+(i+1)*4)):[];
    const ptr=alloc(names.get(cls));
    collections.set(ptr,{keys:capture(a(2)),values:isDict?capture(a(3)):[],list:[]});
    return ptr;
  }
  async function acquire(fn,value) {return fn?await callGuest(fn,[0,value]):value;}
  async function drop(fn,value) {if(fn)await callGuest(fn,[0,value]);}
  async function index(ptr,list,start,count,value,dict=false) {
    if (start<0 || count<0 || start+count>list.length) throw Error('CFRange outside collection');
    const state=collections.get(ptr);
    for(let i=start;i<start+count;i++){
      const key=dict?list[i][0]:list[i];
      if(key===value || (state ? state.keys[3] && await callGuest(state.keys[3],[key,value]) : await send(key,'isEqual:',[value])))return i;
    }
    return -1;
  }
  function at(list,i){if(i<0||i>=list.length)throw Error('CFArray index outside collection');return list[i];}
  async function removeArray(ptr,i) {
    const state=collections.get(ptr);
    if(!state)return send(ptr,'removeObjectAtIndex:',[i]);
    const old=at(state.list,i);state.list.splice(i,1);await drop(state.keys[1],old);
  }
  async function appendArray(ptr,value) {
    const state=collections.get(ptr);
    if(!state)return send(ptr,'addObject:',[value]);
    state.list.push(await acquire(state.keys[0],value));
  }
  async function changeDict(ptr,key,val,replace=false) {
    const state=collections.get(ptr);
    if(!state){if(!val||replace||!foundation.get(ptr,key))await foundation.associated(ptr,key,val);return;}
    const i=await index(ptr,state.list,0,state.list.length,key,true);
    if(i>=0) {
      if(val&&!replace)return;
      const [k,v]=state.list[i];
      if(val)state.list[i][1]=await acquire(state.values[0],val);
      else {state.list.splice(i,1);await drop(state.keys[1],k);}
      await drop(state.values[1],v);
    } else if(val)state.list.push([await acquire(state.keys[0],key),await acquire(state.values[0],val)]);
  }
  async function dictValue(ptr,key) {
    const state=collections.get(ptr);
    return state?state.list[await index(ptr,state.list,0,state.list.length,key,true)]?.[1]??0:foundation.get(ptr,key);
  }
  for(const [cls,dict] of [['CFMutableArray',false],['CFMutableDictionary',true]]){
    method(cls,false,'count',p=>collections.get(p).list.length);
    method(cls,false,'dealloc',async p=>{
      const s=collections.get(p); collections.delete(p);
      for(const item of s.list){
        await drop(s.keys[1],dict?item[0]:item); if(dict)await drop(s.values[1],item[1]);
      }
      destroy(p);
    });
  }
  method('CFMutableArray',false,'objectAtIndex:',(p,a)=>at(collections.get(p).list,a(0)));
  method('CFMutableArray',false,'addObject:',(p,a)=>appendArray(p,a(0)));
  method('CFMutableArray',false,'removeObjectAtIndex:',(p,a)=>removeArray(p,a(0)));
  method('CFMutableDictionary',false,'objectForKey:',(p,a)=>dictValue(p,a(0)));
  method('CFMutableDictionary',false,'setObject:forKey:',(p,a)=>changeDict(p,a(1),a(0),true));
  method('CFMutableDictionary',false,'removeObjectForKey:',(p,a)=>changeDict(p,a(0),0));
  function array(p){return collections.get(p)?.list??items(p);}
  function numberValue(a){
    const type=a(1), out=a(2);
    const value=foundation.unbox(a(0)), num=Number(value);
    const spec={1:[1,'Int8'],2:[2,'Int16'],3:[4,'Int32'],4:[8,'BigInt64'],5:[4,'Float32'],6:[8,'Float64'],
      7:[1,'Int8'],8:[2,'Int16'],9:[4,'Int32'],10:[4,'Int32'],11:[8,'BigInt64'],12:[4,'Float32'],13:[8,'Float64'],
      14:[4,'Int32'],15:[4,'Int32'],16:[4,'Float32']}[type];
    if(!spec||!out)return 0;
    const [size,kind]=spec, bytes=new Uint8Array(size), v=new DataView(bytes.buffer);
    if(kind==='BigInt64'&&!Number.isFinite(num))return 0;
    v['set'+kind](0,kind==='BigInt64'?BigInt(Math.trunc(num)):num,true);cpu.write(out,bytes);
    const actual=Number(v['get'+kind](0,true));return Number(actual===num || Number.isNaN(actual)&&Number.isNaN(num));
  }
  const rangeIndex=a=>index(a(0),array(a(0)),a(1)|0,a(2)|0,a(3));
  const funcs={
    _CFArrayCreateMutable:a=>collection('CFMutableArray',a,false),
    _CFArrayGetCount:a=>array(a(0)).length, _CFArrayGetValueAtIndex:a=>at(array(a(0)),a(1)),
    _CFArrayAppendValue:a=>appendArray(a(0),a(1)), _CFArrayRemoveValueAtIndex:a=>removeArray(a(0),a(1)),
    _CFArrayGetFirstIndexOfValue:rangeIndex, _CFArrayContainsValue:async a=>Number(await rangeIndex(a)>=0),
    _CFDictionaryCreateMutable:a=>collection('CFMutableDictionary',a,true),
    _CFDictionaryGetValue:a=>dictValue(a(0),a(1)), _CFDictionaryRemoveValue:a=>changeDict(a(0),a(1),0),
    _CFDictionaryAddValue:a=>changeDict(a(0),a(1),a(2)), _CFNumberGetValue:numberValue,
    _CFMakeCollectable:a=>a(0),
    _CFRunLoopGetCurrent:()=>getRunLoop(),
    _CFStringCreateWithCharacters:a=>a(0)?0:makeUTF16(cpu.read(a(1),a(2)*2)),
    _CFStringAppendCharacters:a=>{
      const p=a(0), count=a(2)*2, old=encoded(text(p),0x14000100);
      const bytes=new Uint8Array(old.length+count); bytes.set(old);bytes.set(cpu.read(a(1),count),old.length);makeUTF16(bytes,p);
    },
    _CFStringGetCharactersPtr:a=>(read(a(0)+4)&16)?read(a(0)+8):0,
    _CFStringGetCString:a=>{
      const b=encoded(text(a(0)),a(3)),n=a(2)|0;
      if(!a(1)||!b||n<=b.length)return 0;
      cpu.write(a(1),b);cpu.write(a(1)+b.length,new Uint8Array(1));return 1;
    },
    _CFURLCreateStringByAddingPercentEscapes:a=>{
      if(a(0)||!a(1))return 0;
      const leave=a(2)?text(a(2)):'', escape=a(3)?text(a(3)):'', source=text(a(1)), encoding=a(4);
      let result='';
      for(const ch of source) {
        if(leave.includes(ch)||(!escape.includes(ch)&&/^[A-Za-z0-9;/?:@&=+$,_.!~*'()#-]$/.test(ch))){result+=ch;continue;}
        const b=encoded(ch,encoding);if(!b)return 0;
        for(const v of b)result+='%'+v.toString(16).padStart(2,'0').toUpperCase();
      }
      return makeString(result);
    },
    _CFUUIDCreate:a=>{
      if(a(0))return 0;
      const p=alloc(names.get('CFUUID')), b=crypto.getRandomValues(new Uint8Array(16));
      b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;cpu.write(p+4,b);return p;
    },
    _CFUUIDCreateString:a=>{
      if(a(0)||!a(1))return 0;
      const v=Array.from(cpu.read(a(1)+4,16),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
      return makeString([v.slice(0,8),v.slice(8,12),v.slice(12,16),v.slice(16,20),v.slice(20)].join('-'));
    }
  };
  return {funcs,resolveData};
}
