import { waitForPlayback } from "./media/wait-for-playback";
import { AudioVisibility } from "./media/audio-visibility";
import { runGuest } from "../runtime/ios/runtime/runtime";
import type { IpaArchive } from "../runtime/ios/package/ipa";
import type { InstalledApplication } from "../domain/application";
import { errorMessage } from "../domain/validation";
import type { ApplicationLibrary } from "../library/service";
import type { SessionReport } from "./report";
import type { PlayerDisplay } from "./display";
import { withApplicationSession } from "../runtime/session-lock";
function causedBy(error: unknown, reason: unknown): boolean {
  const visited = new Set<unknown>();
  for (
    let current = error;
    current && !visited.has(current);
    current = current instanceof Error ? current.cause : undefined
  ) {
    if (current === reason) return true;
    visited.add(current);
  }
  return false;
}
interface MediaResume {
  readonly audio: (needed: boolean) => void;
  readonly movie: (needed: boolean) => void;
}
export class PlayerSession {
  private readonly controller = new AbortController();
  private failure: unknown;
  private running: Promise<void> | undefined;
  private sound: AudioContext | null = null;
  private audioVisibility: AudioVisibility | undefined;
  constructor(
    private readonly library: ApplicationLibrary,
    private readonly app: InstalledApplication,
    private readonly archive: IpaArchive,
    private readonly display: PlayerDisplay,
    private readonly report: SessionReport,
    private readonly mediaResume: MediaResume,
  ) {}
  start(): Promise<void> {
    if (this.running) return this.running;
    this.sound = new AudioContext();
    this.audioVisibility = new AudioVisibility(
      this.sound,
      this.display.host.ownerDocument,
      this.mediaResume.audio,
      (error) => this.report.diagnostic("warn", "audio", errorMessage(error)),
    );
    void this.audioVisibility.resume(this.controller.signal).catch((error: unknown) => {
      if (!this.controller.signal.aborted)
        this.report.diagnostic("warn", "audio", errorMessage(error));
    });
    this.running = this.execute();
    return this.running;
  }
  private async execute(): Promise<void> {
    try {
      await withApplicationSession(this.app.id, async () => {
        await this.library.played(this.app.id);
        await runGuest(this.archive, {
          signal: this.controller.signal,
          graphics: this.display.graphics,
          offscreenGraphics: this.display.offscreen,
          audioContext: () => this.sound,
          mediaHost: this.display.host,
          needsMovieResume: this.mediaResume.movie,
          diagnostic: this.report.diagnostic,
          report: this.report.snapshot,
          log: (message) => this.report.diagnostic("debug", "guest-output", message),
        });
      });
      this.report.finish("completed", "App exited");
    } catch (error) {
      if (this.controller.signal.aborted && causedBy(error, this.controller.signal.reason))
        this.report.finish("stopped", "App closed");
      else {
        this.failure = error;
        this.report.finish("failed", errorMessage(error));
        throw error;
      }
    } finally {
      this.audioVisibility?.close();
      this.display.close();
      if (this.sound && this.sound.state !== "closed") await this.sound.close();
    }
  }
  abort(reason: Error = new DOMException("App closed", "AbortError")): void {
    this.controller.abort(reason);
  }
  async stop(): Promise<void> {
    this.abort();
    try {
      await this.running;
    } catch (error) {
      if (error !== this.failure) throw error;
    }
  }
  async resumeMedia(): Promise<void> {
    await Promise.all([
      this.audioVisibility?.resume(this.controller.signal),
      ...[...this.display.host.querySelectorAll("video")]
        .filter((video) => video.style.display !== "none")
        .map((video) => waitForPlayback(video.play(), this.controller.signal)),
    ]);
  }
}
