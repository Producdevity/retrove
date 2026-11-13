import type { VisibilitySource } from "./display-refresh";
export const ApplicationState = { Active: 0, Inactive: 1, Background: 2 } as const;
type ApplicationState = (typeof ApplicationState)[keyof typeof ApplicationState];
export const LifecycleEvent = {
  Active: {
    selector: "applicationDidBecomeActive:",
    notification: "UIApplicationDidBecomeActiveNotification",
  },
  Inactive: {
    selector: "applicationWillResignActive:",
    notification: "UIApplicationWillResignActiveNotification",
  },
  Background: {
    selector: "applicationDidEnterBackground:",
    notification: "UIApplicationDidEnterBackgroundNotification",
  },
  Foreground: {
    selector: "applicationWillEnterForeground:",
    notification: "UIApplicationWillEnterForegroundNotification",
  },
} as const;
type LifecycleEvent = (typeof LifecycleEvent)[keyof typeof LifecycleEvent];
interface LifecycleHost {
  delegate(selector: LifecycleEvent["selector"]): Promise<void>;
  notify(notification: LifecycleEvent["notification"]): Promise<void>;
}
export class ApplicationLifecycle {
  readonly #host: LifecycleHost;
  readonly #pending: boolean[] = [];
  #state: ApplicationState = ApplicationState.Inactive;
  #source: VisibilitySource | undefined;
  #started = false;
  #closed = false;
  #pumping = false;
  constructor(host: LifecycleHost) {
    this.#host = host;
  }
  get state(): ApplicationState {
    return this.#state;
  }
  get active(): boolean {
    return this.#state === ApplicationState.Active;
  }
  readonly #changed = (): void => {
    const visible = !this.#source?.hidden;
    if (this.#pending.at(-1) !== visible) this.#pending.push(visible);
  };
  async #emit(event: LifecycleEvent): Promise<void> {
    await this.#host.delegate(event.selector);
    await this.#host.notify(event.notification);
  }
  async start(source?: VisibilitySource): Promise<void> {
    if (this.#started || this.#closed) throw new Error("Application lifecycle cannot start twice.");
    this.#started = true;
    this.#source = source;
    source?.addEventListener("visibilitychange", this.#changed);
    this.#state = source?.hidden ? ApplicationState.Background : ApplicationState.Active;
    await this.#emit(source?.hidden ? LifecycleEvent.Background : LifecycleEvent.Active);
  }
  async #transition(visible: boolean): Promise<void> {
    if (visible && this.#state === ApplicationState.Background) {
      this.#state = ApplicationState.Inactive;
      await this.#host.notify(LifecycleEvent.Foreground.notification);
      await this.#host.delegate(LifecycleEvent.Foreground.selector);
      this.#state = ApplicationState.Active;
      await this.#emit(LifecycleEvent.Active);
    } else if (!visible && this.#state === ApplicationState.Active) {
      this.#state = ApplicationState.Inactive;
      await this.#emit(LifecycleEvent.Inactive);
      this.#state = ApplicationState.Background;
      await this.#emit(LifecycleEvent.Background);
    }
  }
  async pump(): Promise<void> {
    if (!this.#started || this.#closed) return;
    if (this.#pumping) throw new Error("Application lifecycle cannot be dispatched concurrently.");
    this.#pumping = true;
    try {
      for (const visible of this.#pending.splice(0)) await this.#transition(visible);
    } finally {
      this.#pumping = false;
    }
  }
  close(): void {
    this.#closed = true;
    this.#source?.removeEventListener("visibilitychange", this.#changed);
    this.#pending.length = 0;
  }
}
