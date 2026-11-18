import {installPropertyListSerialization} from "../src/runtime/ios/foundation/property-list-serialization.ts";
import {installFileAttributes} from "../src/runtime/ios/foundation/file-attributes.ts";
import {installFileAttributeReader} from "../src/runtime/ios/foundation/file-attribute-reader.ts";
import {parseStat,STAT_BYTES} from "../src/runtime/ios/libc/file-metadata.ts";
import {installErrors,ERROR_INSTANCE_BYTES,ErrorField} from "../src/runtime/ios/foundation/errors.ts";
import {installDictionaryFiles} from "../src/runtime/ios/foundation/property-lists.ts";
import {installStringFiles} from "../src/runtime/ios/foundation/string-files.ts";
import {writeArchiveFile} from "../src/runtime/ios/foundation/archives/file-writer.ts";
import {installUrlResources} from '../src/runtime/ios/foundation/url-resources.ts';
import {parsePlist} from '../src/runtime/formats/plist/index.ts';
import {readString} from '../src/runtime/memory/guest-memory.ts';

// NSFileManager and libc share one filesystem, including current directory and saves.
export function fileManager({release,destroy,cpu,heap,sys,hostClass,method,names,alloc,string,text,utf8,write,read,array,autorelease,send,retain,property,dataFrom,decodeText,makeString,entries,isKind}) {
  const invoke=(name,...args)=>sys.funcs[name](i=>args[i]??0);
  hostClass('NSFileManager','NSObject');
  hostClass('NSError','NSObject',ERROR_INSTANCE_BYTES);
  installErrors({method,alloc,destroy,autorelease,retain,release,text,string,write,read,send,dictionary:()=>property({})});
  let manager;
  method('NSFileManager',true,'defaultManager',()=>manager??=alloc(names.get('NSFileManager')));
  function failure(out) {
    if(out){
      const value=alloc(names.get('NSError'));write(value+ErrorField.Code,read(invoke('___error')));write(out,autorelease(value));
    }
    return 0;
  }
  async function stat(path,dir) {
    const scratch=heap.zero(108);
    try {
      const ok=await invoke('_stat',path,scratch)===0;
      const bytes=ok?cpu.read(scratch+4,2):null;
      const type=bytes?bytes[0]|bytes[1]<<8:0;
      if(dir)cpu.write(dir,new Uint8Array([Number((type&0xf000)===0x4000)]));
      return ok?type:0;
    } finally {heap.free(scratch);}
  }
  const makeError=(code,domain)=>{const value=alloc(names.get('NSError'));write(value+ErrorField.Code,code);const name=retain(string(domain));write(value+ErrorField.Domain,name);return autorelease(value);};
  installFileAttributes({method,text,write,entries,isKind,send,error:makeError,setMetadata:(path,update)=>sys.setMetadata(path,update)});
  installFileAttributeReader({method,text,write,send,property,error:makeError,stat:async path=>{
    const scratch=heap.zero(STAT_BYTES),pointer=heap.string(path);
    try {return await invoke('_stat',pointer,scratch)===0?parseStat(cpu.read(scratch,STAT_BYTES)):read(invoke('___error'));}
    finally {heap.free(pointer);heap.free(scratch);}
  }});
  installUrlResources({hostClass,method,alloc,destroy,autorelease,retain,release,text,string,write,send,
    stat:async path=>await stat(utf8(path),0)?0:read(invoke('___error')),
    error:makeError});
  const dirs=new Map([[5,'/Library'],[9,'/Documents'],[13,'/Library/Caches'],[14,'/Library/Application Support']]);
  method('NSFileManager',false,'URLsForDirectory:inDomains:',async(_,a)=>{
    const path=dirs.get(a(0));const urls=(a(1)&1)&&path?[await send(names.get('NSURL'),'fileURLWithPath:',[string(path)])]:[];
    return autorelease(array(urls));
  });
  method('NSFileManager',false,'fileExistsAtPath:',async(_,a)=>Number(!!(a(0)&&await stat(utf8(a(0)),0))));
  method('NSFileManager',false,'fileExistsAtPath:isDirectory:',async(_,a)=>Number(!!(a(0)&&await stat(utf8(a(0)),a(1)))));
  method('NSFileManager',false,'currentDirectoryPath',async()=>{
    const path=await invoke('_getcwd',0,0);
    try {return path?string(readString(cpu,path)):0;} finally {if(path)heap.free(path);}
  });
  method('NSFileManager',false,'changeCurrentDirectoryPath:',async(_,a)=>Number(!!a(0)&&await invoke('_chdir',utf8(a(0)))===0));
  method('NSFileManager',false,'createDirectoryAtPath:attributes:',(self,a)=>send(self,'createDirectoryAtPath:withIntermediateDirectories:attributes:error:',[a(0),0,a(1),0]));
  method('NSFileManager',false,'createDirectoryAtPath:withIntermediateDirectories:attributes:error:',async(self,a)=>{
    const path=text(a(0)), parents=a(1), error=a(3), segments=path.split('/').filter(Boolean);
    const prefix=path.startsWith('/')?'/':'';
    for(let i=parents?1:segments.length;i<=segments.length;i++){
      const p=heap.string(prefix+segments.slice(0,i).join('/'));
      try {
        const created=await invoke('_mkdir',p,0o755)===0;
        if(!created && !(parents&&((await stat(p,0))&0xf000)===0x4000))return failure(error);
        if(created&&a(2)&&!await send(self,'setAttributes:ofItemAtPath:error:',[a(2),string(prefix+segments.slice(0,i).join('/')),error]))return 0;
      } finally {heap.free(p);}
    }
    return 1;
  });
  method('NSFileManager',false,'contentsOfDirectoryAtPath:error:',async(_,a)=>{
    const err=a(1),dir=await invoke('_opendir',utf8(a(0)));
    if(!dir)return failure(err);
    const items=[];
    try {
      let entry;while((entry=await invoke('_readdir',dir))) {
        const name=readString(cpu,entry+21);if(name!=='.'&&name!=='..')items.push(string(name));
      }
    } finally {await invoke('_closedir',dir);}
    return autorelease(array(items));
  });
  async function contents(path) {
    if(!path)return;
    const fd=await invoke('_open',utf8(path),0);
    if(fd<0)return;
    const statbuf=heap.zero(108);
    let buffer;
    try{
      if(await invoke('_fstat',fd,statbuf)!==0)return;
      const size=read(statbuf+60);if(read(statbuf+64)||size>256*1024*1024)return;
      const output=new Uint8Array(size);
      buffer=heap.alloc(Math.min(65536,Math.max(1,size)));if(!buffer)return;
      for(let offset=0;offset<size;){
        const count=await invoke('_read',fd,buffer,Math.min(65536,size-offset));
        if(count<=0)return;output.set(cpu.read(buffer,count),offset);offset+=count;
      }
      return output;
    } finally {if(buffer)heap.free(buffer);heap.free(statbuf);await invoke('_close',fd);}
  }
  installStringFiles({method,alloc,destroy,autorelease,write,contents,errno:()=>read(invoke('___error')),decode:decodeText,initialize:(p,v)=>makeString(v,p),error:makeError});
  installPropertyListSerialization({hostClass,method,string,retain,write,error:makeError,parse:parsePlist,property,bytes:p=>{if(!isKind(p,'NSData'))throw Error('Expected NSData property list');return cpu.read(read(p+4),read(p+8));}});
  installDictionaryFiles({method,autorelease,destroy,contents,parse:parsePlist,property,send});
  method('NSData',true,'dataWithContentsOfFile:',async(_,a)=>{
    const bytes=await contents(a(0));if(!bytes)return 0;
    const p=heap.alloc(Math.max(1,bytes.length));try{cpu.write(p,bytes);return autorelease(dataFrom(p,bytes.length));}finally{heap.free(p);}
  });
  method('NSFileManager',false,'removeItemAtURL:error:',async(_,a)=>{
    const u=a(0),err=a(1);if(!u||!await send(u,'isFileURL'))return failure(err);
    return send(manager,'removeItemAtPath:error:',[await send(u,'path'),err]);
  });
  async function pathCall(path,fn){
    const p=heap.string(path);try{return await fn(p);}finally{heap.free(p);}
  }
  async function listNames(ptr) {
    const dir=await invoke('_opendir',ptr);if(!dir)return null;
    const names=[];
    try{let ent;while((ent=await invoke('_readdir',dir))){const n=readString(cpu,ent+21);if(n!=='.'&&n!=='..')names.push(n);}}
    finally{await invoke('_closedir',dir);}
    return names;
  }
  async function removeTree(path) {
    return pathCall(path,async ptr=>{
      const mode=await stat(ptr,0);if(!mode)return false;
      if((mode&0xf000)!==0x4000)return await invoke('_unlink',ptr)===0;
      const children=await listNames(ptr);if(!children)return false;
      for(const name of children)if(!await removeTree(path+'/'+name))return false;
      return await invoke('_rmdir',ptr)===0;
    });
  }
  async function copyTree(src,dst) {
    return pathCall(src,source=>pathCall(dst,async dest=>{
      const mode=await stat(source,0);if(!mode)return false;
      if((mode&0xf000)===0x4000){
        const entries=await listNames(source);if(!entries||await invoke('_mkdir',dest,0o755)!==0)return false;
        for(const name of entries){if(!await copyTree(src+'/'+name,dst+'/'+name)){await removeTree(dst);return false;}}
        return true;
      }
      if((mode&0xf000)!==0x8000)return false;
      const input=await invoke('_open',source,0);if(input<0)return false;
      let out=-1,buffer,ok=false;
      try{
        out=await invoke('_open',dest,0xa01);if(out<0)return false;
        buffer=heap.alloc(65536);if(!buffer)return false;
        for(;;){
          const n=await invoke('_read',input,buffer,65536);if(n<0)return false;if(n===0){ok=true;return true;}
          for(let off=0;off<n;){const k=await invoke('_write',out,buffer+off,n-off);if(k<=0)return false;off+=k;}
        }
      }finally{
        if(buffer)heap.free(buffer);await invoke('_close',input);
        if(out>=0){await invoke('_close',out);if(!ok)await invoke('_unlink',dest);}
      }
    }));
  }
  method('NSFileManager',false,'removeItemAtPath:error:',async(_,a)=>{
    const path=text(a(0)),err=a(1);
    return await removeTree(path)?1:failure(err);
  });
  method('NSFileManager',false,'copyItemAtPath:toPath:error:',async(_,a)=>{
    const source=text(a(0)).replace(/\/+$/,''),dest=text(a(1)).replace(/\/+$/,''),err=a(2);
    if(dest===source||dest.startsWith(source+'/'))return failure(err);
    return await copyTree(source,dest)?1:failure(err);
  });
  method('NSFileManager',false,'contentsAtPath:',(_,a)=>send(names.get('NSData'),'dataWithContentsOfFile:',[a(0)]));
  method('NSFileManager',false,'createFileAtPath:contents:attributes:',async(_,a)=>{
    const d=a(1),path=utf8(a(0)),fd=await invoke('_open',path,0x601);
    if(fd<0)return 0;
    try{
      if(!d)return 1;const size=read(d+8),p=read(d+4);
      for(let off=0;off<size;){const n=await invoke('_write',fd,p+off,Math.min(65536,size-off));if(n<=0)return 0;off+=n;}
      return 1;
    }finally{await invoke('_close',fd);}
  });
  method('NSFileManager',false,'stringWithFileSystemRepresentation:length:',(_,a)=>string(new TextDecoder().decode(cpu.read(a(0),a(1)))));
  const archiveWriter={
    unique:()=>crypto.randomUUID(),
    open:(path,flags)=>pathCall(path,p=>invoke('_open',p,flags)),
    close:fd=>invoke('_close',fd),
    rename:(source,dest)=>pathCall(source,s=>pathCall(dest,d=>invoke('_rename',s,d))),
    remove:path=>pathCall(path,p=>invoke('_unlink',p)),
    async write(fd,bytes){const p=heap.alloc(bytes.length);try{cpu.write(p,bytes);return await invoke('_write',fd,p,bytes.length);}finally{heap.free(p);}}
  };
  return {contents,error:makeError,writeArchive:(path,bytes)=>writeArchiveFile(archiveWriter,text(path),bytes)};
}
