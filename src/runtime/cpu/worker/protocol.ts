import type { StateLayout } from "../translation/layout";
import type { CompiledModule } from "../translation/tier-options";
import type {
  FromGraphics,
  GraphicsGates,
  GraphicsStartPost,
} from "../../graphics/remote/protocol";

export const ExecutionMessage = { Start: "start", Code: "code", Failed: "failed" } as const;

export interface TrapRange {
  readonly first: number;
  readonly last: number;
}
/** The parts of the main thread's layout that a worker needs besides its own state block. */
export interface SharedLayout {
  readonly arena: number;
  readonly mask: number;
  readonly index: StateLayout["index"];
  readonly foreign?: StateLayout["foreign"];
}
export interface StartMessage {
  readonly type: typeof ExecutionMessage.Start;
  readonly memory: WebAssembly.Memory;
  readonly control: SharedArrayBuffer;
  readonly channel: SharedArrayBuffer;
  /** Which of the control block's worker flags this worker owns. */
  readonly worker: number;
  /** Host address of the thread's state block. */
  readonly state: number;
  readonly pc: number;
  /** Returning here ends the thread. */
  readonly until: number;
  readonly traps: readonly TrapRange[];
  readonly layout: SharedLayout;
  /** Guest thread id (pthread_t). */
  readonly thread: number;
  /** Import gates the worker answers itself, by symbol (see `LOCAL_IMPORT_NAMES`). */
  readonly imports: readonly (readonly [number, string])[];
  /** The main thread's `performance.timeOrigin`, which guest clocks count from. */
  readonly timeOrigin: number;
  /** Host address of the main thread's budget word, which the worker preempts (`Preemption`). */
  readonly preempt: number;
}
export interface CodeMessage {
  readonly type: typeof ExecutionMessage.Code;
  readonly generation: number;
  readonly compiled: CompiledModule;
  readonly index: StateLayout["index"];
}
export type ToWorker = StartMessage | CodeMessage;
export interface FailedMessage {
  readonly type: typeof ExecutionMessage.Failed;
  readonly message: string;
}

/** The worker's end of its message port. */
export interface WorkerPort {
  post(message: FailedMessage | FromGraphics): void;
  listen(handler: (message: unknown) => void): void;
}
/** The main thread's handle on an execution worker. */
export interface ExecutionPort {
  post(message: ToWorker | GraphicsStartPost | GraphicsGates, transfer?: Transferable[]): void;
  listen(handler: (message: unknown) => void): void;
  terminate(): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const integer = (value: unknown): value is number => Number.isInteger(value);
function indexRegion(value: unknown): value is StateLayout["index"] {
  return record(value) && integer(value.base) && integer(value.start) && integer(value.end);
}
function foreignRegion(value: unknown): value is NonNullable<StateLayout["foreign"]> {
  return record(value) && integer(value.base) && integer(value.slots);
}
function sharedLayout(value: unknown): value is SharedLayout {
  return (
    record(value) &&
    integer(value.arena) &&
    integer(value.mask) &&
    indexRegion(value.index) &&
    (value.foreign === undefined || foreignRegion(value.foreign))
  );
}
const trapRange = (value: unknown): value is TrapRange =>
  record(value) && integer(value.first) && integer(value.last);
const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const PAIR = 2;
const gateName = (value: unknown): value is readonly [number, string] =>
  Array.isArray(value) &&
  value.length === PAIR &&
  integer(value[0]) &&
  typeof value[1] === "string";
const integers = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every(integer);
function compiledModule(value: unknown): value is CompiledModule {
  return (
    record(value) &&
    value.module instanceof WebAssembly.Module &&
    integer(value.labels) &&
    integers(value.slots) &&
    strings(value.exports) &&
    value.slots.length === value.exports.length
  );
}
function startMessage(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StartMessage {
  return (
    value.memory instanceof WebAssembly.Memory &&
    value.control instanceof SharedArrayBuffer &&
    value.channel instanceof SharedArrayBuffer &&
    integer(value.worker) &&
    integer(value.state) &&
    integer(value.pc) &&
    integer(value.until) &&
    Array.isArray(value.traps) &&
    value.traps.every(trapRange) &&
    sharedLayout(value.layout) &&
    integer(value.thread) &&
    Array.isArray(value.imports) &&
    value.imports.every(gateName) &&
    typeof value.timeOrigin === "number" &&
    integer(value.preempt)
  );
}
export function isToWorker(value: unknown): value is ToWorker {
  if (!record(value)) return false;
  if (value.type === ExecutionMessage.Start) return startMessage(value);
  return (
    value.type === ExecutionMessage.Code &&
    integer(value.generation) &&
    compiledModule(value.compiled) &&
    indexRegion(value.index)
  );
}
export function isFailedMessage(value: unknown): value is FailedMessage {
  return (
    record(value) && value.type === ExecutionMessage.Failed && typeof value.message === "string"
  );
}
