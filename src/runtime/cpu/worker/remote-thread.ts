import type { StateLayout } from "../translation/layout";
import { RequestKind, ResponseKind, type ChannelRequest, type ThreadChannel } from "./channel";
import type { ModuleRegistry } from "./module-registry";
import { ExecutionMessage, isFailedMessage, type ExecutionPort } from "./protocol";
import { Preemption } from "./preemption";
import { stateLayout } from "../translation/layout";

/** What the main thread's CPU does for a guest thread running on an execution worker. */
export interface WorkerCpu {
  readonly layout: StateLayout;
  /** View over the shared guest memory, state blocks included. */
  readonly view: DataView;
  /** Makes sure translated code exists for `pc` (as the CPU's own run loop would); returns its table slot. */
  prepareCode(pc: number, tries: number, missing: boolean): number;
  /** Takes the registers of the state block at `base` so host functions read and write them. */
  adoptThread(base: number, pc: number): void;
  /** Copies the registers back to the state block at `base`. */
  returnThread(base: number): void;
}
/** A request the runtime services: a host call at a gate, or the thread returning to its end. */
export interface RemoteRequest {
  readonly exit: boolean;
  readonly pc: number;
}

const RESULT_REGISTER = 0;
const WORD_BYTES = 4;

/** The main thread's side of one guest thread running on an execution worker. */
export class RemoteThread {
  #failure: Error | undefined;
  /** Main-thread milliseconds spent running this thread's host calls. */
  hostMs = 0;
  codeRequests = 0;
  #entered = 0;
  #preemption: Preemption | undefined;
  constructor(
    private readonly cpu: WorkerCpu,
    private readonly registry: ModuleRegistry,
    readonly port: ExecutionPort,
    readonly channel: ThreadChannel,
    /** Host address of the thread's state block. */
    readonly base: number,
    private readonly release: () => void,
    /** The thread's EAGL rendering API and context; read when the thread resumes. */
    private readonly graphicsState: () => readonly [number, number] | undefined = () => undefined,
  ) {}
  /** Ends the worker's current slice early so it answers the main thread's request now. */
  preempt(): void {
    this.#preemption ??= new Preemption(
      this.cpu.view.buffer,
      stateLayout(this.base, this.cpu.layout, this.cpu.layout.index).budget,
    );
    this.#preemption.trigger();
  }
  /** Records a failure the worker reported; the next `take` throws it. */
  listen(message: unknown): void {
    if (isFailedMessage(message)) this.#failure = new Error(`Execution worker: ${message.message}`);
  }
  /** The waiting host call or exit; code requests are answered here and return undefined. */
  take(): RemoteRequest | undefined {
    if (this.#failure) throw this.#failure;
    const request = this.channel.take();
    if (!request) return undefined;
    if (request.kind === RequestKind.Code) {
      this.#code(request);
      return undefined;
    }
    return { exit: request.kind === RequestKind.Exit, pc: request.pc };
  }
  #code(request: ChannelRequest): void {
    this.codeRequests++;
    const slot = this.cpu.prepareCode(request.pc, request.tries, request.missing),
      compiled = this.registry.at(slot);
    if (!compiled) throw new Error(`No compiled module for table slot ${slot}.`);
    this.channel.respond(ResponseKind.Code);
    this.port.post({
      type: ExecutionMessage.Code,
      generation: this.registry.control.generation,
      compiled,
      index: this.cpu.layout.index,
    });
  }
  /** Loads the thread's registers into the CPU for the host function. */
  enter(pc: number): void {
    this.#entered = performance.now();
    this.cpu.adoptThread(this.base, pc);
  }
  /** Stores the CPU's registers back into the thread's state block. */
  leave(): void {
    this.cpu.returnThread(this.base);
    this.hostMs += performance.now() - this.#entered;
  }
  /** Lets the worker continue at `pc`, with r0 set when a blocking call finished. */
  resume(pc: number, result?: number): void {
    if (result !== undefined)
      this.cpu.view.setUint32(this.base + WORD_BYTES * RESULT_REGISTER, result >>> 0, true);
    const graphics = this.graphicsState();
    if (graphics) this.channel.setGraphicsState(...graphics);
    this.channel.respond(ResponseKind.Resume, pc);
  }
  /** Ends the thread on the worker and frees its state block. */
  finish(): void {
    this.channel.respond(ResponseKind.Finish);
    this.release();
  }
}
