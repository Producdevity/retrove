import {installCollectionInitializers} from "../src/runtime/ios/foundation/collections.ts";
import {installURLCache} from "../src/runtime/ios/foundation/url-cache/bindings.ts";
import {installDictionaryArrays} from "../src/runtime/ios/foundation/dictionaries.ts";
import {installArrayCopies} from "../src/runtime/ios/foundation/arrays.ts";
import {installDates} from "../src/runtime/ios/foundation/dates.ts";
import {installNumbers} from "../src/runtime/ios/foundation/numbers.ts";
import {installDeviceIdentity} from "../src/runtime/ios/uikit/device-identity.ts";
import {FastEnumeration} from "../src/runtime/ios/foundation/fast-enumeration.ts";
// Foundation objects shared by the guest's UIKit bootstrap and property lists.
import {installUserDefaults} from '../src/runtime/ios/foundation/user-defaults.ts';
import {installValues} from '../src/runtime/ios/foundation/values.ts';
import {installUrlPaths,installStringPaths} from '../src/runtime/ios/foundation/paths.ts';
import {formatDarwin} from './format.mjs';
import {readString} from './memory.mjs';

export function foundation({cpu, heap, hostClass, method, names, alloc, destroy, autorelease, retain, release,
  read, write, string, text, utf8, send, lookup, selector, array, items, threads, sys, ipa, isKind, getDispatch, callBlock, dataFrom}) {
  const dicts = new Map(), numbers = new Map();
  const enumeration=new FastEnumeration({read,write,allocate:bytes=>heap.zero(bytes),free:pointer=>heap.free(pointer)});
  const bits = new DataView(new ArrayBuffer(8));
  const singleton = name => {
    let value = 0;
    return () => value ||= alloc(names.get(name));
  };
  const associated = (s, key, value) => {
    let dict = dicts.get(s);
    if (!dict) dicts.set(s, dict = new Map());
    const k = isKind(key, 'NSString') ? text(key) : key;
    const prev = dict.get(k);
    if(value||prev)enumeration.changed(s);
    if (!value) { dict.delete(k); } else dict.set(k, [retain(key), retain(value)]);
    if (prev) return (async()=>{await release(prev[0]);await release(prev[1]);})();
  };
  const get = (s,k) => dicts.get(s)?.get(isKind(k,'NSString') ? text(k) : k)?.[1] ?? 0;
  function dictionary(cls, pairs) {
    const ptr=alloc(cls);
    for (const [key, value] of pairs) if (key && value) associated(ptr,key,value);
    return ptr;
  }
  installArrayCopies({method,autorelease,items,array});
  installStringPaths({method,string,text});
  installValues({hostClass,method,alloc,destroy,autorelease,retain,release,text,string,write,cString:value=>heap.string(value)});
  hostClass('NSNumber','NSValue');
  function number(value) {
    const n=alloc(names.get('NSNumber')); numbers.set(n,value); return autorelease(n);
  }
  installNumbers({method,alloc,autorelease,get:p=>numbers.get(p)??0,set:(p,value)=>{numbers.set(p,value);}});
  const numberText=s=>{const value=numbers.get(s);return String(typeof value==='boolean'?Number(value):value);};
  for(const selector of ['stringValue','description'])method('NSNumber',false,selector,s=>string(numberText(s)));
  method('NSNumber',false,'copy',retain);
  method('NSNumber',false,'dealloc',s=>{numbers.delete(s);destroy(s);});
  hostClass('NSDictionary','NSObject'); hostClass('NSMutableDictionary','NSDictionary');
  installCollectionInitializers({method});
  installDictionaryArrays({method,autorelease,release,items,dictionary,copyKey:p=>send(p,'copy')});
  method('NSDictionary',true,'dictionary',cls=>autorelease(dictionary(cls,[])));
  method('NSMutableDictionary',true,'dictionaryWithCapacity:',cls=>autorelease(dictionary(cls,[])));
  method('NSDictionary',true,'dictionaryWithObject:forKey:',(cls,a)=>autorelease(dictionary(cls,[[a(1),a(0)]])));
  method('NSDictionary',true,'dictionaryWithObjects:forKeys:count:',(cls,a)=>{
    const pairs=Array.from({length:a(2)},(_,i)=>[read(a(1)+i*4),read(a(0)+i*4)]);
    return autorelease(dictionary(cls,pairs));
  });
  method('NSDictionary',true,'dictionaryWithObjectsAndKeys:',(cls,a)=>{
    const pairs=[]; for(let i=0;a(i);i+=2)pairs.push([a(i+1),a(i)]);
    return autorelease(dictionary(cls,pairs));
  });
  method('NSDictionary',false,'initWithDictionary:',(s,a)=>{
    for(const [k,v] of dicts.get(a(0))?.values()??[])associated(s,k,v);return s;
  });
  method('NSMutableDictionary',false,'addEntriesFromDictionary:',async(s,a)=>{
    for(const [k,v] of [...(dicts.get(a(0))?.values()??[])])await associated(s,k,v);
  });
  method('NSMutableDictionary',false,'removeAllObjects',async s=>{
    for(const [k] of [...(dicts.get(s)?.values()??[])])await associated(s,k,0);
  });
  method('NSDictionary',true,'dictionaryWithDictionary:',(cls,a)=>autorelease(dictionary(cls,dicts.get(a(0))?.values()??[])));
  for(const name of ['objectForKey:','objectForKeyedSubscript:','valueForKey:']) method('NSDictionary',false,name,(s,a)=>get(s,a(0)));
  method('NSDictionary',false,'objectsForKeys:notFoundMarker:',(s,a)=>{
    const keys=items(a(0))??[],marker=a(1);return autorelease(array(keys.map(k=>get(s,k)||marker)));
  });
  method('NSDictionary',false,'allValues',s=>autorelease(array(Array.from(dicts.get(s)?.values()??[],pair=>pair[1]))));
  method('NSDictionary',false,'allKeys',s=>autorelease(array(Array.from(dicts.get(s)?.values()??[],p=>p[0]))));
  method('NSDictionary',false,'count',s=>dicts.get(s)?.size??0);
  method('NSDictionary',false,'countByEnumeratingWithState:objects:count:',(s,a)=>enumeration.read(s,a(0),a(1),a(2),Array.from(dicts.get(s)?.values()??[],pair=>pair[0])));
  method('NSDictionary',false,'copy',s=>dictionary(names.get('NSDictionary'),dicts.get(s)?.values()??[]));
  method('NSDictionary',false,'mutableCopy',s=>dictionary(names.get('NSMutableDictionary'),dicts.get(s)?.values()??[]));
  for(const name of ['setObject:forKey:','setObject:forKeyedSubscript:','setValue:forKey:']) method('NSMutableDictionary',false,name,(s,a)=>associated(s,a(1),a(0)));
  method('NSMutableDictionary',false,'removeObjectForKey:',(s,a)=>associated(s,a(0),0));
  method('NSDictionary',false,'dealloc',async s=>{
    const entries=dicts.get(s); dicts.delete(s);enumeration.destroy(s);
    for(const [k,v] of entries?.values()??[]) {await release(k);await release(v);}
    destroy(s);
  });
  function property(value) {
    if (value == null) return 0;
    if (value instanceof Date) return date(value.getTime()/1000);
    if (typeof value==='string') return string(value);
    if (typeof value==='number'||typeof value==='boolean'||typeof value==='bigint') return number(value);
    if (Array.isArray(value)) return autorelease(array(value.map(property)));
    return autorelease(dictionary(names.get('NSDictionary'),Object.entries(value).map(([k,v])=>[string(k),property(v)])));
  }
  method('NSBundle',false,'infoDictionary',()=>property(ipa.info));
  method('NSBundle',false,'objectForInfoDictionaryKey:',(_,a)=>property(ipa.info[text(a(0))]));
  hostClass('NSEnumerator','NSObject');
  const enumerators=new Map();
  function enumerate(list) {
    const ptr=alloc(names.get('NSEnumerator'));enumerators.set(ptr,{at:0,list:list.map(retain)});
    return autorelease(ptr);
  }
  method('NSEnumerator',false,'nextObject',s=>{const e=enumerators.get(s);return e.list[e.at++]??0;});
  method('NSEnumerator',false,'dealloc',async s=>{
    const e=enumerators.get(s);enumerators.delete(s);for(const v of e.list)await release(v);destroy(s);
  });
  method('NSDictionary',false,'keyEnumerator',s=>enumerate(Array.from(dicts.get(s)?.values()??[],p=>p[0])));
  method('NSDictionary',false,'objectEnumerator',s=>enumerate(Array.from(dicts.get(s)?.values()??[],p=>p[1])));
  async function sorted(list,sel) {
    let result=[...list],next=new Array(result.length);
    for(let width=1;width<result.length;width*=2){
      for(let start=0;start<result.length;start+=2*width){
        const middle=Math.min(start+width,result.length),end=Math.min(start+2*width,result.length);
        let l=start,r=middle;
        for(let out=start;out<end;out++){
          if(l<middle&&(r>=end||((await send(result[l],sel,[result[r]]))|0)<=0))next[out]=result[l++];
          else next[out]=result[r++];
        }
      }
      [next,result]=[result,next];
    }
    return result;
  }
  method('NSArray',false,'sortedArrayUsingSelector:',async(s,a)=>autorelease(array(await sorted(items(s),readString(cpu,a(0))))));
  method('NSArray',false,'componentsJoinedByString:',(s,a)=>string(items(s).map(description).join(text(a(0)))));
  method('NSArray',false,'objectEnumerator',s=>enumerate(items(s)??[]));
  method('NSArray',false,'reverseObjectEnumerator',s=>enumerate([...(items(s)??[])].reverse()));
  hostClass('NSNull','NSObject');
  method('NSNull',true,'null',singleton('NSNull'));
  method('NSNull',false,'copy',retain);
  method('NSNull',false,'description',()=>string('<null>'));
  hostClass('NSJSONSerialization','NSObject');
  const validJSON=s=>{try{return isKind(s,'NSArray')||isKind(s,'NSDictionary')?JSON.stringify(unbox(s))!==undefined:false;}catch{return false;}};
  method('NSJSONSerialization',true,'isValidJSONObject:',(_,a)=>Number(validJSON(a(0))));
  method('NSJSONSerialization',true,'dataWithJSONObject:options:error:',(_,a)=>{
    const source=a(0),options=a(1),out=a(2);
    if(!validJSON(source)){
      if(out){const e=alloc(names.get('NSError'));write(e+4,3840);write(e+8,retain(string('NSCocoaErrorDomain')));write(out,autorelease(e));}
      return 0;
    }
    const data=new TextEncoder().encode(JSON.stringify(unbox(source),null,options&1?2:0)),p=heap.alloc(data.length);
    try{cpu.write(p,data);return autorelease(dataFrom(p,data.length));}finally{heap.free(p);}
  });
  hostClass('NSLocale','NSObject');
  const languages=()=>[...(globalThis.navigator?.languages??['en-US'])];
  method('NSLocale',true,'preferredLanguages',()=>autorelease(array(languages().map(string))));
  method('NSLocale',true,'currentLocale',singleton('NSLocale'));
  method('NSLocale',false,'localeIdentifier',()=>string(languages()[0].replaceAll('-','_')));
  function unbox(ptr) {
    if (!ptr || isKind(ptr,'NSNull')) return null;
    if (isKind(ptr,'NSString')) return text(ptr);
    if (numbers.has(ptr)) {
      const value=numbers.get(ptr);return typeof value==='bigint'?Number(value):value;
    }
    if (isKind(ptr,'NSArray')) return (items(ptr)??[]).map(unbox);
    if (isKind(ptr,'NSDictionary')) return Object.fromEntries(Array.from(dicts.get(ptr)?.values()??[],([k,v])=>[text(k),unbox(v)]));
    throw Error('Expected a Foundation property-list value');
  }
  function description(s) {
    if(numbers.has(s))return numberText(s);
    if(isKind(s,'NSString'))return text(s);
    if(isKind(s,'NSURL')) return urls.get(s)?.href??'';
    if(isKind(s,'NSDictionary')||isKind(s,'NSArray'))return JSON.stringify(unbox(s));
    return '<NSObject: 0x'+s.toString(16)+'>';
  }
  function formatted(template,word) {
    const bytes=formatDarwin(cpu, utf8(template),word,description);
    return new TextDecoder().decode(Uint8Array.from(bytes,c=>c.charCodeAt(0)));
  }
  method('NSString',true,'stringWithFormat:',(_,a)=>string(formatted(a(0),i=>a(i+1))));
  method('NSString',false,'stringByAppendingFormat:',(s,a)=>string(text(s)+formatted(a(0),i=>a(i+1))));
  const components = value => value.split('/').filter(Boolean);
  method('NSString',false,'lastPathComponent',s=>string(components(text(s)).at(-1)??'/'));
  method('NSString',false,'stringByDeletingLastPathComponent',s=>{
    const path=text(s).replace(/\/+$/,'');const at=path.lastIndexOf('/');
    return string(at===0?'/':at<0?'':path.slice(0,at));
  });
  method('NSString',false,'componentsSeparatedByString:',(s,a)=>autorelease(array(text(s).split(text(a(0))).map(string))));
  for(const [name,convert] of [['intValue',v=>parseInt(v,10)|0],['integerValue',v=>parseInt(v,10)|0],['boolValue',v=>Number(/^[yYtT1-9]/.test(v.trim()))],
    ['floatValue',v=>{bits.setFloat32(0,parseFloat(v)||0,true);return bits.getUint32(0,true);}],
    ['doubleValue',v=>{bits.setFloat64(0,parseFloat(v)||0,true);return bits.getBigUint64(0,true);}]])
    method('NSString',false,name,s=>convert(text(s)));
  function encoded(s,encoding) {
    const value=text(s);
    if(encoding===4 || encoding===1 && /^[\x00-\x7f]*$/.test(value))return new TextEncoder().encode(value);
    if(encoding===5 && [...value].every(c=>c.charCodeAt(0)<=255))return Uint8Array.from(value,c=>c.charCodeAt(0));
    if([10,0x90000100,0x94000100].includes(encoding)){
      const bytes=new DataView(new ArrayBuffer(value.length*2));for(let i=0;i<value.length;i++)bytes.setUint16(i*2,value.charCodeAt(i),encoding!==0x90000100);
      return new Uint8Array(bytes.buffer);
    }
    return null;
  }
  method('NSString',false,'cStringUsingEncoding:',(s,a)=>a(0)===4||a(0)===1&&encoded(s,1)?utf8(s):0);
  method('NSString',false,'getCString:maxLength:encoding:',(s,a)=>{
    const bytes=encoded(s,a(2)),terminator=a(2)===10||a(2)>=0x90000000?2:1;
    if(!a(0)||!bytes||bytes.length+terminator>a(1))return 0;
    cpu.write(a(0),bytes);cpu.write(a(0)+bytes.length,new Uint8Array(terminator));return 1;
  });
  method('NSString',false,'lengthOfBytesUsingEncoding:',(s,a)=>encoded(s,a(0))?.length??0);
  method('NSString',false,'compare:',(s,a)=>Math.sign(text(s).localeCompare(text(a(0)))));
  method('NSString',false,'compare:options:',(s,a)=>{
    const flags=a(1),sensitivity=flags&1?(flags&128?'base':'accent'):(flags&128?'case':'variant');
    return Math.sign(text(s).localeCompare(text(a(0)),undefined,{numeric:Boolean(flags&64),sensitivity}));
  });
  for(const [sel,options] of [['rangeOfString:',false],['rangeOfString:options:',true]]){
    const range=(s,a,dest)=>{
      let hay=text(s),needle=text(a(0));const flags=options?a(1):0;
      if(flags&1){hay=hay.toLowerCase();needle=needle.toLowerCase();}
      let at=flags&4?hay.lastIndexOf(needle):hay.indexOf(needle);
      if(flags&8 && at!==(flags&4?hay.length-needle.length:0))at=-1;
      write(dest,at<0?0x7fffffff:at);write(dest+4,at<0?0:needle.length);
    };
    range.stret=true;method('NSString',false,sel,range);
  }
  method('NSString',false,'characterAtIndex:',(s,a)=>{
    const v=text(s),i=a(0);if(i>=v.length)throw Error('NSString index outside bounds');return v.charCodeAt(i);
  });
  method('NSString',false,'substringFromIndex:',(s,a)=>string(text(s).slice(a(0))));
  method('NSString',false,'substringToIndex:',(s,a)=>string(text(s).slice(0,a(0))));
  method('NSString',false,'substringWithRange:',(s,a)=>string(text(s).slice(a(0),a(0)+a(1))));
  method('NSString',false,'uppercaseString',s=>string(text(s).toUpperCase()));
  method('NSString',false,'lowercaseString',s=>string(text(s).toLowerCase()));
  method('NSString',false,'caseInsensitiveCompare:',(s,a)=>Math.sign(text(s).toLowerCase().localeCompare(text(a(0)).toLowerCase())));
  const dates=installDates({hostClass,method,alloc,destroy,retain,autorelease,isDate:p=>isKind(p,'NSDate')});
  function date(t){return dates.create(t);}
  hostClass('NSTimeZone','NSObject');
  const localTimeZone=singleton('NSTimeZone');
  for(const selector of ['systemTimeZone','defaultTimeZone','localTimeZone'])method('NSTimeZone',true,selector,localTimeZone);
  method('NSTimeZone',false,'name',()=>string(Intl.DateTimeFormat().resolvedOptions().timeZone));
  method('NSTimeZone',false,'secondsFromGMT',()=>new Date().getTimezoneOffset()*-60);
  hostClass('UIPasteboard','NSObject');
  const boardsByName=new Map(), boards=new Map();
  function pasteboard(name,create) {
    if(boardsByName.has(name))return boardsByName.get(name);
    const key='bioshock.pasteboard.'+ipa.info.CFBundleIdentifier+'.'+name;
    let value=null;try{value=globalThis.localStorage?.getItem(key);}catch{}
    if(value==null&&!create)return 0;
    const p=alloc(names.get('UIPasteboard'));boards.set(p,{key,value,persistent:value!=null});boardsByName.set(name,p);return p;
  }
  method('UIPasteboard',true,'pasteboardWithName:create:',(_,a)=>a(0)?pasteboard(text(a(0)),!!a(1)):0);
  method('UIPasteboard',false,'string',s=>{const v=boards.get(s).value;return v==null?0:string(v);});
  method('UIPasteboard',false,'setString:',(s,a)=>{const b=boards.get(s);b.value=a(0)?text(a(0)):null;
    if(b.persistent){if(b.value==null)globalThis.localStorage?.removeItem(b.key);else globalThis.localStorage?.setItem(b.key,b.value);}
  });
  method('UIPasteboard',false,'setPersistent:',(s,a)=>{const b=boards.get(s);b.persistent=!!a(0);
    if(b.persistent&&b.value!=null)globalThis.localStorage?.setItem(b.key,b.value);else globalThis.localStorage?.removeItem(b.key);
  });
  const preferenceIdentifier=ipa.info.CFBundleIdentifier??ipa.bundlePath;
  const preferenceDomain='bioshock.preferences.'+preferenceIdentifier;
  installUserDefaults({hostClass,method,text,string,singleton,property,unbox,identifier:preferenceIdentifier,
    globals:{AppleLanguages:languages(),AppleLocale:languages()[0].replaceAll('-','_')},
    storage:{
      read:()=>{try{return JSON.parse(globalThis.localStorage?.getItem(preferenceDomain)??'{}');}catch{return {}; }},
      write:values=>{try{if(!globalThis.localStorage)return false;globalThis.localStorage.setItem(preferenceDomain,JSON.stringify(values));return true;}catch{return false;}}
    }
  });
  hostClass('NSProcessInfo','NSObject');
  method('NSProcessInfo',true,'processInfo',singleton('NSProcessInfo'));
  method('NSProcessInfo',false,'physicalMemory',()=>1n<<30n);
  for(const name of ['processorCount','activeProcessorCount'])method('NSProcessInfo',false,name,()=>1);
  method('NSProcessInfo',false,'systemUptime',()=>{bits.setFloat64(0,performance.now()/1000,true);return bits.getBigUint64(0,true);});
  method('NSProcessInfo',false,'environment',()=>property({}));
  hostClass('NSURL','NSObject');
  const urls=new Map();
  installUrlPaths({method,string,urls});
  function url(value,cls=names.get('NSURL')) {
    const ptr=alloc(cls);urls.set(ptr,value);return autorelease(ptr);
  }
  function fileURL(path) {
    const absolute = path.startsWith('/')?path:'/'+ipa.bundlePath+'/'+path;
    const u=new URL('file:///');u.pathname=absolute;return u;
  }
  method('NSURL',true,'fileURLWithPath:',(cls,a)=>url(fileURL(text(a(0))),cls));
  method('NSURL',true,'fileURLWithPath:isDirectory:',(cls,a)=>url(fileURL(text(a(0))+(a(1)?'/':'')),cls));
  method('NSURL',true,'URLWithString:',(cls,a)=>{try{return url(new URL(text(a(0))),cls);}catch{return 0;}});
  method('NSURL',false,'isFileURL',s=>Number(urls.get(s)?.protocol==='file:'));
  for(const [name,key] of [['host','hostname'],['scheme','protocol'],['query','search'],['fragment','hash'],['user','username']])
    method('NSURL',false,name,s=>{
      const val=urls.get(s)[key];
      return val?string(name==='scheme'?val.slice(0,-1):name==='query'||name==='fragment'?val.slice(1):val):0;
    });
  method('NSURL',false,'port',s=>urls.get(s).port?number(Number(urls.get(s).port)):0);
  method('NSURL',false,'absoluteString',s=>string(urls.get(s).href));
  method('NSURL',false,'path',s=>string(decodeURIComponent(urls.get(s).pathname)));
  method('NSURL',false,'fileSystemRepresentation',s=>utf8(string(decodeURIComponent(urls.get(s).pathname))));
  method('NSURL',false,'URLByAppendingPathComponent:',(s,a)=>{
    const u=new URL(urls.get(s));u.pathname=u.pathname.replace(/\/$/,'')+'/'+text(a(0)).replace(/^\/+/,'');return url(u);
  });
  method('NSURL',false,'copy',retain);method('NSURL',false,'copyWithZone:',retain);
  method('NSURL',false,'dealloc',s=>{urls.delete(s);destroy(s);});
  method('NSBundle',false,'bundleURL',()=>url(fileURL('/'+ipa.bundlePath)));
  method('NSBundle',false,'resourceURL',()=>url(fileURL('/'+ipa.bundlePath)));
  method('NSBundle',false,'URLForResource:withExtension:',async (s,a)=>{
    const path=await send(s,'pathForResource:ofType:',[a(0),a(1)]);return path?url(fileURL(text(path))):0;
  });
  hostClass('NSUUID','NSObject');
  const uuids=new Map();
  function newUUID(value) {
    const p=alloc(names.get('NSUUID'));uuids.set(p,(value??crypto.randomUUID()).toUpperCase());return p;
  }
  const uuidString=p=>uuids.get(p);
  method('NSUUID',true,'UUID',()=>autorelease(newUUID()));
  method('NSUUID',false,'UUIDString',p=>string(uuidString(p)));
  method('NSUUID',false,'copy',retain);
  method('NSUUID',false,'dealloc',p=>{uuids.delete(p);destroy(p);});
  hostClass('ASIdentifierManager','NSObject');
  let noAdId;
  method('ASIdentifierManager',true,'sharedManager',singleton('ASIdentifierManager'));
  method('ASIdentifierManager',false,'isAdvertisingTrackingEnabled',()=>0);
  method('ASIdentifierManager',false,'advertisingTrackingEnabled',()=>0);
  method('ASIdentifierManager',false,'advertisingIdentifier',()=>noAdId??=newUUID('00000000-0000-0000-0000-000000000000'));
  hostClass('UIWebView','UIView');
  const webDelegates=new Map();
  method('UIWebView',false,'setDelegate:',(s,a)=>{webDelegates.set(s,a(0));});
  method('UIWebView',false,'delegate',s=>webDelegates.get(s)??0);
  const webLoads=new Map();
  method('UIWebView',false,'request',s=>webLoads.get(s)?.req??0);
  method('UIWebView',false,'stopLoading',s=>{const l=webLoads.get(s);if(l)l.cancelled=true;});
  method('UIWebView',false,'isLoading',s=>Number(!!webLoads.get(s)?.loading));
  method('UIWebView',false,'loadRequest:',(s,a)=>{
    const req=a(0),previous=webLoads.get(s);
    if(previous)previous.cancelled=true;
    const item={req:retain(req),loading:true};webLoads.set(s,item);
    mainRequests.push(async()=>{
      if(item.cancelled)return;
      const d=webDelegates.get(s),u=urls.get(requests.get(req));
      if(d&&lookup(read(d),'webView:shouldStartLoadWithRequest:navigationType:')&&
          !await send(d,'webView:shouldStartLoadWithRequest:navigationType:',[s,req,5])){item.loading=false;return;}
      await send(d,'webViewDidStartLoad:',[s],true);
      item.loading=false;
      if(!u||u.href==='about:blank') await send(d,'webViewDidFinishLoad:',[s],true);
      else{
        const e=offlineError();
        try{await send(d,'webView:didFailLoadWithError:',[s,e],true);}finally{await release(e);}
      }
    });
  });
  method('UIWebView',false,'stringByEvaluatingJavaScriptFromString:',(_,a)=>{
    const expression=text(a(0)).trim().replace(/;$/,'').replace(/^window\./,'');
    if(expression==='navigator.userAgent')return string(globalThis.navigator?.userAgent??'');
    if(expression==='navigator.language')return string(languages()[0]);
    throw Error('Unsupported guest UIWebView expression: '+expression.slice(0,96));
  });
  hostClass('NSOperationQueue','NSObject');
  const mainQueue=singleton('NSOperationQueue');
  method('NSOperationQueue',true,'mainQueue',mainQueue);
  const queues=new Map();
  method('NSOperationQueue',false,'setMaxConcurrentOperationCount:',(s,a)=>{queues.set(s,a(0)|0);});
  method('NSOperationQueue',false,'maxConcurrentOperationCount',s=>queues.get(s)??-1);
  hostClass('NSURLRequest','NSObject');hostClass('NSMutableURLRequest','NSURLRequest');
  const requests=new Map();
  async function setRequestURL(s,p){const old=requests.get(s);requests.set(s,retain(p));if(old)await release(old);}
  for(const sel of ['requestWithURL:','requestWithURL:cachePolicy:timeoutInterval:']) method('NSURLRequest',true,sel,async(cls,a)=>{
    const s=alloc(cls);await setRequestURL(s,a(0));return autorelease(s);
  });
  for(const sel of ['initWithURL:','initWithURL:cachePolicy:timeoutInterval:'])method('NSURLRequest',false,sel,async(s,a)=>{await setRequestURL(s,a(0));return s;});
  method('NSMutableURLRequest',false,'setURL:',(s,a)=>setRequestURL(s,a(0)));
  method('NSURLRequest',false,'URL',s=>requests.get(s)??0);
  method('NSURLRequest',false,'dealloc',async s=>{
    const props=requestProperties.get(s),u=requests.get(s);
    headers.delete(s);requests.delete(s);requestProperties.delete(s);
    for(const ptr of Object.values(props??{}))await release(ptr);
    if(u)await release(u);destroy(s);
  });
  const requestProperties=new Map(), headers=new Map();
  method('NSMutableURLRequest',false,'setValue:forHTTPHeaderField:',(s,a)=>{
    const key=text(a(1)).toLowerCase();let map=headers.get(s);if(!map)headers.set(s,map=new Map());
    if(a(0))map.set(key,text(a(0)));else map.delete(key);
  });
  method('NSURLRequest',false,'valueForHTTPHeaderField:',(s,a)=>{const v=headers.get(s)?.get(text(a(0)).toLowerCase());return v==null?0:string(v);});
  method('NSURLRequest',false,'allHTTPHeaderFields',s=>property(Object.fromEntries(headers.get(s)??[])));
  for(const [getter,setter] of [['HTTPBody','setHTTPBody:'],['HTTPMethod','setHTTPMethod:']]){
    method('NSURLRequest',false,getter,s=>requestProperties.get(s)?.[getter]??(getter==='HTTPMethod'?string('GET'):0));
    method('NSMutableURLRequest',false,setter,async(s,a)=>{
      const props=requestProperties.get(s)??{};requestProperties.set(s,props);
      const old=props[getter];props[getter]=retain(a(0));if(old)await release(old);
    });
  }
  hostClass('NSURLConnection','NSObject');
  function offlineError(code=-1009) {
    const err=alloc(names.get('NSError'));write(err+4,code);write(err+8,retain(string('NSURLErrorDomain')));return err;
  }
  const connections=new Map(), responses=new Map();
  hostClass('NSURLResponse','NSObject');
  method('NSURLResponse',false,'copy',retain);
  installURLCache({hostClass,method,alloc,destroy,retain,release,autorelease,text,string,write,send});
  method('NSURLResponse',false,'URL',s=>responses.get(s)?.url??0);
  method('NSURLResponse',false,'expectedContentLength',s=>BigInt(responses.get(s)?.length??-1));
  method('NSURLResponse',false,'dealloc',async s=>{const r=responses.get(s);responses.delete(s);if(r)await release(r.url);destroy(s);});
  async function loadRequest(req) {
    const url=requests.get(req),u=urls.get(url);
    if(u?.protocol!=='file:')return {error:autorelease(offlineError())};
    const data=await send(names.get('NSData'),'dataWithContentsOfFile:',[string(decodeURIComponent(u.pathname))]);
    if(!data)return {error:autorelease(offlineError(-1100))};
    const response=alloc(names.get('NSURLResponse'));
    responses.set(response,{url:retain(url),length:await send(data,'length')});
    return {data,response:autorelease(response)};
  }
  function supportedRequest(req){const u=urls.get(requests.get(req));return !!u&&['https:','http:','file:'].includes(u.protocol);}
  function connect(s) {
    const c=connections.get(s);if(!c||c.started||c.cancelled)return;c.started=true;
    mainRequests.push(async()=>{
      if(c.cancelled||!c.delegate)return;
      const {data,response,error}=await loadRequest(c.request);
      if(error) {
        await send(c.delegate,'connection:didFailWithError:',[s,error],true);
      } else {
        await send(c.delegate,'connection:didReceiveResponse:',[s,response],true);
        if(!c.cancelled)await send(c.delegate,'connection:didReceiveData:',[s,data],true);
        if(!c.cancelled)await send(c.delegate,'connectionDidFinishLoading:',[s],true);
      }
    });
  }
  function newConnection(s,req,delegate,immediate){
    if(!supportedRequest(req)){destroy(s);return 0;}
    connections.set(s,{request:retain(req),delegate:retain(delegate)});if(immediate)connect(s);return s;
  }
  method('NSURLConnection',true,'canHandleRequest:',(_,a)=>Number(supportedRequest(a(0))));
  method('NSURLConnection',true,'connectionWithRequest:delegate:',(cls,a)=>autorelease(newConnection(alloc(cls),a(0),a(1),true)));
  method('NSURLConnection',false,'initWithRequest:delegate:',(s,a)=>newConnection(s,a(0),a(1),true));
  method('NSURLConnection',false,'initWithRequest:delegate:startImmediately:',(s,a)=>newConnection(s,a(0),a(1),!!a(2)));
  method('NSURLConnection',false,'start',connect);
  method('NSURLConnection',false,'cancel',s=>{const c=connections.get(s);if(c)c.cancelled=true;});
  method('NSURLConnection',false,'scheduleInRunLoop:forMode:',(s,a)=>{const c=connections.get(s);if(c)c.runLoop=a(0);});
  method('NSURLConnection',false,'dealloc',async s=>{
    const c=connections.get(s);if(c){c.cancelled=true;connections.delete(s);await release(c.delegate);await release(c.request);}destroy(s);
  });
  method('NSURLConnection',true,'sendAsynchronousRequest:queue:completionHandler:',async(_,a)=>{
    const req=a(0),q=a(1),fn=a(2);if(!fn)return;
    const {response=0,data=0,error=0}=await loadRequest(req);
    const dispatch=getDispatch(),block=await dispatch.copy(fn);
    const args=[block,retain(response),retain(data),retain(error)];
    const done=async()=>{await dispatch.release(block);for(const p of args.slice(1))await release(p);};
    if(q===mainQueue()){
      mainRequests.push(async()=>{try{await callBlock(read(block+12),args);}finally{await done();}});
    }else if(!threads.spawnDetached(read(block+12),args,done)) {await done();throw Error('NSOperationQueue worker allocation failed');}
  });
  method('NSURLConnection',true,'sendSynchronousRequest:returningResponse:error:',async(_,a)=>{
    const req=a(0),outResponse=a(1),outError=a(2),{response=0,data=0,error=0}=await loadRequest(req);
    if(outResponse)write(outResponse,response);if(outError)write(outError,error);return data;
  });
  const mainRequests=[];
  hostClass('UIDevice','NSObject');
  installDeviceIdentity({method,string,uuid:newUUID,uuidString,
    read:()=>globalThis.localStorage?.getItem(preferenceDomain+'.vendor-id')??null,
    save:value=>globalThis.localStorage?.setItem(preferenceDomain+'.vendor-id',value)});
  method('UIDevice',true,'currentDevice',singleton('UIDevice'));
  method('UIDevice',false,'systemVersion',()=>string('7.1'));
  method('UIDevice',false,'systemName',()=>string('iPhone OS'));
  method('UIDevice',false,'model',()=>string('iPhone'));
  method('UIDevice',false,'userInterfaceIdiom',()=>0);
  let orientationRequests=0;
  method('UIDevice',false,'beginGeneratingDeviceOrientationNotifications',()=>{orientationRequests++;});
  method('UIDevice',false,'endGeneratingDeviceOrientationNotifications',()=>{orientationRequests=Math.max(0,orientationRequests-1);});
  method('UIDevice',false,'isGeneratingDeviceOrientationNotifications',()=>Number(orientationRequests>0));
  method('UIDevice',false,'orientation',()=>{
    if(!orientationRequests)return 0;
    return ({'portrait-primary':1,'portrait-secondary':2,'landscape-primary':3,'landscape-secondary':4})[globalThis.screen?.orientation?.type]??0;
  });
  hostClass('NSThread','NSObject');
  const threadObjects=new Map(), threadNames=new Map();
  function thread(id) {
    if(!threadObjects.has(id))threadObjects.set(id,alloc(names.get('NSThread')));
    return threadObjects.get(id);
  }
  const threadId=()=>threads?.funcs._pthread_self()??1;
  method('NSThread',true,'mainThread',()=>thread(1));
  method('NSThread',true,'currentThread',()=>thread(threadId()));
  method('NSThread',true,'isMainThread',()=>Number(threadId()===1));
  method('NSThread',false,'isMainThread',s=>Number(thread(1)===s));
  method('NSThread',false,'setName:',(s,a)=>{threadNames.set(s,a(0)?text(a(0)):'');});
  method('NSThread',false,'name',s=>threadNames.has(s)?string(threadNames.get(s)):0);
  function detach(sel,target,arg) {
    const name=readString(cpu,sel), pc=lookup(read(target),name);
    if (typeof pc!=='number')throw Error('Expected guest NSThread selector '+name);
    retain(target);retain(arg);
    const id=threads.spawnDetached(pc,[target,sel,arg],async()=>{await release(target);await release(arg);});
    if(!id)throw Error('Could not allocate NSThread stack');
  }
  method('NSThread',true,'detachNewThreadSelector:toTarget:withObject:',(_,a)=>detach(a(0),a(1),a(2)));
  for(const meta of [true,false])method('NSObject',meta,'performSelectorInBackground:withObject:',(s,a)=>detach(a(0),s,a(1)));
  hostClass('NSNotificationCenter','NSObject');hostClass('NSNotification','NSObject',16);
  const observers=[];
  method('NSNotificationCenter',true,'defaultCenter',singleton('NSNotificationCenter'));
  method('NSNotificationCenter',false,'addObserver:selector:name:object:',(_,a)=>{
    observers.push({observer:a(0),sel:a(1),name:a(2)?text(a(2)):null,sender:a(3)});
  });
  function remove(a, filtering) {
    const name=filtering&&a(1)?text(a(1)):null, sender=filtering?a(2):0;
    for(let i=observers.length-1;i>=0;i--){
      const v=observers[i]; if(v.observer===a(0)&&(!name||v.name===name)&&(!sender||v.sender===sender))observers.splice(i,1);
    }
  }
  method('NSNotificationCenter',false,'removeObserver:',(_,a)=>remove(a,false));
  method('NSNotificationCenter',false,'removeObserver:name:object:',(_,a)=>remove(a,true));
  const notification=(name,sender,userInfo)=>{
    const n=alloc(names.get('NSNotification'));write(n+4,retain(name));write(n+8,retain(sender));write(n+12,retain(userInfo));return autorelease(n);
  };
  async function post(n) {
    const name=text(read(n+4)), sender=read(n+8);
    for (const v of [...observers])if((v.name===null||v.name===name)&&(!v.sender||v.sender===sender))
      await send(v.observer,readString(cpu,v.sel),[n]);
  }
  method('NSNotification',true,'notificationWithName:object:',(_,a)=>notification(a(0),a(1),0));
  method('NSNotification',true,'notificationWithName:object:userInfo:',(_,a)=>notification(a(0),a(1),a(2)));
  for(const [name,offset] of [['name',4],['object',8],['userInfo',12]])method('NSNotification',false,name,s=>read(s+offset));
  method('NSNotification',false,'dealloc',async s=>{for(const off of [4,8,12])await release(read(s+off));destroy(s);});
  method('NSNotificationCenter',false,'postNotification:',(_,a)=>post(a(0)));
  method('NSNotificationCenter',false,'postNotificationName:object:',(_,a)=>post(notification(a(0),a(1),0)));
  method('NSNotificationCenter',false,'postNotificationName:object:userInfo:',(_,a)=>post(notification(a(0),a(1),a(2))));
  return {archiveNumber:p=>numbers.get(p),archiveDate:dates.referenceTime,archiveEntries:p=>Array.from(dicts.get(p)?.values()??[]),setArchivedNumber:(p,v)=>{numbers.set(p,v);},setArchivedDate:dates.setReferenceTime,property,formatted,description,unbox,get,dictionary,number,associated,newUUID,uuidString,pending:()=>mainRequests.length,async pollMain(){for(const f of mainRequests.splice(0))await f();}};
}
