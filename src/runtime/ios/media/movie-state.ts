import type { GuestArguments, HostResult } from "../objc/host";

export type MovieMethod = (self: number, args: GuestArguments) => HostResult | Promise<HostResult>;
import { MovieLoading } from "./movie-loading";
import type { MoviePlayback } from "./movie-playback";

export const MovieControl = { Hidden: 2, StyleFullscreen: 2 } as const;
export const FULLSCREEN_LAYER = 10000;
export const FINISH_USER_EXITED = 2;
export const FINISH_ERROR = 1;
export const FINISH_ENDED = 0;
export const MOVIE_CLASS = "MPMoviePlayerController";
const SCALING_FITS = ["none", "contain", "cover", "fill"];
const DEFAULT_FIT = "contain";
const MAX_RATE = 4;

export type MovieDiagnostic = (
  level: string,
  area: string,
  message: string,
  details?: unknown,
) => void;
export interface MovieArchive {
  readonly entries?: ReadonlyMap<string, unknown>;
  assetBlob?(path: string): Promise<Blob>;
  stream(path: string): Promise<ReadableStream<Uint8Array>>;
}
export interface MovieHost {
  hostClass(name: string, parent: string): unknown;
  method(
    className: string,
    classMethod: boolean,
    selector: string,
    implementation: MovieMethod,
  ): void;
  names: ReadonlyMap<string, unknown>;
  alloc(classPointer: unknown): number;
  destroy(pointer: number): void;
  retain(pointer: number): number;
  release(pointer: number): unknown;
  string(value: string): unknown;
  text(pointer: unknown): string;
  send(self: unknown, selector: string, args?: readonly unknown[]): Promise<unknown>;
  ipa: MovieArchive;
  mediaHost: HTMLElement | null | undefined;
  diagnostic: MovieDiagnostic;
  needsMovieResume?: ((needed: boolean) => void) | undefined;
}
export interface PlayerState {
  view: number;
  url: number;
  rate: number;
  loading: MovieLoading;
  prepared: boolean;
  scaling: number;
  autoplay: number;
  controls: number;
  repeat: number;
  fullscreen: number;
  source: number;
  needsResume: boolean;
  playback: MoviePlayback | null;
  video: HTMLVideoElement | null;
  blobURL: string | null;
  reason: number | undefined;
  reported: boolean;
  wantsPlay: boolean;
  autoplayed: boolean;
  appAudioSession: boolean;
  lastState: number;
}
export interface MovieContext {
  host: MovieHost;
  players: Map<number, PlayerState>;
  state(self: number): PlayerState;
  setResume(player: PlayerState, needed: boolean): void;
}

export function newPlayer(host: MovieHost): PlayerState {
  const view = host.names.get("UIView");
  return {
    view: host.alloc(view),
    url: 0,
    rate: 1,
    loading: new MovieLoading(),
    prepared: false,
    scaling: 1,
    autoplay: 1,
    controls: 1,
    repeat: 0,
    fullscreen: 0,
    source: 0,
    needsResume: false,
    playback: null,
    video: null,
    blobURL: null,
    reason: undefined,
    reported: false,
    wantsPlay: false,
    autoplayed: false,
    appAudioSession: true,
    lastState: 0,
  };
}

export function objectFit(scaling: number): string {
  return SCALING_FITS[scaling] ?? DEFAULT_FIT;
}
export function validRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate <= MAX_RATE;
}

export function resetPlayer(player: PlayerState): void {
  player.loading.reset();
  player.prepared = false;
  player.playback?.close();
  player.playback = null;
  player.video?.remove();
  if (player.blobURL) URL.revokeObjectURL(player.blobURL);
  player.video = null;
  player.blobURL = null;
  player.reason = undefined;
  player.reported = false;
  player.wantsPlay = false;
  player.autoplayed = false;
}

export const PlaybackState = { Stopped: 0, Playing: 1, Paused: 2 } as const;

export function playbackState(player: PlayerState): number {
  const { video } = player;
  if (!video || video.ended) return PlaybackState.Stopped;
  return video.paused ? PlaybackState.Paused : PlaybackState.Playing;
}
