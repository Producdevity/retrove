import {moviePlayers} from '../web/movie.mjs';
export async function movieTest(){
  const handlers=new Map(),notes=[],events=[];
  const methods=(cls,meta,sel,fn)=>handlers.set(sel,fn);
  const names=new Map(['UIView','NSNumber','NSDictionary','NSNotificationCenter'].map(x=>[x,x]));
  const ipa={entries:new Map([['red.mp4',{}]]),assetBlob:async()=>await(await fetch('/tests/fixtures/red.mp4')).blob()};
  const send=async (obj,s,args=[])=>{
    if(s==='path')return obj===100?'red.mp4':'missing.mp4';
    if(s==='numberWithInt:')return args[0];
    if(s==='dictionaryWithObject:forKey:')return {[args[1]]:args[0]};
    if(s==='defaultCenter')return 'center';
    if(s==='postNotificationName:object:userInfo:')notes.push(args);
  };
  const players=moviePlayers({hostClass(){},method:methods,names,alloc:()=>22,retain:x=>x,release(){},string:x=>x,text:x=>x,send,ipa,
    mediaHost:document.body,diagnostic:(...args)=>events.push(args)});
  const call=(p,name,...args)=>handlers.get(name)(p,i=>args[i]??0);
  await call(10,'initWithContentURL:',100);await call(10,'setShouldAutoplay:',0);
  const video=document.querySelector('video');if(!video)throw Error('No movie element');
  video.muted=true;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<120&&video.readyState<2&&!video.error;i++)await wait(25);
  await players.pump();const readyBeforePlay=call(10,'loadState');
  if(!readyBeforePlay||!video.paused||!notes.some(n=>n[0]==='MPMoviePlayerLoadStateDidChangeNotification'))throw Error('Media loading did not complete before playback');
  if(call(10,'isPreparedToPlay'))throw Error('Initializing a URL prepared playback hardware');
  await call(10,'prepareToPlay');await call(10,'play');
  for(let i=0;i<120&&!video.ended&&!video.error;i++)await wait(50);
  await players.pump();await players.pump();
  const finished=()=>notes.filter(n=>n[0]==='MPMoviePlayerPlaybackDidFinishNotification');
  if(!notes.some(n=>n[0]==='MPMoviePlayerLoadStateDidChangeNotification')||!video.ended||finished().length!==1||finished()[0][2].MPMoviePlayerPlaybackDidFinishReasonUserInfoKey!==0)
    throw Error('Movie playback did not end normally: '+JSON.stringify(events));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.drawImage(video,0,0);const rgba=[...ctx.getImageData(2,2,1,1).data];
  if(rgba[0]<235||rgba[1]>20||rgba[2]>20)throw Error('Movie pixel '+rgba);
  await call(11,'initWithContentURL:',101);await call(11,'play');await players.pump();await players.pump();
  if(finished().length!==2||finished()[1][2].MPMoviePlayerPlaybackDidFinishReasonUserInfoKey!==1)throw Error('Incorrect missing-movie completion');
  players.close();if(document.querySelector('video'))throw Error('Movie still in DOM after guest stopped');
  return {rgba,readyBeforePlay,notifications:notes.map(n=>n[0])};
}
