import { DiagnosticRecorder } from "../../web/diagnostics.mjs";
import type { Diagnostic } from "../../web/ipa.mjs";
import { isRecord } from "../domain/validation";
import { saveLastReport } from "../diagnostics/activity";
import { element } from "../ui/dom";
import { download } from "../ui/download";
const REPORT_INTERVAL = 5000;
const MILLISECONDS_PER_SECOND = 1000;
interface Progress {
  readonly phase: string;
  readonly frames: number;
  readonly elapsed: number;
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
  return { phase: value.phase, elapsed: value.elapsedMs, frames, fault };
}
export class SessionReport {
  private readonly recorder = new DiagnosticRecorder();
  private readonly log = element("log", HTMLTextAreaElement);
  private readonly dialog = element("report-dialog", HTMLDialogElement);
  private readonly summary = element("summary", HTMLParagraphElement);
  private lastWrite = 0;
  constructor(
    private readonly onProgress: (value: Progress) => void,
    private readonly onMessage: Diagnostic,
  ) {
    element("diagnostics", HTMLButtonElement).addEventListener("click", () => this.show());
    element("save-log", HTMLButtonElement).addEventListener("click", () => {
      this.store();
      download(new Blob([this.log.value], { type: "text/plain" }), "retrove-report.txt");
    });
  }
  start(name: string): void {
    this.recorder.start(name, {
      build: "retrove-0.1.0",
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
      this.summary.textContent = `${state.phase} · ${state.frames} presented frames · ${Math.round(state.elapsed / MILLISECONDS_PER_SECOND)} seconds`;
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
  finish(state: "completed" | "stopped" | "failed", message: string): void {
    this.recorder.finish(state, message);
    this.store();
  }
  show(): void {
    this.store();
    if (!this.dialog.open) this.dialog.showModal();
  }
}
