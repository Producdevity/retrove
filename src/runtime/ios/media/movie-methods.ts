import { Argument } from "../objc/host";
import type { GuestArguments } from "../objc/host";
import { loadMovie } from "./movie-load";
import { MovieLoadState } from "./movie-loading";
import { playElement } from "./movie-presentation";
import { playbackState, resetPlayer } from "./movie-state";
import type { MovieContext, MovieMethod } from "./movie-state";

export function installPlayerMethods(
  context: MovieContext,
  method: (selector: string, implementation: MovieMethod) => void,
): void {
  const { host } = context;
  async function prepare(self: number): Promise<void> {
    const player = context.state(self);
    player.prepared = true;
    await loadMovie(context, self);
    if (player.autoplay || player.wantsPlay) playElement(player);
  }
  async function setURL(self: number, args: GuestArguments): Promise<number> {
    const player = context.state(self),
      old = player.url;
    player.url = host.retain(args(Argument.First));
    resetPlayer(player);
    await host.release(old);
    await loadMovie(context, self);
    return self;
  }
  method("initWithContentURL:", setURL);
  method("setContentURL:", setURL);
  method("contentURL", (self) => context.state(self).url);
  method("view", (self) => context.state(self).view);
  method("prepareToPlay", prepare);
  method("play", async (self) => {
    const player = context.state(self);
    player.wantsPlay = true;
    player.prepared = true;
    if (!player.video) await prepare(self);
    else playElement(player);
  });
  method("pause", (self) => {
    const player = context.state(self);
    player.wantsPlay = false;
    player.playback?.pause();
  });
  method("stop", (self) => resetPlayer(context.state(self)));
  method("playbackState", (self) => playbackState(context.state(self)));
  method("loadState", (self) => context.state(self).loading.state);
  method("isPreparedToPlay", (self) => {
    const player = context.state(self);
    return Number(player.prepared && (player.loading.state & MovieLoadState.Playable) !== 0);
  });
}
