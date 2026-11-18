import { parseSession } from "./log-view";

export const LAST_REPORT_KEY = "retrove.last-report";
const SESSIONS_KEY = "retrove.sessions";
const LEGACY_KEY = "retrove.earlier-reports";
const PER_APP = 5;
const TOTAL = 20;
/** localStorage holds about 5 MB; twenty bounded reports stay well inside it. */
const MAX_REPORT_CHARACTERS = 100_000;
const HEAD_CHARACTERS = 30_000;
const RUN = /^Run: (?<id>\S+)$/mu;
export const UNCLEAN_END =
  "Ended unexpectedly: Retrove restarted while this app was still running. On iPhone this " +
  "usually means iOS closed the page because it used too much memory.";

export interface ReportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface StoredSession {
  readonly id: string;
  readonly app: string;
  readonly text: string;
  /** The session still recording in the player, or the last one written before it closed. */
  readonly current: boolean;
}

function bounded(report: string): string {
  if (report.length <= MAX_REPORT_CHARACTERS) return report;
  const tail = MAX_REPORT_CHARACTERS - HEAD_CHARACTERS;
  return `${report.slice(0, HEAD_CHARACTERS)}\n… ${report.length - MAX_REPORT_CHARACTERS} characters omitted …\n${report.slice(-tail)}`;
}
function identify(text: string, current: boolean): StoredSession | undefined {
  const summary = parseSession(
    text.startsWith(UNCLEAN_END) ? text.slice(UNCLEAN_END.length) : text,
  );
  if (!summary) return undefined;
  const id = RUN.exec(text)?.groups?.["id"] ?? `${summary.app}-${summary.started?.getTime() ?? 0}`;
  return { id, app: summary.app, text, current };
}
function readList(storage: ReportStorage, key: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
/** Keeps the newest sessions within the per-app and total limits. */
function trim(texts: readonly string[]): string[] {
  const perApp = new Map<string, number>(),
    kept: string[] = [];
  for (const text of texts) {
    const app = identify(text, false)?.app ?? "";
    const count = perApp.get(app) ?? 0;
    if (count >= PER_APP || kept.length >= TOTAL) continue;
    perApp.set(app, count + 1);
    kept.push(text);
  }
  return kept;
}
function write(storage: ReportStorage, texts: string[]): void {
  let remaining = trim(texts);
  while (remaining.length) {
    try {
      storage.setItem(SESSIONS_KEY, JSON.stringify(remaining));
      return;
    } catch {
      remaining = remaining.slice(0, -1);
    }
  }
  storage.removeItem(SESSIONS_KEY);
}
function archived(storage: ReportStorage): string[] {
  const legacy = readList(storage, LEGACY_KEY);
  if (!legacy.length) return readList(storage, SESSIONS_KEY);
  const merged = [...readList(storage, SESSIONS_KEY), ...legacy];
  write(storage, merged);
  storage.removeItem(LEGACY_KEY);
  return readList(storage, SESSIONS_KEY);
}

/**
 * Moves the previous session's report into the archive before a new session overwrites it.
 * A report still marked running never saw its session end, so it is labelled.
 */
export function archiveLastReport(storage: ReportStorage): void {
  const last = storage.getItem(LAST_REPORT_KEY);
  if (!last) return;
  const unclean = parseSession(last)?.state === "running";
  write(storage, [bounded(unclean ? `${UNCLEAN_END}\n\n${last}` : last), ...archived(storage)]);
  storage.removeItem(LAST_REPORT_KEY);
}
/** Every stored session, newest first; the player's current report leads. */
export function readSessions(storage: ReportStorage): StoredSession[] {
  const current = storage.getItem(LAST_REPORT_KEY),
    sessions: StoredSession[] = [];
  const first = current ? identify(current, true) : undefined;
  if (first) sessions.push(first);
  for (const text of archived(storage)) {
    const session = identify(text, false);
    if (session) sessions.push(session);
  }
  return sessions;
}
export function deleteSession(storage: ReportStorage, id: string): void {
  const current = storage.getItem(LAST_REPORT_KEY);
  if (current && identify(current, true)?.id === id) storage.removeItem(LAST_REPORT_KEY);
  write(
    storage,
    archived(storage).filter((text) => identify(text, false)?.id !== id),
  );
}
export function clearSessions(storage: ReportStorage): void {
  storage.removeItem(LAST_REPORT_KEY);
  storage.removeItem(SESSIONS_KEY);
  storage.removeItem(LEGACY_KEY);
}
