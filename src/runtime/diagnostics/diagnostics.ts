import { clip, describe } from "./diagnostics-describe";
import { reportText } from "./diagnostics-report";
import {
  compactCheckpoint,
  lineSize,
  recover,
  STORAGE_PREFIX,
  storageKeys,
} from "./diagnostics-run";
import type { DiagnosticEntry, DiagnosticRun, StorageLike } from "./diagnostics-run";

const HEAD_COUNT = 12;
const TAIL_COUNT = 150;
const TAIL_BUDGET = 42000;
const WRITE_DELAY_MS = 1000;
const RETAINED_RUNS = 2;
const ID_DIGITS = 14;
const RANDOM_RADIX = 36;
const RANDOM_START = 2;
const RANDOM_END = 10;
const Limit = {
  Label: 180,
  Metadata: 5000,
  Snapshot: 15000,
  Level: 16,
  Area: 80,
  Message: 900,
  Details: 3000,
  Payload: 24000,
  State: 32,
} as const;
const QUOTA_ERRORS = ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"];
const iso = () => new Date().toISOString();

export interface RecorderOptions {
  storage?: StorageLike | null;
}
export type RunExit = "completed" | "stopped" | "failed" | "interrupted";

function errorName(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "name") : undefined;
}
function idOrder(id: string | undefined): number {
  return Number(id?.split("-")[0] || 0);
}

export class DiagnosticRecorder {
  current: DiagnosticRun | null = null;
  previous: DiagnosticRun | null = null;
  storageAvailable = false;
  owned = false;
  timer: ReturnType<typeof setTimeout> | null = null;
  storage: StorageLike | null | undefined = undefined;
  savedOnce = false;
  compactWrites = false;
  clockStart = 0;
  tailSize = 0;
  dirty = false;

  constructor(options: RecorderOptions = {}) {
    try {
      this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
      if (this.storage) {
        const runs: DiagnosticRun[] = [];
        for (const key of storageKeys(this.storage)) {
          const run = recover(this.storage, key);
          if (run) runs.push(run);
          if (runs.length === RETAINED_RUNS) break;
        }
        [this.current = null, this.previous = null] = runs;
        this.storageAvailable = true;
      }
    } catch {
      // Private modes can reject even reading window.localStorage.
    }
  }

  private active(): DiagnosticRun | null {
    return this.owned && this.current?.state === "running" ? this.current : null;
  }

  private nextOrder(): number {
    let order = Math.max(Date.now(), idOrder(this.previous?.id) + 1);
    const storage = this.storage;
    if (this.storageAvailable && storage) {
      try {
        const latest = storageKeys(storage)[0];
        if (latest)
          order = Math.max(
            order,
            Number(latest.slice(STORAGE_PREFIX.length).split("-")[0]) + 1 || 0,
          );
      } catch {
        this.storageAvailable = false;
      }
    }
    return order;
  }

  start(label: string, metadata?: unknown): DiagnosticRun {
    if (this.active()) this.finish("interrupted");
    this.previous = this.current;
    const startedAt = iso();
    this.storageAvailable = Boolean(this.storage);
    const order = this.nextOrder();
    // Individual keys keep one tab's checkpoints from overwriting another tab's run.
    const id =
      String(order).padStart(ID_DIGITS, "0") +
      "-" +
      Math.random().toString(RANDOM_RADIX).slice(RANDOM_START, RANDOM_END);
    const run: DiagnosticRun = {
      id,
      label: clip(label, Limit.Label),
      startedAt,
      updatedAt: startedAt,
      elapsed: 0,
      state: "running",
      metadata: describe(metadata, Limit.Metadata),
      snapshot: "",
      count: 0,
      head: [],
      tail: [],
      firstError: null,
    };
    this.current = run;
    this.owned = true;
    this.savedOnce = false;
    this.compactWrites = false;
    this.clockStart = performance.now();
    this.tailSize = 0;
    this.dirty = true;
    this.flush();
    return run;
  }

  private touch(run: DiagnosticRun): void {
    run.elapsed = Math.max(0, Math.round(performance.now() - this.clockStart));
    run.updatedAt = iso();
    this.dirty = true;
  }

  private schedule(): void {
    if (this.timer !== null || !this.storageAvailable) return;
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
    this.timer?.unref?.();
  }

  event(level: string, area: string, message: string, details?: unknown): void {
    const run = this.active();
    if (!run) return;
    this.touch(run);
    const entry: DiagnosticEntry = {
      seq: ++run.count,
      ms: run.elapsed,
      level: clip(level, Limit.Level).toLowerCase(),
      area: clip(area, Limit.Area),
      message: clip(message, Limit.Message),
      details: describe(details, Limit.Details),
    };
    if (entry.area === "linker" && details && typeof details === "string") {
      run.linker = clip(details, Limit.Payload);
      entry.details = "See the unresolved import list at the end of this report.";
    }
    if (entry.area === "coverage" && details && typeof details === "string") {
      run.coverage = clip(details, Limit.Payload);
      entry.details = "See the unimplemented class and selector list at the end of this report.";
    }
    this.record(run, entry);
  }

  private record(run: DiagnosticRun, entry: DiagnosticEntry): void {
    if (run.head.length < HEAD_COUNT) run.head.push(entry);
    else {
      run.tail.push(entry);
      this.tailSize += lineSize(entry);
      while (run.tail.length > TAIL_COUNT || this.tailSize > TAIL_BUDGET) {
        const dropped = run.tail.shift();
        if (!dropped) break;
        this.tailSize -= lineSize(dropped);
      }
    }
    if (!run.firstError && (entry.level === "error" || entry.level === "fatal")) {
      run.firstError = entry;
      this.flush();
    } else this.schedule();
  }

  snapshot(value: unknown): void {
    const run = this.active();
    if (!run) return;
    this.touch(run);
    run.snapshot = describe(value, Limit.Snapshot);
    this.schedule();
  }

  finish(state: RunExit, message?: string): void {
    const run = this.active();
    if (!run) return;
    if (message) this.event(state === "failed" ? "error" : "info", "session", message);
    this.touch(run);
    run.state = clip(state, Limit.State);
    this.flush();
  }

  private write(storage: StorageLike, key: string, run: DiagnosticRun): void {
    try {
      storage.setItem(key, JSON.stringify(this.compactWrites ? compactCheckpoint(run) : run));
    } catch (error) {
      if (this.compactWrites || !QUOTA_ERRORS.includes(String(errorName(error)))) throw error;
      this.compactWrites = true;
      storage.setItem(key, JSON.stringify(compactCheckpoint(run)));
    }
  }

  flush(): boolean {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const run = this.owned ? this.current : null,
      storage = this.storage;
    if (!this.dirty || !run || !storage || !this.storageAvailable) return this.storageAvailable;
    try {
      const key = STORAGE_PREFIX + run.id;
      // A newer pair of runs can evict this run from another tab. Its in-memory
      // report remains usable without displacing the newer persisted reports.
      if (this.savedOnce && storage.getItem(key) === null) {
        this.storageAvailable = false;
        return false;
      }
      this.write(storage, key, run);
      if (!this.savedOnce) {
        for (const oldKey of storageKeys(storage).slice(RETAINED_RUNS)) storage.removeItem(oldKey);
        this.savedOnce = true;
      }
      this.dirty = false;
      return true;
    } catch {
      this.storageAvailable = false;
      return false;
    }
  }

  text(which: "current" | "previous" = "current"): string {
    const run = which === "previous" ? this.previous : this.current;
    return run ? reportText(run, this.storageAvailable) : "";
  }
}
