import { DISPLAY_INTERVAL_MS } from "../ios/uikit/application/display-refresh";

/** Without a browser frame for this long (hidden page, throttled timers) presents are not held. */
const STALLED_FRAMES = 2;

type RequestFrame = (callback: () => void) => unknown;

/**
 * One present per display refresh, like presentRenderbuffer on iOS, which waits for the screen
 * once a frame is queued. Presents beyond that were never shown and took time from game logic.
 */
export class PresentPacing {
  #frame = 0;
  #presented = -1;
  #lastFrameAt: number;
  #closed = false;
  constructor(
    private readonly request: RequestFrame | undefined = globalThis.requestAnimationFrame?.bind(
      globalThis,
    ),
    now = performance.now(),
  ) {
    this.#lastFrameAt = now;
    this.request?.(this.#tick);
  }
  readonly #tick = (): void => {
    if (this.#closed) return;
    this.#frame++;
    this.#lastFrameAt = performance.now();
    this.request?.(this.#tick);
  };
  /** Whether a present may go to the screen now; records it when so. */
  take(now: number): boolean {
    if (!this.request || now - this.#lastFrameAt > STALLED_FRAMES * DISPLAY_INTERVAL_MS) {
      this.#frame++;
      this.#lastFrameAt = now;
    }
    if (this.#presented === this.#frame) return false;
    this.#presented = this.#frame;
    return true;
  }
  close(): void {
    this.#closed = true;
  }
}
