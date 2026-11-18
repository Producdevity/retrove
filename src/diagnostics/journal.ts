import { isRecord } from "../domain/validation";
import type { DiagnosticOperation } from "./operations";
const JOURNAL_KEY = "retrove.library-log";
const MAX_ENTRIES = 100;
const MAX_ENTRY_CHARACTERS = 4096;
const MAX_CAUSES = 5;
const MAX_STORAGE_CHARACTERS = MAX_ENTRIES * (MAX_ENTRY_CHARACTERS + 1);
type Details = Readonly<Record<string, string | number | boolean | null>>;
interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function browserStorage(): JournalStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
export function describeError(error: unknown): string {
  const lines: string[] = [],
    seen = new Set<unknown>();
  for (let cause: unknown = error; cause !== undefined && lines.length < MAX_CAUSES;) {
    if (seen.has(cause)) break;
    seen.add(cause);
    if (!(cause instanceof Error)) {
      lines.push(typeof cause === "string" ? cause : `Non-Error value thrown (${typeof cause})`);
      break;
    }
    const operation =
      isRecord(cause) && typeof cause.operation === "string" ? ` [${cause.operation}]` : "";
    lines.push(
      `${cause.name}${operation}: ${cause.message}${cause.stack ? `\n${cause.stack}` : ""}`,
    );
    cause = cause.cause;
  }
  return lines.join("\nCaused by: ").slice(0, MAX_ENTRY_CHARACTERS);
}
export class DiagnosticJournal {
  readonly #entries: string[];
  constructor(private readonly storage = browserStorage()) {
    let saved = "";
    try {
      saved = storage?.getItem(JOURNAL_KEY) ?? "";
    } catch {
      /* Storage failure must not hide its diagnostic. */
    }
    this.#entries = saved
      .slice(-MAX_STORAGE_CHARACTERS)
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_ENTRIES);
  }
  record(operation: DiagnosticOperation, details: Details = {}, error?: unknown): void {
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      operation,
      ...details,
      ...(error === undefined ? {} : { error: describeError(error) }),
    });
    this.#entries.push(entry.slice(0, MAX_ENTRY_CHARACTERS));
    if (this.#entries.length > MAX_ENTRIES) this.#entries.shift();
    try {
      this.storage?.setItem(JOURNAL_KEY, this.text());
    } catch {
      /* Keep diagnostics available in memory if storage is unavailable. */
    }
  }
  text(): string {
    return this.#entries.join("\n");
  }
  get size(): number {
    return this.#entries.length;
  }
  clear(): void {
    this.#entries.length = 0;
    try {
      this.storage?.setItem(JOURNAL_KEY, "");
    } catch {
      /* Nothing stored to clear. */
    }
  }
}
export const libraryJournal = new DiagnosticJournal();
