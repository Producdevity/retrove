import { doubleBits, floatBits, floatFromBits } from "../abi/scalars";
import type { FoundationHost } from "../objc/host";

export const MusicPlayerSymbols = {
  _MPMusicPlayerControllerPlaybackStateDidChangeNotification:
    "MPMusicPlayerControllerPlaybackStateDidChangeNotification",
  _MPMusicPlayerControllerNowPlayingItemDidChangeNotification:
    "MPMusicPlayerControllerNowPlayingItemDidChangeNotification",
  _MPMusicPlayerControllerVolumeDidChangeNotification:
    "MPMusicPlayerControllerVolumeDidChangeNotification",
} as const;
const CLASS = "MPMusicPlayerController";
const PlaybackState = { Stopped: 0 } as const;
const MusicMode = { Default: 0 } as const;

/**
 * MPMusicPlayerController without a media library: the browser has no iPod library, so the
 * player is always stopped with nothing queued, and games keep their own soundtrack.
 */
export function installMusicPlayer(
  host: Pick<FoundationHost, "hostClass" | "method" | "alloc">,
): void {
  host.hostClass(CLASS, "NSObject");
  const players = new Map<string, number>();
  let volume = 1;
  for (const name of ["iPodMusicPlayer", "applicationMusicPlayer", "systemMusicPlayer"])
    host.method(CLASS, true, name, (self) => {
      let player = players.get(name);
      if (!player) players.set(name, (player = host.alloc(self)));
      return player;
    });
  host.method(CLASS, false, "playbackState", () => PlaybackState.Stopped);
  host.method(CLASS, false, "nowPlayingItem", () => 0);
  host.method(CLASS, false, "volume", () => floatBits(volume));
  host.method(CLASS, false, "setVolume:", (_, args) => {
    const value = floatFromBits(args(0));
    if (Number.isFinite(value)) volume = Math.min(1, Math.max(0, value));
  });
  for (const getter of ["shuffleMode", "repeatMode"])
    host.method(CLASS, false, getter, () => MusicMode.Default);
  host.method(CLASS, false, "currentPlaybackTime", () => doubleBits(0));
  for (const selector of [
    "play",
    "pause",
    "stop",
    "skipToNextItem",
    "skipToPreviousItem",
    "skipToBeginning",
    "beginSeekingForward",
    "beginSeekingBackward",
    "endSeeking",
    "beginGeneratingPlaybackNotifications",
    "endGeneratingPlaybackNotifications",
    "setQueueWithQuery:",
    "setQueueWithItemCollection:",
    "setNowPlayingItem:",
    "setShuffleMode:",
    "setRepeatMode:",
    "setCurrentPlaybackTime:",
  ])
    host.method(CLASS, false, selector, () => undefined);
}
