import type { DiagnosticEntry, DiagnosticRun } from "./diagnostics-run";

const MILLISECONDS = 1000;
const SECONDS_DIGITS = 3;

function seconds(milliseconds: number): string {
  return (milliseconds / MILLISECONDS).toFixed(SECONDS_DIGITS);
}

export function formatEntry(entry: DiagnosticEntry): string {
  const prefix = `+${seconds(entry.ms)}s ${entry.level.toUpperCase()} [${entry.area}] `;
  return prefix + entry.message + (entry.details ? "\n" + entry.details : "");
}

function header(run: DiagnosticRun, storageAvailable: boolean): string[] {
  const rows = [
    "Retrove runtime diagnostics",
    "Run: " + run.id,
    "Input: " + run.label,
    "Started: " + run.startedAt,
    "Last checkpoint: " + run.updatedAt,
    `State: ${run.state} (+${seconds(run.elapsed)}s)`,
  ];
  if (run.state === "interrupted")
    rows.push("This run has no recorded exit. This report ends at its last saved checkpoint.");
  if (run.compact)
    rows.push("Storage was low. This saved checkpoint contains a shortened timeline and snapshot.");
  if (!storageAvailable)
    rows.push("Local log storage unavailable. Copy or save this report before closing.");
  if (run.firstError) rows.push(`First error: [${run.firstError.area}] ${run.firstError.message}`);
  if (run.metadata) rows.push("Environment and input", run.metadata);
  return rows;
}

export function reportText(run: DiagnosticRun, storageAvailable: boolean): string {
  const rows = header(run, storageAvailable);
  rows.push("", `Events (${run.count})`, ...run.head.map(formatEntry));
  const omitted = run.count - run.head.length - run.tail.length;
  if (omitted > 0) rows.push(`… ${omitted} earlier event(s) omitted from the timeline …`);
  rows.push(...run.tail.map(formatEntry));
  const { firstError } = run;
  if (
    firstError &&
    omitted > 0 &&
    ![...run.head, ...run.tail].some((entry) => entry.seq === firstError.seq)
  )
    rows.push("", "First error", formatEntry(firstError));
  if (run.snapshot) rows.push("", "Latest runtime snapshot", run.snapshot);
  if (typeof run.linker === "string") rows.push("", "Unresolved imports at load time", run.linker);
  if (typeof run.coverage === "string")
    rows.push("", "Unimplemented classes and selectors referenced by the app", run.coverage);
  return rows.join("\n");
}
