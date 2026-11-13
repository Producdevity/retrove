import {openIPA} from '../web/ipa.mjs';
import {parseMachO} from '../web/macho.mjs';
import {decodeCgBI} from '../web/cgbi.mjs';
const request = req => new Promise((resolve,reject) => { req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
let opening;
async function database() {
  return opening ??= new Promise((resolve,reject)=>{
    const req=indexedDB.open('reprise.library',1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('apps',{keyPath:'id'});req.result.createObjectStore('archives');};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function transaction(names, mode, run) {
  const db=await database(),tx=db.transaction(names,mode);
  const done=new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=tx.onabort=()=>rej(tx.error||Error('Library transaction failed'));});
  try {const value=await run(tx);await done;return value;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
}
async function directory() {
  if(!navigator.storage?.getDirectory)return null;
  return (await navigator.storage.getDirectory()).getDirectoryHandle('reprise-apps',{create:true});
}
export const listApps=()=>transaction(['apps'],'readonly',tx=>request(tx.objectStore('apps').getAll()));
export const getApp=id=>transaction(['apps'],'readonly',tx=>request(tx.objectStore('apps').get(id)));
export async function appFile(app) {
  if(app.storage==='opfs')return (await (await directory()).getFileHandle(app.archive)).getFile();
  return transaction(['archives'],'readonly',tx=>request(tx.objectStore('archives').get(app.archive)));
}
async function icon(ipa) {
  const files=ipa.info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles??ipa.info.CFBundleIconFiles??[ipa.info.CFBundleIconFile??'Icon'];
  const match=[...ipa.entries.keys()].filter(p=>files.some(f=>p.startsWith(ipa.bundlePath+'/'+f.replace(/\.png$/i,'')))&&/\.png$/i.test(p)).sort((a,b)=>Number(b.includes('@2x'))-Number(a.includes('@2x')))[0];
  if(!match)return null;
  try {
    const bytes=await ipa.read(match),decoded=decodeCgBI(bytes);
    if(!decoded)return new Blob([bytes],{type:'image/png'});
    const canvas=document.createElement('canvas');canvas.width=decoded.width;canvas.height=decoded.height;
    const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(decoded.rgba),decoded.width,decoded.height),0,0);
    return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  }catch{return null;}
}
export async function importApp(file,onProgress=()=>{}) {
  onProgress('Reading app information',0);
  const ipa=await openIPA(file);
  parseMachO(await ipa.readExecutable());
  const id=ipa.info.CFBundleIdentifier||ipa.executablePath;
  const previous=await getApp(id);
  const estimate=await navigator.storage?.estimate?.();
  if(estimate?.quota && estimate.quota-estimate.usage<file.size*1.05)throw Error('Not enough browser storage for this IPA. Free space before importing.');
  const archive=crypto.randomUUID()+'.ipa',dir=await directory();
  const record={id,archive,storage:dir?'opfs':'indexeddb',name:ipa.info.CFBundleDisplayName||ipa.info.CFBundleName||ipa.info.CFBundleExecutable,
    version:ipa.info.CFBundleShortVersionString||ipa.info.CFBundleVersion||'',size:file.size,filename:file.name,added:Date.now(),icon:await icon(ipa),lastPlayed:previous?.lastPlayed};
  let written=false;
  try {
    if(dir) {
      const out=await (await dir.getFileHandle(archive,{create:true})).createWritable();
      let count=0;
      try {await file.stream().pipeThrough(new TransformStream({transform(chunk,controller){count+=chunk.byteLength;onProgress('Keeping this IPA on your device',count/file.size);controller.enqueue(chunk);}})).pipeTo(out);written=true;}
      catch(error){await out.abort().catch(()=>{});throw error;}
    }
    await transaction(['apps','archives'],'readwrite',async tx=>{
      if(!dir)await request(tx.objectStore('archives').put(file,archive));
      await request(tx.objectStore('apps').put(record));
    });
  }catch(error){if(dir)await dir.removeEntry(archive).catch(()=>{});throw error;}
  if(previous)await deleteArchive(previous).catch(()=>{});
  await navigator.storage?.persist?.().catch(()=>false);
  onProgress('Added to your library',1);
  return record;
}
async function deleteArchive(app) {
  if(app.storage==='opfs')await (await directory()).removeEntry(app.archive);
  else await transaction(['archives'],'readwrite',tx=>request(tx.objectStore('archives').delete(app.archive)));
}
export async function removeApp(id) {
  const app=await getApp(id);if(!app)return;
  await transaction(['apps'],'readwrite',tx=>request(tx.objectStore('apps').delete(id)));
  await deleteArchive(app);
}
export async function played(id) {
  return transaction(['apps'],'readwrite',async tx=>{const st=tx.objectStore('apps'),app=await request(st.get(id));if(app){app.lastPlayed=Date.now();await request(st.put(app));}});
}
export function formatBytes(bytes) {if(bytes>=2**30)return (bytes/2**30).toFixed(2)+' GB';return (bytes/2**20).toFixed(1)+' MB';}
