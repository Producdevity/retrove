import { MovieNotification, MovieUserInfo } from "./movie-playback";
import { installMovieAccessors } from "./movie-accessors";
import { MOVIE_CLASS, newPlayer, playbackState, resetPlayer } from "./movie-state";
import type { MovieContext, MovieHost, MovieMethod, PlayerState } from "./movie-state";
import { installPlayerMethods } from "./movie-methods";

// MPMoviePlayerController delivers notifications from the guest main thread.
const FINISHED = MovieNotification.PlaybackFinished;
const REASON_KEY = MovieUserInfo.FinishReason;

async function post(
  host: MovieHost,
  notification: string,
  self: number,
  info: unknown = 0,
): Promise<void> {
  const center = await host.send(host.names.get("NSNotificationCenter"), "defaultCenter");
  await host.send(center, "postNotificationName:object:userInfo:", [
    host.string(notification),
    self,
    info,
  ]);
}

async function reportFinish(host: MovieHost, self: number, reason: number): Promise<void> {
  const number = await host.send(host.names.get("NSNumber"), "numberWithInt:", [reason]);
  const info = await host.send(host.names.get("NSDictionary"), "dictionaryWithObject:forKey:", [
    number,
    host.string(REASON_KEY),
  ]);
  await post(host, FINISHED, self, info);
}

async function deliver(context: MovieContext, self: number, player: PlayerState): Promise<void> {
  const { host, players } = context;
  for (const notification of player.loading.take()) {
    if (players.get(self) !== player) break;
    await post(host, notification, self);
  }
  const playing = playbackState(player);
  if (players.get(self) === player && playing !== player.lastState) {
    player.lastState = playing;
    await post(host, MovieNotification.PlaybackStateChanged, self);
  }
  if (players.get(self) !== player || player.reason === undefined || player.reported) return;
  player.reported = true;
  await reportFinish(host, self, player.reason);
}

export function moviePlayers(host: MovieHost) {
  host.hostClass(MOVIE_CLASS, "NSObject");
  const players = new Map<number, PlayerState>();
  let delivering = false;
  const context: MovieContext = {
    host,
    players,
    state(self) {
      let player = players.get(self);
      if (!player) {
        player = newPlayer(host);
        players.set(self, player);
      }
      return player;
    },
    setResume(player, needed) {
      player.needsResume = needed;
      host.needsMovieResume?.([...players.values()].some((entry) => entry.needsResume));
    },
  };
  const method = (selector: string, implementation: MovieMethod) =>
    host.method(MOVIE_CLASS, false, selector, implementation);
  installPlayerMethods(context, method);
  installMovieAccessors(context, method);
  method("dealloc", async (self) => {
    const player = players.get(self);
    if (player) {
      resetPlayer(player);
      players.delete(self);
      await host.release(player.url);
      await host.release(player.view);
    }
    host.destroy(self);
  });
  return {
    videoForView: (view: unknown) =>
      [...players.values()].find((player) => player.view === view)?.video,
    async pump(): Promise<void> {
      if (delivering) return;
      delivering = true;
      try {
        for (const [self, player] of players) await deliver(context, self, player);
      } finally {
        delivering = false;
      }
    },
    close(): void {
      for (const player of players.values()) resetPlayer(player);
      players.clear();
    },
  };
}
