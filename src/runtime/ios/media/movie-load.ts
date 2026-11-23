import { MOVIE_OFFSCREEN_EVENT, MOVIE_ONSCREEN_EVENT, MoviePlayback } from "./movie-playback";
import { autoplay, playElement, showFullscreen } from "./movie-presentation";
import { FINISH_ENDED, FINISH_ERROR, FINISH_USER_EXITED, objectFit } from "./movie-state";
import type { MovieContext, PlayerState } from "./movie-state";

const LOAD_EVENTS = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing"];
const STALL_EVENTS = ["waiting", "stalled"];

function createVideo(player: PlayerState, document: Document): HTMLVideoElement {
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.loop = !!player.repeat;
  video.playbackRate = player.rate;
  video.controls = false;
  video.style.objectFit = objectFit(player.scaling);
  return video;
}

function attachPlayback(
  context: MovieContext,
  player: PlayerState,
  video: HTMLVideoElement,
  path: string,
  document: Document,
): void {
  const { diagnostic } = context.host;
  const finish = (reason: number) => {
    if (player.video === video && !player.reported) player.reason = reason;
  };
  player.playback = new MoviePlayback(video, document, {
    // Safari plays sound only after a tap: start muted and unmute on the next tap anywhere.
    needsResume: (needed) => {
      if (needed && !video.muted) {
        video.muted = true;
        diagnostic("info", "movie", "Playing muted until the next tap");
        const unmute = () => {
          if (player.video === video) video.muted = false;
        };
        document.addEventListener("pointerdown", unmute, { once: true, capture: true });
        player.playback?.play();
        return;
      }
      context.setResume(player, needed);
    },
    failed: (error) => {
      diagnostic("warn", "movie", "Movie playback failed", { path, message: String(error) });
      finish(FINISH_ERROR);
    },
  });
  const updateLoad = (waiting = false) => {
    if (player.video === video) player.loading.update(video.readyState, waiting);
  };
  for (const name of LOAD_EVENTS) video.addEventListener(name, () => updateLoad());
  for (const name of STALL_EVENTS) video.addEventListener(name, () => updateLoad(true));
  video.addEventListener("ended", () => finish(FINISH_ENDED));
  // Like the Done button of iOS movie controls: a tap on a full-screen movie with controls ends it.
  video.addEventListener("pointerdown", (event) => {
    if (player.video !== video || !player.controls || "placed" in video.dataset) return;
    event.stopPropagation();
    player.playback?.pause();
    finish(FINISH_USER_EXITED);
  });
  // A game that drops the player's view without stopping it must not keep asking for a tap.
  video.addEventListener(MOVIE_OFFSCREEN_EVENT, () => {
    if (player.video === video) player.playback?.pause();
  });
  video.addEventListener(MOVIE_ONSCREEN_EVENT, () => {
    if (player.video === video) autoplay(player);
  });
  video.addEventListener("error", () => {
    if (player.video !== video) return;
    diagnostic("warn", "movie", "Movie decode failed", { path, code: video.error?.code });
    finish(FINISH_ERROR);
  });
}

async function openAsset(
  context: MovieContext,
  player: PlayerState,
  video: HTMLVideoElement,
  path: string,
  mediaHost: HTMLElement,
): Promise<void> {
  const { ipa, diagnostic } = context.host;
  try {
    const mime = /\.mov$/i.test(path) ? "video/quicktime" : "video/mp4";
    const asset = ipa.assetBlob
      ? await ipa.assetBlob(path)
      : await new Response(await ipa.stream(path)).blob();
    const blob = asset.slice(0, asset.size, mime);
    if (player.video !== video) return;
    player.blobURL = URL.createObjectURL(blob);
    video.src = player.blobURL;
    mediaHost.append(video);
    diagnostic("info", "movie", "Opened movie from bundle", { path, bytes: blob.size });
    if ((player.prepared && player.autoplay) || player.wantsPlay) playElement(player);
  } catch (error) {
    diagnostic("warn", "movie", "Movie asset read failed", { path, message: String(error) });
    if (player.video === video && !player.reported) player.reason = FINISH_ERROR;
  }
}

export async function loadMovie(context: MovieContext, self: number): Promise<void> {
  const { host } = context,
    player = context.state(self);
  if (!player.url || player.video || player.reason !== undefined || player.reported) return;
  const path = host.text(await host.send(player.url, "path")).replace(/^\/+/, "");
  const entry = host.ipa.entries?.get(path),
    { mediaHost } = host;
  if (!entry || !mediaHost) {
    player.reason = FINISH_ERROR;
    host.diagnostic("warn", "movie", entry ? "Video output unavailable" : "Movie asset missing", {
      path,
    });
    return;
  }
  const document = mediaHost.ownerDocument;
  const video = createVideo(player, document);
  player.video = video;
  attachPlayback(context, player, video, path, document);
  if (player.fullscreen) showFullscreen(player);
  await openAsset(context, player, video, path, mediaHost);
}
