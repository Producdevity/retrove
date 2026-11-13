import type { VisibilitySource } from "../../runtime/ios/uikit/application/display-refresh";
interface AudioHost extends EventTarget {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}
export class AudioVisibility {
  #closed = false;
  #suspending = false;
  constructor(
    private readonly audio: AudioHost,
    private readonly visibility: VisibilitySource,
    private readonly needsResume: (needed: boolean) => void,
    private readonly failed: (error: unknown) => void,
  ) {
    visibility.addEventListener("visibilitychange", this.changed);
    audio.addEventListener("statechange", this.stateChanged);
    if (visibility.hidden) this.suspend();
  }
  private readonly update = (): void => {
    if (!this.#closed)
      this.needsResume(
        !this.visibility.hidden && this.audio.state !== "running" && this.audio.state !== "closed",
      );
  };
  private suspend(): void {
    if (this.#suspending || this.audio.state !== "running" || this.#closed) return;
    this.#suspending = true;
    void this.audio
      .suspend()
      .catch((error: unknown) => {
        if (!this.#closed) this.failed(error);
      })
      .finally(() => {
        this.#suspending = false;
        this.update();
      });
  }
  private readonly stateChanged = (): void => {
    if (this.visibility.hidden) this.suspend();
    this.update();
  };
  private readonly changed = (): void => {
    if (this.visibility.hidden) this.suspend();
    else
      void this.resume().catch((error: unknown) => {
        if (!this.#closed) this.failed(error);
      });
    this.update();
  };
  async resume(): Promise<void> {
    if (this.#closed || this.visibility.hidden || this.audio.state === "closed") return;
    try {
      await this.audio.resume();
      if (this.visibility.hidden) this.suspend();
    } finally {
      this.update();
    }
  }
  close(): void {
    this.#closed = true;
    this.visibility.removeEventListener("visibilitychange", this.changed);
    this.audio.removeEventListener("statechange", this.stateChanged);
    this.needsResume(false);
  }
}
