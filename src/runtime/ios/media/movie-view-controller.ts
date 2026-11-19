import { Argument } from "../objc/host";
import type { ServiceHost } from "../services/host";
import { objectResult } from "../uikit/host";
import { MovieNotification } from "./movie-playback";

export const MovieClass = {
  ViewController: "MPMoviePlayerViewController",
  Player: "MPMoviePlayerController",
  Controller: "UIViewController",
  NotificationCenter: "NSNotificationCenter",
} as const;
/** MPMovieControlStyleFullscreen, the style a movie view controller gives its player. */
const FULLSCREEN_CONTROLS = 2;
const ANIMATED = 1;
const FINISHED_SELECTOR = "_moviePlayerPlaybackDidFinish:";

export interface MovieViewControllerHost extends ServiceHost {
  classNamed(name: string): number;
  selector(name: string): number;
  deallocController(self: number): Promise<void> | void;
}

interface MovieViewController {
  readonly player: number;
  /** Presented with presentMoviePlayerViewControllerAnimated:, so playback end dismisses it. */
  presenter: number;
}

/** MPMoviePlayerViewController (iOS 3.2): a full-screen controller that owns one movie player. */
export function installMovieViewControllers(host: MovieViewControllerHost): void {
  const CLASS = MovieClass.ViewController;
  host.hostClass(CLASS, MovieClass.Controller);
  const controllers = new Map<number, MovieViewController>();
  const center = async () =>
    objectResult(await host.send(host.classNamed(MovieClass.NotificationCenter), "defaultCenter"));
  host.method(CLASS, false, "initWithContentURL:", async (self, args) => {
    if (controllers.has(self)) return self;
    const player = objectResult(
      await host.send(host.alloc(host.classNamed(MovieClass.Player)), "initWithContentURL:", [
        args(Argument.First),
      ]),
    );
    await host.send(player, "setControlStyle:", [FULLSCREEN_CONTROLS]);
    controllers.set(self, { player, presenter: 0 });
    await host.send(await center(), "addObserver:selector:name:object:", [
      self,
      host.selector(FINISHED_SELECTOR),
      host.string(MovieNotification.PlaybackFinished),
      player,
    ]);
    return self;
  });
  host.method(CLASS, false, "moviePlayer", (self) => controllers.get(self)?.player ?? 0);
  host.method(CLASS, false, "loadView", async (self) => {
    const player = controllers.get(self)?.player;
    if (!player) throw new Error("MPMoviePlayerViewController loaded without a movie player.");
    await host.send(self, "setView:", [objectResult(await host.send(player, "view"))]);
  });
  host.method(CLASS, false, "viewDidAppear:", async (self) => {
    const player = controllers.get(self)?.player;
    if (player && (await host.send(player, "shouldAutoplay"))) await host.send(player, "play");
  });
  host.method(CLASS, false, "viewDidDisappear:", async (self) => {
    const player = controllers.get(self)?.player;
    if (player) await host.send(player, "stop");
  });
  host.method(CLASS, false, "shouldAutorotateToInterfaceOrientation:", () => 1);
  host.method(CLASS, false, FINISHED_SELECTOR, async (self) => {
    const controller = controllers.get(self);
    if (!controller?.presenter) return;
    await host.send(controller.presenter, "dismissMoviePlayerViewControllerAnimated");
  });
  host.method(CLASS, false, "dealloc", async (self) => {
    const controller = controllers.get(self);
    controllers.delete(self);
    if (controller) {
      await host.send(await center(), "removeObserver:", [self]);
      await host.release(controller.player);
    }
    await host.deallocController(self);
  });
  installPresentation(host, controllers);
}

function installPresentation(
  host: MovieViewControllerHost,
  controllers: Map<number, MovieViewController>,
): void {
  const presented = new Map<number, number>();
  host.method(
    MovieClass.Controller,
    false,
    "presentMoviePlayerViewControllerAnimated:",
    async (self, args) => {
      const controller = args(Argument.First);
      const state = controllers.get(controller);
      if (!state || presented.has(self)) return;
      state.presenter = self;
      presented.set(self, controller);
      await host.send(self, "presentModalViewController:animated:", [controller, ANIMATED]);
    },
  );
  host.method(
    MovieClass.Controller,
    false,
    "dismissMoviePlayerViewControllerAnimated",
    async (self) => {
      const controller = presented.get(self) ?? (await host.send(self, "modalViewController"));
      if (typeof controller !== "number" || !controllers.has(controller)) return;
      presented.delete(self);
      const state = controllers.get(controller);
      if (state) state.presenter = 0;
      await host.send(self, "dismissModalViewControllerAnimated:", [ANIMATED]);
    },
  );
}
