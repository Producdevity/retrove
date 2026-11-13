import {cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await mkdir('dist',{recursive:true});
for(const name of ['index.html','player.html','app.webmanifest','app','icons','web'])await cp(name,'dist/'+name,{recursive:true});
const urls=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())await walk(path);else if(!path.includes('/vendor/source/'))urls.push('/'+path.slice(5));}}
await walk('dist');
const version=Date.now().toString(36);
const worker=`const CACHE='reprise-${version}';const ASSETS=${JSON.stringify(urls)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('reprise-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(fetch(e.request).catch(()=>caches.match(u.pathname==='/'?'/index.html':u.pathname).then(r=>r||new Response('Offline',{status:503}))));});`;
await writeFile('sw.js',worker);await writeFile('dist/sw.js',worker);
await writeFile('dist/_headers','/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n/sw.js\n  Cache-Control: no-cache\n');
execFileSync('python3',['scripts/source-archive.py']);
console.log('Built static app; '+urls.length+' offline assets.');
