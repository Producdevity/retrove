import {listApps,getApp,importApp,removeApp,formatBytes} from './library.mjs';
const $=id=>document.getElementById(id);
let apps=[],iconURLs=[],selected,importing=false,installPrompt;
const create=(tag,className,value)=>{const e=document.createElement(tag);if(className)e.className=className;if(value!==undefined)e.textContent=value;return e;};
function appIcon(app){if(app.icon){const url=URL.createObjectURL(app.icon);iconURLs.push(url);const img=create('img','app-icon');img.src=url;img.alt='';return img;}return create('div','app-icon app-monogram',app.name.slice(0,1));}
function launch(app){location.href='/player.html?app='+encodeURIComponent(app.id);}
async function refresh(){apps=(await listApps()).sort((a,b)=>a.name.localeCompare(b.name));render();await storage();}
function render(){
  iconURLs.forEach(URL.revokeObjectURL);iconURLs=[];$('apps').replaceChildren();
  const query=$('search').value.toLowerCase(),visible=apps.filter(a=>a.name.toLowerCase().includes(query));
  $('library-count').textContent=apps.length?`${apps.length} ${apps.length===1?'app':'apps'} on this device`:'Your personal app library';
  $('empty').hidden=apps.length>0;$('no-results').hidden=!apps.length||visible.length>0;
  for(const app of visible){
    const row=create('article','app-row'),body=create('div','app-main'),title=create('button','app-name',app.name);title.onclick=()=>details(app);
    const meta=create('p','app-meta');meta.append(create('span','',app.version),create('span','',formatBytes(app.size)));
    body.append(title,meta);const open=create('button','launch','Open');open.onclick=()=>launch(app);open.setAttribute('aria-label','Open '+app.name);
    const more=create('button','more','•••');more.setAttribute('aria-label','Details for '+app.name);more.onclick=()=>details(app);
    row.append(appIcon(app),body,open,more);$('apps').append(row);
  }
}
function details(app){selected=app;$('details-content').replaceChildren(appIcon(app),create('h2','',app.name),create('p','',app.id),create('p','',`Version ${app.version} • ${formatBytes(app.size)}`));$('app-details').showModal();}
$('details-launch').onclick=()=>launch(selected);
$('remove').onclick=async()=>{if(!selected)return;await removeApp(selected.id);$('app-details').close();await refresh();};
async function add(file){if(!file||importing)return;importing=true;$('error').hidden=true;const status=$('import-status');status.hidden=false;
  for(const input of document.querySelectorAll('input[type=file]'))input.disabled=true;
  try{await importApp(file,(label,progress)=>{status.querySelector('span').textContent=label;status.querySelector('progress').value=progress;});await refresh();}
  catch(error){$('error').textContent=error.name==='QuotaExceededError'?'Browser storage is full. Free space and try importing again.':error.message;$('error').hidden=false;}
  finally{importing=false;status.hidden=true;for(const input of document.querySelectorAll('input[type=file]')){input.disabled=false;input.value='';}}
}
for(const id of ['import','empty-import'])$(id).onchange=e=>add(e.target.files[0]);
$('search').oninput=render;
for(const button of document.querySelectorAll('[data-page]'))button.onclick=()=>{for(const section of document.querySelectorAll('.page'))section.hidden=section.id!==button.dataset.page;for(const nav of document.querySelectorAll('[data-page]'))nav.classList.toggle('active',nav===button);if(button.dataset.page==='activity')report();};
function report(){const text=localStorage.getItem('retrove.last-report');$('report').textContent=text||'';$('report-status').textContent=text?'Last runtime report. Kept on this device.':'No sessions yet.';$('export-log').disabled=!text;}
$('export-log').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([localStorage.getItem('retrove.last-report')||''],{type:'text/plain'}));a.href=url;a.download='retrove-report.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function storage(){const estimate=await navigator.storage?.estimate?.();$('storage').textContent=estimate?`${formatBytes(estimate.usage||0)} used of ${formatBytes(estimate.quota||0)} available to this browser.`:'Storage estimates are unavailable in this browser.';const persisted=await navigator.storage?.persisted?.();$('persistence').textContent=persisted?'Persistent storage is enabled.':'The browser may reclaim local storage when the device runs low on space.';}
$('persist').onclick=async()=>{await navigator.storage?.persist?.();await storage();};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});
$('install').onclick=async()=>{await installPrompt?.prompt();installPrompt=null;$('install').hidden=true;};
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)$('install-help').textContent='Retrove is running as an installed app.';
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
refresh().catch(error=>{$('error').textContent=error.message;$('error').hidden=false;});
