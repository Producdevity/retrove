import { isRecord } from "../domain/validation";
import { DiagnosticOperation } from "./operations";

export interface LogEntry {
  readonly time: Date | undefined;
  readonly title: string;
  readonly detail: string;
  readonly problem: boolean;
}
export interface GroupedEntry extends LogEntry {
  /** How many identical entries in a row this one stands for. */
  readonly count: number;
}
/** Words for how the recorder last saw a session; a stored run left "running" never exited. */
export const SESSION_STATES: Readonly<Record<string, string>> = {
  completed: "Exited",
  stopped: "Closed",
  failed: "Failed",
  running: "Interrupted",
  interrupted: "Interrupted",
};
export interface SessionSummary {
  readonly app: string;
  readonly state: string;
  readonly started: Date | undefined;
  readonly seconds: number | undefined;
  readonly firstError: string | undefined;
}

const TITLES: Readonly<Record<DiagnosticOperation, string>> = {
  [DiagnosticOperation.Session]: "Library opened",
  [DiagnosticOperation.Refresh]: "Read library",
  [DiagnosticOperation.Maintenance]: "Storage maintenance",
  [DiagnosticOperation.Capacity]: "Storage capacity",
  [DiagnosticOperation.FileStorage]: "File storage",
  [DiagnosticOperation.CreateArchive]: "Create archive",
  [DiagnosticOperation.WritableArchive]: "Open archive for writing",
  [DiagnosticOperation.WriteArchive]: "Write archive",
  [DiagnosticOperation.ReadArchive]: "Read archive",
  [DiagnosticOperation.Database]: "Library database",
  [DiagnosticOperation.InspectPackage]: "Read IPA",
  [DiagnosticOperation.InspectExecutable]: "Inspect executable",
  [DiagnosticOperation.Import]: "Import",
  [DiagnosticOperation.ImportProgress]: "Import progress",
  [DiagnosticOperation.Settings]: "Read settings",
  [DiagnosticOperation.Offline]: "Offline support",
  [DiagnosticOperation.Interface]: "Interface",
};
/** Context fields that repeat in every session entry; they stay in the full log. */
const OMITTED = new Set(["time", "operation", "error", "browser", "secure", "standalone"]);
const STATE = /^State: (?<state>\S+) \(\+(?<seconds>[\d.]+)s\)$/mu;
const FIELD = (name: string): RegExp => new RegExp(`^${name}: (?<value>.+)$`, "mu");

const OPERATIONS = new Set<string>(Object.values(DiagnosticOperation));
function isOperation(value: string): value is DiagnosticOperation {
  return OPERATIONS.has(value);
}
function title(operation: unknown): string {
  if (typeof operation !== "string") return "Event";
  return isOperation(operation) ? TITLES[operation] : operation;
}
function date(value: unknown): Date | undefined {
  const parsed = typeof value === "string" ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
}

/** One library journal line, which is a JSON object, as a readable entry. */
export function parseEntry(line: string): LogEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { time: undefined, title: "Event", detail: line, problem: false };
  }
  if (!isRecord(value)) return { time: undefined, title: "Event", detail: line, problem: false };
  const error = typeof value["error"] === "string" ? value["error"] : undefined;
  const fields = Object.entries(value)
    .filter(([key]) => !OMITTED.has(key))
    .map(([key, item]) => `${key}: ${String(item)}`);
  return {
    time: date(value["time"]),
    title: title(value["operation"]),
    detail: error?.split("\n")[0] ?? fields.join(" · "),
    problem: error !== undefined || value["state"] === "failed",
  };
}

/** The header of a runtime report, as written by the player's diagnostic recorder. */
export function parseSession(report: string | null): SessionSummary | undefined {
  if (!report) return undefined;
  const app = FIELD("Input").exec(report)?.groups?.["value"];
  if (!app) return undefined;
  const state = STATE.exec(report)?.groups;
  return {
    app,
    state: state?.["state"] ?? "unknown",
    started: date(FIELD("Started").exec(report)?.groups?.["value"]),
    seconds: state?.["seconds"] === undefined ? undefined : Number(state["seconds"]),
    firstError: FIELD("First error").exec(report)?.groups?.["value"],
  };
}

/** Collapses runs of identical entries, keeping the time of the latest. */
export function groupRepeats(entries: readonly LogEntry[]): GroupedEntry[] {
  const groups: GroupedEntry[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (
      last &&
      last.title === entry.title &&
      last.detail === entry.detail &&
      last.problem === entry.problem
    )
      groups[groups.length - 1] = { ...last, count: last.count + 1 };
    else groups.push({ ...entry, count: 1 });
  }
  return groups;
}
