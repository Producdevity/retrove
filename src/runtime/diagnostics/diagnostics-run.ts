import { isRecord } from "../../domain/validation";
import { clip } from "./diagnostics-describe";

export const STORAGE_PREFIX = "bioshock.diagnostics.v1.";
const MAX_STORED_CHARACTERS = 512000;
const Compact = {
  Message: 320,
  Details: 450,
  Metadata: 1000,
  Snapshot: 4500,
  FirstError: 1500,
  Head: 4,
  Tail: 8,
} as const;
const LINE_OVERHEAD = 64;

export interface DiagnosticEntry {
  seq: number;
  ms: number;
  level: string;
  area: string;
  message: string;
  details: string;
}
export interface DiagnosticRun {
  id: string;
  label: string;
  startedAt: string;
  updatedAt: string;
  elapsed: number;
  state: string;
  metadata: string;
  snapshot: string;
  count: number;
  head: DiagnosticEntry[];
  tail: DiagnosticEntry[];
  firstError: DiagnosticEntry | null;
  linker?: string;
  coverage?: string;
  compact?: boolean;
}
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storageKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys.sort().reverse();
}

function text(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}
function number(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" ? value : 0;
}

function entry(value: unknown): DiagnosticEntry | null {
  if (!isRecord(value)) return null;
  const message = text(value, "message"),
    area = text(value, "area"),
    level = text(value, "level"),
    details = text(value, "details");
  if (
    message === undefined ||
    area === undefined ||
    level === undefined ||
    details === undefined ||
    typeof value.ms !== "number"
  )
    return null;
  return { seq: number(value, "seq"), ms: value.ms, level, area, message, details };
}

function entries(value: unknown): DiagnosticEntry[] | null {
  if (!Array.isArray(value)) return null;
  const result: DiagnosticEntry[] = [];
  for (const item of value as unknown[]) {
    const parsed = entry(item);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

function parseRun(key: string, value: unknown): DiagnosticRun | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id"),
    startedAt = text(value, "startedAt"),
    label = text(value, "label"),
    state = text(value, "state"),
    head = entries(value.head),
    tail = entries(value.tail),
    firstError = value.firstError ? entry(value.firstError) : null;
  if (
    id === undefined ||
    STORAGE_PREFIX + id !== key ||
    startedAt === undefined ||
    label === undefined ||
    state === undefined ||
    !head ||
    !tail ||
    (value.firstError && !firstError)
  )
    return null;
  const run: DiagnosticRun = {
    id,
    label,
    startedAt,
    updatedAt: text(value, "updatedAt") ?? "",
    elapsed: number(value, "elapsed"),
    state: state === "running" ? "interrupted" : state,
    metadata: text(value, "metadata") ?? "",
    snapshot: text(value, "snapshot") ?? "",
    count: number(value, "count"),
    head,
    tail,
    firstError,
  };
  const linker = text(value, "linker"),
    coverage = text(value, "coverage");
  if (linker !== undefined) run.linker = linker;
  if (coverage !== undefined) run.coverage = coverage;
  if (value.compact === true) run.compact = true;
  return run;
}

export function recover(storage: StorageLike, key: string): DiagnosticRun | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_STORED_CHARACTERS) return null;
    const parsed: unknown = JSON.parse(raw);
    return parseRun(key, parsed);
  } catch {
    return null;
  }
}

export function lineSize(item: DiagnosticEntry): number {
  return (
    item.message.length + item.details.length + item.area.length + item.level.length + LINE_OVERHEAD
  );
}

/**
 * Preserves the failure and end of the timeline when Safari's origin quota is
 * nearly full. The export in the currently open tab retains its full detail.
 */
export function compactCheckpoint(run: DiagnosticRun): DiagnosticRun {
  const compact = (item: DiagnosticEntry): DiagnosticEntry => ({
    ...item,
    message: clip(item.message, Compact.Message),
    details: clip(item.details, Compact.Details),
  });
  const result: DiagnosticRun = {
    ...run,
    metadata: clip(run.metadata, Compact.Metadata),
    snapshot: clip(run.snapshot, Compact.Snapshot),
    head: run.head.slice(0, Compact.Head).map(compact),
    tail: [...run.head.slice(Compact.Head), ...run.tail].slice(-Compact.Tail).map(compact),
    firstError: run.firstError && {
      ...run.firstError,
      details: clip(run.firstError.details, Compact.FirstError),
    },
    compact: true,
  };
  delete result.linker;
  delete result.coverage;
  return result;
}
