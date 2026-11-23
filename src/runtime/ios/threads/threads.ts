import type { WorkerThreads } from "../../cpu/worker/worker-host";
import { ThreadAttributes } from "./attributes";
import { CooperativeScheduler, type SchedulerTurns } from "./cooperative-scheduler";
import { attributeImports, keyImports, lifecycleImports } from "./pthread-imports";
import { RemoteService } from "./remote-service";
import { Scheduling } from "./scheduling";
import {
  conditionImports,
  guestMutexes,
  mutexImports,
  semaphoreImports,
  sleepImports,
} from "./sync-imports";
import { threadFunctions } from "./thread-code";
import { ThreadExits, type ExitHandler } from "./thread-exit";
import { ThreadTable } from "./thread-table";
import type { NestedCall, Step, ThreadCpu, ThreadHeap } from "./thread-types";

export type { SchedulerTurns } from "./cooperative-scheduler";
export type { NestedCall, Step, StepResult, ThreadCpu, WaitPoll } from "./thread-types";

export interface ThreadOptions {
  readonly scheduling?: Scheduling;
}
function threadImportFunctions(cpu: ThreadCpu, table: ThreadTable) {
  const attrs = new ThreadAttributes(),
    mutexes = guestMutexes(cpu);
  return {
    ...attributeImports(cpu, table, attrs),
    ...lifecycleImports(cpu, table, attrs),
    ...keyImports(cpu, table),
    ...mutexImports(table, mutexes),
    ...conditionImports(cpu, table, mutexes),
    ...semaphoreImports(cpu),
    ...sleepImports(cpu),
  };
}
export type ThreadFunctions = ReturnType<typeof threadImportFunctions>;

/** pthread, Mach semaphore and sleep imports, and the scheduler of the guest's threads. */
export interface GuestThreads {
  readonly funcs: ThreadFunctions;
  readonly nativeFunctions: Map<string, number>;
  readonly advance: (step: Step, nested: NestedCall, budgetMs?: number) => Promise<void>;
  readonly schedulerTurns: () => SchedulerTurns;
  /** Execution workers for guest threads; only on shared memory with worker threads on. */
  readonly remote: WorkerThreads | undefined;
  readonly serviceRemote: () => Promise<void>;
  connect(step: Step, nested: NestedCall): void;
  /** Waits for an idle promise (a display refresh, a timer) while answering worker threads. */
  idle<T>(promise: Promise<T>): Promise<T>;
  spawnDetached(pc: number, args: readonly number[], onExit?: (value: number) => unknown): number;
  onExit(handler: ExitHandler): void;
  /** The current thread's top SjLj function context. */
  unwindTop: number;
  readonly stackBottom: number;
  close(): void;
}

export function threadImports(
  cpu: ThreadCpu,
  heap: ThreadHeap,
  returnAddress: number,
  { scheduling = Scheduling.Slices }: ThreadOptions = {},
): GuestThreads {
  const table = new ThreadTable(cpu, heap, returnAddress);
  const funcs = threadImportFunctions(cpu, table);
  const nativeFunctions = threadFunctions(cpu, heap);
  const exits = new ThreadExits(table);
  const remote = cpu.workers;
  const service = new RemoteService(cpu, table, exits, remote);
  const scheduler = new CooperativeScheduler(cpu, table, exits, service, returnAddress, scheduling);
  return {
    funcs,
    nativeFunctions,
    advance: scheduler.advance,
    schedulerTurns: () => ({ ...scheduler.turns }),
    remote,
    serviceRemote: service.service,
    connect(step, nested) {
      service.connected = { step, nested };
    },
    idle: (promise) => (remote ? remote.idle(promise, service.service) : promise),
    spawnDetached: (pc, args, onExit) => table.spawn(pc, args, { detached: true }, onExit),
    onExit(handler) {
      exits.add(handler);
    },
    get unwindTop() {
      return table.unwindTop;
    },
    set unwindTop(frame: number) {
      table.unwindTop = frame;
    },
    get stackBottom() {
      return table.current.stackBottom;
    },
    close() {
      remote?.close();
      table.close();
    },
  };
}
