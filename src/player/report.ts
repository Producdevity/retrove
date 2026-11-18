import { connectCopy } from "../diagnostics/clipboard";
import { DiagnosticRecorder } from "../../web/diagnostics.mjs";
import type { Diagnostic } from "../../web/ipa.mjs";
import { isRecord } from "../domain/validation";
import { saveLastReport } from "../diagnostics/activity";
import { archiveLastReport } from "../diagnostics/session-store";
import { element } from "../ui/dom";
import { phaseLabel } from "../diagnostics/session-detail";
import { shareReport } from "../diagnostics/session-sheet";
import { formatDuration } from "../diagnostics/sessions-view";
const REPORT_INTERVAL = 5000;
const MILLISECONDS_PER_SECOND = 1000;
interface Progress {
  readonly phase: string;
  readonly frames: number;
  readonly elapsed: number;
  readonly fps: number | undefined;
  readonly fault: string | null;
}
function progress(value: unknown): Progress | undefined {
  if (!isRecord(value) || typeof value.phase !== "string" || typeof value.elapsedMs !== "number")
    return;
  const frames =
    isRecord(value.render) && typeof value.render.presentedFrames === "number"
      ? value.render.presentedFrames
      : 0;
  const fault =
    isRecord(value.fault) && typeof value.fault.message === "string" ? value.fault.message : null;
  const fps =
    isRecord(value.frameTimings) && typeof value.frameTimings.fps === "number"
      ? value.frameTimings.fps
      : undefined;
  return { phase: value.phase, elapsed: value.elapsedMs, frames, fps, fault };
}
export class SessionReport {
  private readonly recorder = new DiagnosticRecorder();
  private readonly log = element("log", HTMLTextAreaElement);
  private readonly dialog = element("report-dialog", HTMLDialogElement);
  private readonly summary = element("summary", HTMLParagraphElement);
  private lastWrite = 0;
  private app = "App";
  constructor(
    private readonly onProgress: (value: Progress) => void,
    private readonly onMessage: Diagnostic,
  ) {
    connectCopy(
      element("copy-log", HTMLButtonElement),
      this.log,
      element("copy-status", HTMLParagraphElement),
      () => this.store(),
    );
    element("diagnostics", HTMLButtonElement).addEventListener("click", () => this.show());
    element("share-log", HTMLButtonElement).addEventListener("click", () => {
      this.store();
      void shareReport(this.app, this.log.value);
    });
  }
  start(name: string): void {
    this.app = name;
    element("report-title", HTMLHeadingElement).textContent = name;
    try {
      archiveLastReport(localStorage);
    } catch {
      /* Without storage there is no earlier report to keep. */
    }
    this.recorder.start(name, {
      build: `retrove-${import.meta.env.VITE_RETROVE_REVISION}`,
      browser: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
    });
  }
  diagnostic: Diagnostic = (level, area, message, details) => {
    this.recorder.event(level, area, message, details);
    this.onMessage(level, area, message, details);
    if (level === "error") this.store();
  };
  snapshot = (value: unknown): void => {
    this.recorder.snapshot(value);
    const state = progress(value);
    if (state) {
      this.showProgress(state);
      this.onProgress(state);
    }
    if (performance.now() - this.lastWrite > REPORT_INTERVAL || state?.fault) {
      this.lastWrite = performance.now();
      this.store();
    }
  };
  store(): void {
    this.log.value = this.recorder.text();
    try {
      saveLastReport(this.log.value);
    } catch {
      this.summary.textContent +=
        " · Report could not be saved on this device. Export it before leaving.";
    }
  }
  private showProgress(state: Progress): void {
    element("report-phase", HTMLElement).textContent = state.fault
      ? "Stopped"
      : phaseLabel(state.phase);
    element("report-fps", HTMLElement).textContent =
      state.fps === undefined ? "–" : `${state.fps.toFixed(1)} FPS`;
    element("report-time", HTMLElement).textContent = formatDuration(
      state.elapsed / MILLISECONDS_PER_SECOND,
    );
    this.summary.classList.toggle("problem", Boolean(state.fault));
    this.summary.textContent = state.fault
      ? state.fault
      : "No problems so far. If something looks wrong, share this report.";
  }
  finish(state: "completed" | "stopped" | "failed", message: string): void {
    this.recorder.finish(state, message);
    this.store();
  }
  show(): void {
    this.store();
    if (!this.dialog.open) this.dialog.showModal();
  }
}
