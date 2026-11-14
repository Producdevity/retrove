import { WORD_BYTES } from "../../ios/abi/scalars";
import { ALCError, ALError, MAX_NAMES_PER_CALL, OpenALError } from "./constants";
import type { GuestArguments } from "../../ios/objc/host";
import type { AudioOutput } from "./output";
import type { PCM } from "./pcm";
import type { Source } from "./source";
export type ALFunction = (args: GuestArguments) => number | void;
export interface OpenALHost {
  read(pointer: number, length: number): Uint8Array;
  readWord(pointer: number): number;
  writeWord(pointer: number, value: number): void;
  text(pointer: number): string;
  string(value: string): number;
  allocate(bytes: number): number;
  free(pointer: number): void;
  output(): AudioOutput | null;
  gate(name: string, fn: ALFunction): number;
}
export interface Device {
  readonly output: AudioOutput;
  readonly buffers: Map<number, PCM>;
  error: number;
}
export interface Context {
  readonly device: number;
  readonly sources: Map<number, Source>;
  suspended: boolean;
  error: number;
}
export const EMPTY_PCM: PCM = { channels: [], frames: 0, rate: 0, sampleBytes: 0, duration: 0 };
export class OpenALRuntime {
  readonly devices = new Map<number, Device>();
  readonly contexts = new Map<number, Context>();
  current = 0;
  error = 0;
  deviceError = 0;
  private nextName = 1;
  constructor(readonly host: OpenALHost) {}
  get context(): Context {
    const context = this.contexts.get(this.current);
    if (!context) throw new OpenALError(ALError.InvalidOperation);
    return context;
  }
  get device(): Device {
    const device = this.devices.get(this.context.device);
    if (!device) throw new OpenALError(ALError.InvalidOperation);
    return device;
  }
  source(name: number): Source {
    const source = this.context.sources.get(name);
    if (!source) throw new OpenALError(ALError.InvalidName);
    return source;
  }
  buffer(name: number): PCM {
    const pcm = this.device.buffers.get(name);
    if (!pcm) throw new OpenALError(ALError.InvalidName);
    return pcm;
  }
  names(count: number): number[] {
    if (count < 0 || count > MAX_NAMES_PER_CALL) throw new OpenALError(ALError.InvalidValue);
    return Array.from({ length: count }, () => this.nextName++);
  }
  referenced(name: number): boolean {
    for (const context of this.contexts.values())
      if (context.device === this.context.device)
        for (const source of context.sources.values())
          if (source.queue.some((buffer) => buffer.name === name)) return true;
    return false;
  }
  bind(fn: ALFunction): ALFunction {
    return (args) => {
      try {
        return fn(args);
      } catch (error) {
        if (!(error instanceof OpenALError)) throw error;
        const context = this.contexts.get(this.current);
        if (context) context.error ||= error.code;
        else this.error ||= error.code;
        return 0;
      }
    };
  }
  opaque(): number {
    const pointer = this.host.allocate(WORD_BYTES);
    if (!pointer) throw new OpenALError(ALError.OutOfMemory);
    return pointer;
  }
  destroyContext(pointer: number): void {
    const context = this.contexts.get(pointer);
    if (!context) {
      this.deviceError ||= ALCError.InvalidContext;
      return;
    }
    for (const source of context.sources.values()) source.stop();
    this.contexts.delete(pointer);
    if (this.current === pointer) this.current = 0;
    this.host.free(pointer);
  }
  close(): void {
    for (const pointer of this.contexts.keys()) this.destroyContext(pointer);
    for (const pointer of this.devices.keys()) this.host.free(pointer);
    this.devices.clear();
  }
}
