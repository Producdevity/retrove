import { parseSession } from "./log-view";

export const LAST_REPORT_KEY = "retrove.last-report";
export const EARLIER_REPORTS_KEY = "retrove.earlier-reports";
const MAX_EARLIER = 5;
/** Keeps an archived report within a share of the ~5 MB localStorage quota. */
const MAX_REPORT_CHARACTERS = 200_000;
const HEAD_CHARACTERS = 60_000;
export const UNCLEAN_END =
  "Ended unexpectedly: Retrove restarted while this app was still running. On iPhone this " +
  "usually means iOS closed the page because it used too much memory.";

export interface ReportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function bounded(report: string): string {
  if (report.length <= MAX_REPORT_CHARACTERS) return report;
  const tail = MAX_REPORT_CHARACTERS - HEAD_CHARACTERS;
  return `${report.slice(0, HEAD_CHARACTERS)}\n… ${report.length - MAX_REPORT_CHARACTERS} characters omitted …\n${report.slice(-tail)}`;
}
export function readEarlierReports(storage: ReportStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(EARLIER_REPORTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
/**
 * Moves the stored report of the previous session into the earlier list before a new session
 * overwrites it. A report still marked running never saw its session end, so it is labelled.
 */
export function archiveLastReport(storage: ReportStorage): void {
  const last = storage.getItem(LAST_REPORT_KEY);
  if (!last) return;
  const unclean = parseSession(last)?.state === "running";
  let reports = [
    bounded(unclean ? `${UNCLEAN_END}\n\n${last}` : last),
    ...readEarlierReports(storage),
  ];
  reports = reports.slice(0, MAX_EARLIER);
  while (reports.length) {
    try {
      storage.setItem(EARLIER_REPORTS_KEY, JSON.stringify(reports));
      break;
    } catch {
      reports = reports.slice(0, -1);
    }
  }
  storage.removeItem(LAST_REPORT_KEY);
}
