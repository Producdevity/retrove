import { FULLSCREEN_LAYER } from "./movie-state";
import type { PlayerState } from "./movie-state";

export function playElement(player: PlayerState): void {
  if (player.video?.src) player.playback?.play();
}

/** Like iOS, a player that should autoplay starts once it is on screen, even if never told to play. */
export function autoplay(player: PlayerState): void {
  if (!player.video || !player.autoplay || player.autoplayed) return;
  player.autoplayed = true;
  player.prepared = true;
  if (player.video.src) playElement(player);
  else player.wantsPlay = true;
}

/**
 * A full-screen movie covers the screen in its own window, unless its view is on screen: iOS
 * ignores full screen for a view in a window, which games use for menu backgrounds.
 */
export function showFullscreen(player: PlayerState): void {
  const { video } = player;
  if (!video || ("placed" in video.dataset && video.style.display !== "none")) return;
  if (player.fullscreen) {
    Object.assign(video.style, {
      display: "",
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      transform: "",
      clipPath: "none",
      opacity: "1",
      zIndex: String(FULLSCREEN_LAYER),
      pointerEvents: player.controls ? "auto" : "none",
    });
    delete video.dataset.placed;
    autoplay(player);
  } else if (!("placed" in video.dataset)) video.style.display = "none";
}
