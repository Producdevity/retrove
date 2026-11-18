import {MovieLoading,MovieLoadState} from "../src/runtime/ios/media/movie-loading.ts";
import {MoviePlayback,MovieNotification,MovieUserInfo} from '../src/runtime/ios/media/movie-playback.ts';
// MPMoviePlayerController delivers notifications from the guest main thread.
const finished = MovieNotification.PlaybackFinished;
const reasonKey = MovieUserInfo.FinishReason;
const floatBits = new DataView(new ArrayBuffer(8));

export function moviePlayers({hostClass, method, names, alloc, destroy, retain, release, string, text, send,
  ipa, mediaHost, diagnostic, needsMovieResume = () => {}}) {
  const cls = 'MPMoviePlayerController', players = new Map();
  hostClass(cls, 'NSObject');
  let delivering = false;
  function state(self) {
    if (!players.has(self)) players.set(self, {view: alloc(names.get('UIView')), url: 0, rate: 1,
      loading:new MovieLoading(), prepared:false, scaling: 1, autoplay: 1, controls: 1, repeat: 0, fullscreen: 0});
    return players.get(self);
  }
  function setResume(s, needed) {
    s.needsResume = needed;
    needsMovieResume([...players.values()].some(player => player.needsResume));
  }
  function reset(s) {
    s.loading.reset();s.prepared=false;
    s.playback?.close();
    s.playback = null;
    s.video?.remove();
    if (s.blobURL) URL.revokeObjectURL(s.blobURL);
    s.video = null; s.blobURL = null; s.reason = undefined; s.reported = false; s.wantsPlay = false;
  }
  async function setURL(self, a) {
    const s = state(self), old = s.url;
    s.url = retain(a(0)); reset(s);
    await release(old);
    await load(self);
    return self;
  }
  async function load(self) {
    const s = state(self);
    if (!s.url || s.video || s.reason !== undefined || s.reported) return;
    const path = text(await send(s.url, 'path')).replace(/^\/+/, '');
    const entry = ipa.entries?.get(path);
    if (!entry || !mediaHost) {
      s.reason = 1;
      diagnostic('warn', 'movie', entry ? 'Video output unavailable' : 'Movie asset missing', {path});
      return;
    }
    const video = mediaHost.ownerDocument.createElement('video');
    s.video = video;
    video.playsInline = true; video.preload = 'auto'; video.loop = !!s.repeat;
    video.playbackRate = s.rate; video.controls = !!s.controls;
    video.style.objectFit = ['none','contain','cover','fill'][s.scaling] ?? 'contain';
    const finish = reason => { if (s.video === video && !s.reported) s.reason = reason; };
    s.playback = new MoviePlayback(video, mediaHost.ownerDocument, {
      needsResume: needed => {
        if (needed) {
          video.controls = true;
          diagnostic('info', 'movie', 'Tap the video play control to start playback');
        }
        setResume(s, needed);
      },
      failed: error => {
        diagnostic('warn', 'movie', 'Movie playback failed', {path, message: String(error)});
        finish(1);
      },
    });
    const updateLoad=(waiting=false)=>{if(s.video===video)s.loading.update(video.readyState,waiting);};
    for(const name of ['loadedmetadata','loadeddata','canplay','canplaythrough','playing'])video.addEventListener(name,()=>updateLoad());
    for(const name of ['waiting','stalled'])video.addEventListener(name,()=>updateLoad(true));
    video.addEventListener('ended', () => finish(0));
    video.addEventListener('error', () => {
      if (s.video !== video) return;
      diagnostic('warn', 'movie', 'Movie decode failed', {path, code: video.error?.code});
      finish(1);
    });
    try {
      const mime = /\.mov$/i.test(path) ? 'video/quicktime' : 'video/mp4';
      const asset = ipa.assetBlob ? await ipa.assetBlob(path) : await new Response(await ipa.stream(path)).blob();
      const blob = asset.slice(0,asset.size,mime);
      if (s.video !== video) return;
      video.src = s.blobURL = URL.createObjectURL(blob);
      mediaHost.append(video);
      diagnostic('info', 'movie', 'Opened movie from bundle', {path, bytes: blob.size});
      if ((s.prepared && s.autoplay) || s.wantsPlay) playElement(s);
    } catch (err) {
      diagnostic('warn', 'movie', 'Movie asset read failed', {path, message: String(err)});
      finish(1);
    }
  }
  async function prepare(self) {const s=state(self);s.prepared=true;await load(self);if(s.autoplay||s.wantsPlay)playElement(s);}
  function playElement(s) {
    if (s.video?.src) s.playback.play();
  }
  method(cls, false, 'initWithContentURL:', setURL);
  method(cls, false, 'setContentURL:', setURL);
  method(cls, false, 'contentURL', s => state(s).url);
  method(cls, false, 'view', s => state(s).view);
  method(cls, false, 'prepareToPlay', prepare);
  method(cls, false, 'play', async self => {
    const s = state(self); s.wantsPlay = true;s.prepared=true;
    if (!s.video) await prepare(self); else playElement(s);
  });
  method(cls, false, 'pause', self => { const s = state(self); s.wantsPlay = false; s.playback?.pause(); });
  method(cls, false, 'stop', self => reset(state(self)));
  method(cls, false, 'playbackState', self => {
    const v = state(self).video;
    return !v || v.ended ? 0 : v.paused ? 2 : 1;
  });
  method(cls, false, 'loadState', self => state(self).loading.state);
  method(cls, false, 'isPreparedToPlay', self => Number(state(self).prepared && (state(self).loading.state & MovieLoadState.Playable)!==0));
  for (const [getter, setter, field] of [
    ['scalingMode','setScalingMode:','scaling'], ['controlStyle','setControlStyle:','controls'],
    ['repeatMode','setRepeatMode:','repeat'], ['shouldAutoplay','setShouldAutoplay:','autoplay'],
    ['isFullscreen','setFullscreen:','fullscreen'], ['movieSourceType','setMovieSourceType:','source']
  ]) {
    method(cls, false, getter, self => state(self)[field] || 0);
    method(cls, false, setter, (self, a) => {
      const s = state(self); s[field] = a(0);
      if (!s.video) return;
      if (field === 'repeat') s.video.loop = !!s.repeat;
      if (field === 'controls') s.video.controls = !!s.controls;
      if (field === 'scaling') s.video.style.objectFit = ['none','contain','cover','fill'][s.scaling] ?? 'contain';
    });
  }
  method(cls, false, 'setFullscreen:animated:', (self,a) => { state(self).fullscreen = a(0); });
  method(cls, false, 'setCurrentPlaybackRate:', (self,a) => {
    const s = state(self);
    floatBits.setUint32(0,a(0),true); const rate = floatBits.getFloat32(0,true);
    if (rate === 0) { s.wantsPlay = false; s.playback?.pause(); return; }
    if (Number.isFinite(rate) && rate > 0 && rate <= 4) {
      s.rate = rate;
      if (s.video) { s.video.playbackRate = rate; playElement(s); }
    }
  });
  method(cls, false, 'currentPlaybackRate', self => {
    const s = state(self); floatBits.setFloat32(0, s.video && !s.video.paused ? s.rate : 0,true);
    return floatBits.getUint32(0,true);
  });
  for (const [selector, key] of [['duration','duration'],['currentPlaybackTime','currentTime']]) {
    method(cls, false, selector, self => {
      const value = state(self).video?.[key];
      floatBits.setFloat64(0, Number.isFinite(value) ? value : 0,true);
      return floatBits.getBigUint64(0,true);
    });
  }
  method(cls, false, 'setCurrentPlaybackTime:', (self,a) => {
    floatBits.setUint32(0,a(0),true); floatBits.setUint32(4,a(1),true);
    const time = floatBits.getFloat64(0,true), v = state(self).video;
    if (v && Number.isFinite(time)) v.currentTime = Math.max(0,time);
  });
  method(cls, false, 'dealloc', async self => {
    const s = players.get(self);
    if (s) { reset(s); players.delete(self); await release(s.url); await release(s.view); }
    destroy(self);
  });
  return {
    videoForView: view => [...players.values()].find(player => player.view === view)?.video,
    async pump() {
      if (delivering) return;
      delivering = true;
      try {
        for (const [self,s] of players) {
          for(const notification of s.loading.take()){
            if(players.get(self)!==s)break;
            const center=await send(names.get('NSNotificationCenter'),'defaultCenter');
            await send(center,'postNotificationName:object:userInfo:',[string(notification),self,0]);
          }
          if (players.get(self)!==s || s.reason === undefined || s.reported) continue;
          s.reported = true;
          const reason = await send(names.get('NSNumber'), 'numberWithInt:', [s.reason]);
          const info = await send(names.get('NSDictionary'), 'dictionaryWithObject:forKey:', [reason,string(reasonKey)]);
          const center = await send(names.get('NSNotificationCenter'), 'defaultCenter');
          await send(center, 'postNotificationName:object:userInfo:', [string(finished), self, info]);
        }
      } finally { delivering = false; }
    },
    close() { for (const s of players.values()) reset(s); players.clear(); }
  };
}
