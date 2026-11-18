import { element, node } from "../ui/dom";
import { download } from "../ui/download";
import { libraryJournal } from "./journal";
import { connectCopy } from "./clipboard";
import { groupRepeats, parseEntry, type GroupedEntry } from "./log-view";
import { chooseClear, SessionSheet } from "./session-sheet";
import { renderSessionGroups } from "./sessions-view";
import {
  LAST_REPORT_KEY,
  clearSessions,
  deleteSession,
  readSessions,
  type ReportStorage,
} from "./session-store";
export { LAST_REPORT_KEY } from "./session-store";
const FILTER_PROBLEMS = "problems";
const VIEW_LIBRARY = "library";
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function storage(): ReportStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
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
function renderEntry(entry: GroupedEntry): HTMLLIElement {
  const item = node("li", entry.problem ? "problem" : "");
  const text = node("div");
  const title = node("strong", "", entry.title);
  if (entry.count > 1) title.append(node("span", "repeat", ` ×${entry.count}`));
  text.append(title, node("span", "", entry.detail));
  item.append(text, node("time", "", entry.time ? time.format(entry.time) : ""));
  return item;
}
function checked(container: HTMLElement, value: string): boolean {
  return container.querySelector<HTMLInputElement>(`input[value="${value}"]`)?.checked ?? false;
}

/** The library's own event journal, with its filter and export. */
function connectLibrary(): () => void {
  const report = element("report", HTMLTextAreaElement);
  const status = element("report-status", HTMLParagraphElement);
  const entries = element("log-entries", HTMLOListElement);
  const filter = element("log-filter", HTMLFieldSetElement);
  const refresh = (): void => {
    const journal = libraryJournal.text();
    report.value = [
      "Retrove library log",
      `Build: ${import.meta.env.VITE_RETROVE_REVISION}`,
      journal,
    ]
      .filter(Boolean)
      .join("\n\n");
    const problems = checked(filter, FILTER_PROBLEMS);
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
    download(new Blob([report.value], { type: "text/plain" }), "retrove-library-log.txt");
  });
  return refresh;
}

/** The Logs page: app sessions grouped by app, and the library's own events. */
export function connectActivity(): () => void {
  const groups = element("session-groups", HTMLDivElement);
  const views = element("logs-view", HTMLFieldSetElement);
  const refreshLibrary = connectLibrary();
  const refreshSessions = (): void => {
    renderSessionGroups(groups, readSessions(storage() ?? emptyStorage), (session, detail) =>
      sheet.open(session, detail),
    );
  };
  const sheet = new SessionSheet((session) => {
    const store = storage();
    if (store) deleteSession(store, session.id);
    refreshSessions();
  });
  const showView = (): void => {
    const library = checked(views, VIEW_LIBRARY);
    element("sessions-view", HTMLDivElement).hidden = library;
    element("library-view", HTMLDivElement).hidden = !library;
  };
  views.addEventListener("change", showView);
  element("clear-logs", HTMLButtonElement).addEventListener("click", () => {
    const store = storage();
    void chooseClear(store ? readSessions(store).length : 0, libraryJournal.size).then((choice) => {
      if (store && (choice === "sessions" || choice === "all")) clearSessions(store);
      if (choice === "library" || choice === "all") libraryJournal.clear();
      refreshSessions();
      refreshLibrary();
    });
  });
  return () => {
    showView();
    refreshSessions();
    refreshLibrary();
  };
}
const emptyStorage: ReportStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
