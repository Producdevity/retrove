import { runGuest } from "../../web/runtime.mjs";
import type { IpaArchive } from "../../web/ipa.mjs";
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
export class PlayerSession {
  private readonly controller = new AbortController();
  private failure: unknown;
  private running: Promise<void> | undefined;
  private sound: AudioContext | null = null;
  constructor(
    private readonly library: ApplicationLibrary,
    private readonly app: InstalledApplication,
    private readonly archive: IpaArchive,
    private readonly display: PlayerDisplay,
    private readonly report: SessionReport,
  ) {}
  start(): Promise<void> {
    if (this.running) return this.running;
    this.sound = new AudioContext();
    const resume = this.sound.resume();
    this.running = this.execute(resume);
    return this.running;
  }
  private async execute(audioReady: Promise<void>): Promise<void> {
    try {
      await audioReady;
      await withApplicationSession(this.app.id, async () => {
        await this.library.played(this.app.id);
        await runGuest(this.archive, {
          signal: this.controller.signal,
          graphics: this.display.graphics,
          audioContext: () => this.sound,
          mediaHost: this.display.host,
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
    await this.sound?.resume();
    await Promise.all(
      [...this.display.host.querySelectorAll("video")].map((video) => video.play()),
    );
  }
}
