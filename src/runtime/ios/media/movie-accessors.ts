import { Argument } from "../objc/host";
import { showFullscreen, playElement } from "./movie-presentation";
import { MovieControl, objectFit, validRate } from "./movie-state";
import type { MovieContext, MovieMethod, PlayerState } from "./movie-state";

const floatBits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
const WORD_BYTES = 4;

type NumericField = "scaling" | "controls" | "repeat" | "autoplay" | "fullscreen" | "source";
const FIELDS: readonly (readonly [string, string, NumericField])[] = [
  ["scalingMode", "setScalingMode:", "scaling"],
  ["controlStyle", "setControlStyle:", "controls"],
  ["repeatMode", "setRepeatMode:", "repeat"],
  ["shouldAutoplay", "setShouldAutoplay:", "autoplay"],
  ["isFullscreen", "setFullscreen:", "fullscreen"],
  ["movieSourceType", "setMovieSourceType:", "source"],
];

function applyField(player: PlayerState, field: NumericField): void {
  const { video } = player;
  if (!video) return;
  if (field === "repeat") video.loop = !!player.repeat;
  if (field === "scaling") video.style.objectFit = objectFit(player.scaling);
  if (field === "fullscreen") showFullscreen(player);
}

function installFields(context: MovieContext, method: Installer): void {
  for (const [getter, setter, field] of FIELDS) {
    method(getter, (self) => context.state(self)[field] || 0);
    method(setter, (self, args) => {
      const player = context.state(self);
      player[field] = args(Argument.First);
      applyField(player, field);
    });
  }
}

function installControls(context: MovieContext, method: Installer): void {
  const { host } = context;
  // iOS 3.1 MPMovieControlMode: only MPMovieControlModeHidden removes the playback controls.
  method("setMovieControlMode:", (self, args) =>
    host
      .send(self, "setControlStyle:", [
        args(Argument.First) === MovieControl.Hidden ? 0 : MovieControl.StyleFullscreen,
      ])
      .then(() => undefined),
  );
  method("movieControlMode", (self) => (context.state(self).controls ? 0 : MovieControl.Hidden));
  method("useApplicationAudioSession", (self) => Number(context.state(self).appAudioSession));
  method("setUseApplicationAudioSession:", (self, args) => {
    context.state(self).appAudioSession = !!args(Argument.First);
  });
  method("setFullscreen:animated:", (self, args) => {
    const player = context.state(self);
    player.fullscreen = args(Argument.First);
    showFullscreen(player);
  });
}

function installRate(context: MovieContext, method: Installer): void {
  method("setCurrentPlaybackRate:", (self, args) => {
    const player = context.state(self);
    floatBits.setUint32(0, args(Argument.First), true);
    const rate = floatBits.getFloat32(0, true);
    if (rate === 0) {
      player.wantsPlay = false;
      player.playback?.pause();
      return;
    }
    if (validRate(rate)) {
      player.rate = rate;
      if (player.video) {
        player.video.playbackRate = rate;
        playElement(player);
      }
    }
  });
  method("currentPlaybackRate", (self) => {
    const { video, rate } = context.state(self);
    floatBits.setFloat32(0, video && !video.paused ? rate : 0, true);
    return floatBits.getUint32(0, true);
  });
}

function installTimes(context: MovieContext, method: Installer): void {
  const reading = (selector: string, read: (video: HTMLVideoElement) => number) =>
    method(selector, (self) => {
      const video = context.state(self).video,
        value = video ? read(video) : undefined;
      floatBits.setFloat64(0, value !== undefined && Number.isFinite(value) ? value : 0, true);
      return floatBits.getBigUint64(0, true);
    });
  reading("duration", (video) => video.duration);
  reading("currentPlaybackTime", (video) => video.currentTime);
  method("setCurrentPlaybackTime:", (self, args) => {
    floatBits.setUint32(0, args(Argument.First), true);
    floatBits.setUint32(WORD_BYTES, args(Argument.Second), true);
    const time = floatBits.getFloat64(0, true),
      video = context.state(self).video;
    if (video && Number.isFinite(time)) video.currentTime = Math.max(0, time);
  });
}

type Installer = (selector: string, implementation: MovieMethod) => void;

export function installMovieAccessors(context: MovieContext, method: Installer): void {
  installFields(context, method);
  installControls(context, method);
  installRate(context, method);
  installTimes(context, method);
}
