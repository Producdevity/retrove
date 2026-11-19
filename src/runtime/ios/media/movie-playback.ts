/** Sent to a movie's video element when its player's view is no longer on screen. */
export const MOVIE_OFFSCREEN_EVENT = "retrove:movie-offscreen";
/** Sent to a movie's video element when its player's view comes on screen. */
export const MOVIE_ONSCREEN_EVENT = "retrove:movie-onscreen";
export const MovieNotification = {
  PlaybackFinished: "MPMoviePlayerPlaybackDidFinishNotification",
  LoadStateChanged: "MPMoviePlayerLoadStateDidChangeNotification",
  ScalingChanged: "MPMoviePlayerScalingModeDidChangeNotification",
  ContentPreloaded: "MPMoviePlayerContentPreloadDidFinishNotification",
  PlaybackStateChanged: "MPMoviePlayerPlaybackStateDidChangeNotification",
  WillEnterFullscreen: "MPMoviePlayerWillEnterFullscreenNotification",
  DidEnterFullscreen: "MPMoviePlayerDidEnterFullscreenNotification",
  WillExitFullscreen: "MPMoviePlayerWillExitFullscreenNotification",
  DidExitFullscreen: "MPMoviePlayerDidExitFullscreenNotification",
  NaturalSizeAvailable: "MPMovieNaturalSizeAvailableNotification",
} as const;
export const MovieUserInfo = {
  FinishReason: "MPMoviePlayerPlaybackDidFinishReasonUserInfoKey",
} as const;
import type { VisibilitySource } from "../uikit/application/display-refresh";
export interface MovieElement extends EventTarget {
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
}
interface PlaybackEvents {
  needsResume(needed: boolean): void;
  failed(error: unknown): void;
}
export class MoviePlayback {
  #wanted = false;
  #closed = false;
  #revision = 0;
  #ownedPauses = 0;
  constructor(
    private readonly video: MovieElement,
    private readonly visibility: VisibilitySource,
    private readonly events: PlaybackEvents,
  ) {
    visibility.addEventListener("visibilitychange", this.visibilityChanged);
    video.addEventListener("play", this.played);
    video.addEventListener("pause", this.paused);
    video.addEventListener("ended", this.ended);
  }
  private pauseElement(): void {
    if (!this.video.paused) this.#ownedPauses++;
    this.video.pause();
  }
  private readonly played = (): void => {
    if (this.video.paused) return;
    this.#wanted = true;
    this.events.needsResume(false);
    if (this.visibility.hidden) this.pauseElement();
  };
  private readonly paused = (): void => {
    if (this.#ownedPauses) this.#ownedPauses--;
    else if (this.video.paused) {
      this.#wanted = false;
      this.#revision++;
      this.events.needsResume(false);
    }
  };
  private readonly ended = (): void => {
    this.events.needsResume(false);
    this.#wanted = false;
    this.#revision++;
  };
  private readonly visibilityChanged = (): void => {
    this.#revision++;
    if (this.visibility.hidden) this.pauseElement();
    else if (this.#wanted && !this.video.ended) this.play();
  };
  play(): void {
    if (this.#closed) return;
    this.#wanted = true;
    const revision = ++this.#revision;
    if (this.visibility.hidden) return;
    void this.video.play().catch((error: unknown) => {
      if (this.#closed || revision !== this.#revision) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError")
        this.events.needsResume(true);
      else {
        this.events.needsResume(false);
        this.events.failed(error);
      }
    });
  }
  pause(): void {
    if (this.#closed) return;
    this.#wanted = false;
    this.#revision++;
    this.events.needsResume(false);
    this.pauseElement();
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#revision++;
    this.events.needsResume(false);
    this.visibility.removeEventListener("visibilitychange", this.visibilityChanged);
    this.video.removeEventListener("play", this.played);
    this.video.removeEventListener("pause", this.paused);
    this.video.removeEventListener("ended", this.ended);
    this.video.pause();
  }
}
