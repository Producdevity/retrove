import { element, node } from "../ui/dom";
import { download } from "../ui/download";
import { connectCopy } from "./clipboard";
import type { SessionDetail } from "./session-detail";
import { formatDuration, formatStart } from "./sessions-view";
import type { StoredSession } from "./session-store";

const REASON_TITLES: Readonly<Record<string, string>> = {
  failed: "Why it stopped",
  unclean: "Closed unexpectedly",
};
function fileName(app: string): string {
  return `retrove-${app
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")}-report.txt`;
}
/** The share sheet with the report as a file, else as text, else a download. */
export async function shareReport(app: string, text: string): Promise<void> {
  const title = `${app} runtime report`,
    file = new File([text], fileName(app), { type: "text/plain" });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
    else if (typeof navigator.share === "function") await navigator.share({ title, text });
    else download(file, file.name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) download(file, file.name);
  }
}
function fact(list: HTMLElement, label: string, value: string | undefined): void {
  if (!value) return;
  const item = node("div");
  item.append(node("dt", "", label), node("dd", "", value));
  list.append(item);
}

/** One session: why it ended, how far it got, a short timeline and the full report. */
export class SessionSheet {
  private readonly dialog = element("session-details", HTMLDialogElement);
  private readonly report = element("session-report", HTMLTextAreaElement);
  private session: StoredSession | undefined;
  constructor(deleted: (session: StoredSession) => void) {
    connectCopy(
      element("session-copy", HTMLButtonElement),
      this.report,
      element("session-status", HTMLParagraphElement),
      () => undefined,
    );
    element("session-share", HTMLButtonElement).addEventListener("click", () => {
      if (this.session) void shareReport(this.session.app, this.session.text);
    });
    element("session-delete", HTMLButtonElement).addEventListener("click", () => {
      const session = this.session;
      this.dialog.close();
      if (session) deleted(session);
    });
  }
  open(session: StoredSession, detail: SessionDetail): void {
    this.session = session;
    element("session-title", HTMLHeadingElement).textContent = detail.app;
    element("session-meta", HTMLParagraphElement).textContent = [
      formatStart(detail.started),
      detail.seconds === undefined ? undefined : `ran ${formatDuration(detail.seconds)}`,
      detail.build ? `build ${detail.build}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    const reason = element("session-reason", HTMLDivElement);
    reason.hidden = !detail.reason;
    reason.dataset["state"] = detail.state;
    element("session-reason-title", HTMLElement).textContent =
      REASON_TITLES[detail.state] ?? detail.outcome;
    element("session-reason-text", HTMLElement).textContent = detail.reason ?? "";
    const facts = element("session-facts", HTMLElement);
    facts.replaceChildren();
    fact(facts, "Outcome", detail.outcome);
    fact(facts, "Reached", detail.reached);
    fact(
      facts,
      "Frame rate at close",
      detail.fps === undefined ? undefined : `${detail.fps.toFixed(1)} FPS`,
    );
    const timeline = element("session-timeline", HTMLOListElement);
    timeline.replaceChildren(
      ...(detail.timeline.length
        ? detail.timeline.map((entry) => {
            const item = node("li", entry.problem ? "problem" : "");
            const text = node("div");
            text.append(node("strong", "", entry.label));
            item.append(text, node("time", "", formatDuration(entry.seconds)));
            return item;
          })
        : [node("li", "empty-row", "No milestones recorded.")]),
    );
    this.report.value = session.text;
    element("session-status", HTMLParagraphElement).textContent = "";
    if (!this.dialog.open) this.dialog.showModal();
  }
}

export type ClearChoice = "sessions" | "library" | "all";
/** Asks what to clear; resolves undefined on cancel. */
export function chooseClear(sessions: number, events: number): Promise<ClearChoice | undefined> {
  const dialog = element("clear-sheet", HTMLDialogElement);
  element("clear-sessions-count", HTMLSpanElement).textContent = String(sessions);
  element("clear-library-count", HTMLSpanElement).textContent = String(events);
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const value = dialog.returnValue;
        resolve(value === "sessions" || value === "library" || value === "all" ? value : undefined);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
