import {getApp,appFile,played} from './library.mjs';
import {openIPA} from '../web/ipa.mjs';
import {runGuest} from '../web/runtime.mjs';
import {initialOrientation,phoneScreen} from '../web/screen.mjs';
import {DiagnosticRecorder} from '../web/diagnostics.mjs';
const $=id=>document.getElementById(id),recorder=new DiagnosticRecorder(),controller=new AbortController();
let app,ipa,gl,sound,snapshot,started=false,firstImage=false,lastReport=0,orientation=3;
const label=(message)=>{$('status').textContent=message;};
function store(){const log=recorder.text();$('log').value=log;try{localStorage.setItem('retrove.last-report',log);}catch{}}
function diagnostic(level,area,message,details){recorder.event(level,area,message,details);if(level==='error')store();if(area==='guest-output'&&level==='debug')return;if(level==='info'){$('detail').textContent=message;if(!firstImage)label(message);}if(area==='movie'&&message.includes('Tap'))$('resume-media').hidden=false;}
function graphics(){if(gl)return gl;const canvas=document.createElement('canvas'),landscape=orientation>2;canvas.width=(landscape?phoneScreen.height:phoneScreen.width)*phoneScreen.scale;canvas.height=(landscape?phoneScreen.width:phoneScreen.height)*phoneScreen.scale;gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true})||canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL is unavailable on this device');canvas.addEventListener('webglcontextlost',()=>controller.abort(Error('The graphics context was lost.')));$('display').prepend(canvas);return gl;}
function observe(value){snapshot=value;recorder.snapshot(value);$('summary').textContent=`${value.phase} · ${value.render?.presentedFrames||0} presented frames · ${Math.round(value.elapsedMs/1000)} seconds`;
  if(value.fault){document.body.classList.add('failed');document.body.classList.remove('playing');label(value.fault.message);store();}
  else if(value.render?.presentedFrames>0){firstImage=true;document.body.classList.add('playing');}
  if(performance.now()-lastReport>5000){lastReport=performance.now();store();}
}
const observer=new MutationObserver(()=>{if($('display').querySelector('canvas[style*="position"]')){firstImage=true;document.body.classList.add('playing');}});observer.observe($('display'),{childList:true});
async function start(){if(started)return;started=true;$('start').hidden=true;
  try{sound=new AudioContext();await sound.resume();}catch{}
  try{await played(app.id);await runGuest(ipa,{signal:controller.signal,graphics,audioContext:()=>sound,mediaHost:$('display'),diagnostic,log:text=>diagnostic('debug','guest-output',text),report:observe});recorder.finish('completed','App exited');}
  catch(error){if(controller.signal.aborted){recorder.finish('stopped','App closed');}else{diagnostic('error','runtime',error.message,error);recorder.finish('failed',error.message);document.body.classList.add('failed');document.body.classList.remove('playing');label(error.message);$('report-dialog').showModal();}}
  finally{await sound?.close().catch(()=>{});store();}
}
$('start').onclick=start;
$('fullscreen').onclick=async()=>{document.body.classList.add('immersive');$('show-toolbar').hidden=false;try{await document.documentElement.requestFullscreen?.();}catch{}};
$('show-toolbar').onclick=()=>{document.body.classList.remove('immersive');$('show-toolbar').hidden=true;};
$('diagnostics').onclick=()=>{store();$('report-dialog').showModal();};
$('resume-media').onclick=()=>{sound?.resume();for(const video of $('display').querySelectorAll('video'))video.play().catch(()=>{});$('resume-media').hidden=true;};
$('save-log').onclick=()=>{store();const a=document.createElement('a'),url=URL.createObjectURL(new Blob([$('log').value],{type:'text/plain'}));a.href=url;a.download='retrove-report.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('back').onclick=()=>{controller.abort();store();};window.addEventListener('pagehide',()=>{controller.abort();store();});
for(const name of ['gesturestart','gesturechange','gestureend'])$('stage').addEventListener(name,event=>event.preventDefault(),{passive:false});
$('stage').addEventListener('touchmove',event=>event.preventDefault(),{passive:false});$('stage').addEventListener('contextmenu',event=>event.preventDefault());
try{app=await getApp(new URL(location.href).searchParams.get('app'));if(!app)throw Error('This app is no longer in your library.');$('title').textContent=app.name;document.title=app.name+' — Retrove';recorder.start(app.name,{build:'retrove-0.1.0',browser:navigator.userAgent,viewport:[innerWidth,innerHeight]});ipa=await openIPA(await appFile(app),diagnostic);orientation=initialOrientation(ipa.info);$('display').style.setProperty('--aspect',orientation>2?phoneScreen.height/phoneScreen.width:phoneScreen.width/phoneScreen.height);label('Ready to open '+app.name);$('detail').textContent='Tap Start to enable audio and launch the app.';$('start').hidden=false;}catch(error){document.body.classList.add('failed');label(error.message);}
