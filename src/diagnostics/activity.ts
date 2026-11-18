import { element, node } from "../ui/dom";
import { download } from "../ui/download";
import { libraryJournal } from "./journal";
import { connectCopy } from "./clipboard";
import {
  groupRepeats,
  parseEntry,
  parseSession,
  SESSION_STATES,
  type GroupedEntry,
  type SessionSummary,
} from "./log-view";
import { LAST_REPORT_KEY, readEarlierReports } from "./report-archive";
const UNCLEAN_HINT =
  "Retrove restarted while it was running; iOS likely closed it for using too much memory.";
export { LAST_REPORT_KEY } from "./report-archive";
const FILTER_PROBLEMS = "problems";
export function readLastReport(): string | null {
  try {
    return localStorage.getItem(LAST_REPORT_KEY);
  } catch {
    return null;
  }
}
export function saveLastReport(value: string): void {
  localStorage.setItem(LAST_REPORT_KEY, value);
}
const clock = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function renderSession(container: HTMLElement, session: SessionSummary | undefined): void {
  if (!session) {
    container.replaceChildren(node("p", "row footnote", "No app has run yet."));
    return;
  }
  const head = node("div", "row");
  const state = node("span", "badge", SESSION_STATES[session.state] ?? session.state);
  state.dataset["state"] = session.state;
  head.append(node("strong", "", session.app), state);
  const facts = [
    session.started ? clock.format(session.started) : undefined,
    session.seconds === undefined ? undefined : `${Math.round(session.seconds)} s`,
  ].filter((fact) => fact !== undefined);
  const rows = [head, node("p", "row footnote", facts.join(" · "))];
  if (session.firstError) rows.push(node("p", "row problem", session.firstError));
  container.replaceChildren(...rows);
}
function renderEntry(entry: GroupedEntry): HTMLLIElement {
  const item = node("li", entry.problem ? "problem" : "");
  const text = node("div");
  const title = node("strong", "", entry.title);
  if (entry.count > 1) title.append(node("span", "repeat", ` ×${entry.count}`));
  text.append(title, node("span", "", entry.detail));
  item.append(text, node("time", "", entry.time ? time.format(entry.time) : ""));
  return item;
}

function earlierReports(): string[] {
  try {
    return readEarlierReports(localStorage);
  } catch {
    return [];
  }
}
function renderEarlier(container: HTMLElement, reports: readonly string[]): void {
  container.hidden = !reports.length;
  const heading = container.querySelector("h2");
  container.replaceChildren(
    ...(heading ? [heading] : []),
    ...reports.map((text) => {
      const group = node("div", "group");
      const summary = parseSession(text.replace(/^Ended unexpectedly:[^\n]*\n\n/u, ""));
      renderSession(
        group,
        summary?.state === "running"
          ? { ...summary, state: "unclean", firstError: summary.firstError ?? UNCLEAN_HINT }
          : summary,
      );
      return group;
    }),
  );
}
/** The Logs page: a summary of the last app session and the library's own events. */
export function connectActivity(): () => void {
  const report = element("report", HTMLTextAreaElement);
  const status = element("report-status", HTMLParagraphElement);
  const session = element("last-session", HTMLDivElement);
  const entries = element("log-entries", HTMLOListElement);
  const filter = element("log-filter", HTMLFieldSetElement);
  const earlier = element("earlier-sessions", HTMLDivElement);
  const refresh = (): void => {
    const lastReport = readLastReport();
    const previous = earlierReports();
    const journal = libraryJournal.text();
    report.value = [
      "Retrove debug logs",
      `Build: ${import.meta.env.VITE_RETROVE_REVISION}`,
      journal,
      lastReport,
      ...previous.map((text, index) => `Earlier session ${index + 1}\n${text}`),
    ]
      .filter(Boolean)
      .join("\n\n");
    renderSession(session, parseSession(lastReport));
    renderEarlier(earlier, previous);
    const problems = filter.querySelector<HTMLInputElement>(
      `input[value="${FILTER_PROBLEMS}"]`,
    )?.checked;
    const parsed = journal.split("\n").filter(Boolean).map(parseEntry).reverse();
    const shown = problems ? parsed.filter((entry) => entry.problem) : parsed;
    entries.replaceChildren(
      ...(shown.length
        ? groupRepeats(shown).map(renderEntry)
        : [node("li", "empty-row", problems ? "No problems." : "No events.")]),
    );
    status.textContent = "";
  };
  filter.addEventListener("change", refresh);
  connectCopy(element("copy-log", HTMLButtonElement), report, status, refresh);
  element("export-log", HTMLButtonElement).addEventListener("click", () => {
    refresh();
    download(new Blob([report.value], { type: "text/plain" }), "retrove-report.txt");
  });
  return refresh;
}
