import { WORD_BYTES } from "../abi/scalars";
import type { RunLoopSources } from "../foundation/run-loop-sources";
import type { HostMethod } from "../objc/host";
import type { CFNetworkHost } from "./host";

/** CFStreamStatus. */
export const StreamStatus = { NotOpen: 0, Opening: 1, Open: 2, Closed: 6, Error: 7 } as const;
/** CFStreamEventType. */
export const StreamEvent = { ErrorOccurred: 8 } as const;
/** CFStreamErrorDomainPOSIX with ENETUNREACH: the guest has no routed network interface. */
const OFFLINE = { domain: 1, code: 51 } as const;
const POSIX_DOMAIN = "NSPOSIXErrorDomain";
/** Word offsets in CFStreamClientContext. */
const Client = { Version: 0, Info: 1, Retain: 2, Release: 3 } as const;
const READ_FAILED = -1;
const STREAM_CLASS = "__CFNetworkStream";

interface StreamState {
  status: number;
  events: number;
  callback: number;
  info: number;
  releaseInfo: number;
  readonly properties: Map<string, number>;
  readonly retained: number[];
  readonly source: number;
  readonly scheduled: Map<string, readonly [number, number]>;
}

/** CFReadStream and CFWriteStream over a network that is never reachable. */
export class OfflineStreams {
  private readonly streams = new Map<number, StreamState>();
  private readonly klass: number;
  constructor(
    private readonly host: CFNetworkHost,
    private readonly sources: RunLoopSources,
  ) {
    this.klass = host.hostClass(STREAM_CLASS, "NSObject");
    this.installStreamMethods();
    host.method(STREAM_CLASS, false, "dealloc", async (self) => {
      const state = this.streams.get(self);
      this.streams.delete(self);
      if (state) await this.dispose(state);
      host.destroy(self);
    });
  }
  /** NSInputStream and NSOutputStream are toll-free bridged with the CF streams. */
  private installStreamMethods(): void {
    const method = (selector: string, run: HostMethod) => {
      this.host.method(STREAM_CLASS, false, selector, run);
    };
    method("open", (self) => {
      this.open(self);
    });
    method("close", (self) => {
      this.close(self);
    });
    method("streamStatus", (self) => this.status(self));
    method("streamError", (self) => {
      const error = this.copyError(self);
      return error ? this.host.autorelease(error) : 0;
    });
    method("hasBytesAvailable", () => 0);
    method("hasSpaceAvailable", () => 0);
    method("read:maxLength:", () => this.read());
    method("write:maxLength:", () => this.read());
    method("scheduleInRunLoop:forMode:", (self, args) => this.schedule(self, args(0), args(1)));
    method("removeFromRunLoop:forMode:", (self, args) => this.unschedule(self, args(0), args(1)));
    method("propertyForKey:", (self, args) => {
      const value = this.copyProperty(self, args(0));
      return value ? this.host.autorelease(value) : 0;
    });
    method("setProperty:forKey:", (self, args) => this.setProperty(self, args(1), args(0)));
  }
  /** Retains `owned` objects, such as the request message, for the stream's lifetime. */
  create(owned: readonly number[]): number {
    const pointer = this.host.alloc(this.klass),
      state: StreamState = {
        status: StreamStatus.NotOpen,
        events: 0,
        callback: 0,
        info: 0,
        releaseInfo: 0,
        properties: new Map(),
        retained: owned.filter(Boolean).map((value) => this.host.retain(value)),
        source: this.sources.createHost(() => this.deliver(pointer)),
        scheduled: new Map(),
      };
    this.streams.set(pointer, state);
    return pointer;
  }
  private get(pointer: number): StreamState | undefined {
    return this.streams.get(pointer);
  }
  private async dispose(state: StreamState): Promise<void> {
    await this.sources.invalidate(state.source);
    await this.host.release(state.source);
    if (state.releaseInfo && state.info) await this.host.callGuest(state.releaseInfo, [state.info]);
    for (const value of [...state.properties.values(), ...state.retained])
      await this.host.release(value);
  }
  private async deliver(pointer: number): Promise<void> {
    const state = this.get(pointer);
    if (!state?.callback || !(state.events & StreamEvent.ErrorOccurred)) return;
    if (state.status !== StreamStatus.Error) return;
    await this.host.callGuest(state.callback, [pointer, StreamEvent.ErrorOccurred, state.info]);
  }
  open(pointer: number): number {
    const state = this.get(pointer);
    if (!state || state.status !== StreamStatus.NotOpen) return 0;
    state.status = StreamStatus.Error;
    this.sources.signal(state.source);
    for (const [loop] of state.scheduled.values()) this.sources.wake(loop);
    return 1;
  }
  close(pointer: number): void {
    const state = this.get(pointer);
    if (state) state.status = StreamStatus.Closed;
  }
  status(pointer: number): number {
    return this.get(pointer)?.status ?? StreamStatus.Error;
  }
  writeError(destination: number, pointer: number): void {
    const failed = this.get(pointer)?.status === StreamStatus.Error;
    this.host.write(destination, failed ? OFFLINE.domain : 0);
    this.host.write(destination + WORD_BYTES, failed ? OFFLINE.code : 0);
  }
  copyError(pointer: number): number {
    return this.get(pointer)?.status === StreamStatus.Error
      ? this.host.error(POSIX_DOMAIN, OFFLINE.code)
      : 0;
  }
  read(): number {
    return READ_FAILED;
  }
  async setClient(
    pointer: number,
    events: number,
    callback: number,
    context: number,
  ): Promise<number> {
    const state = this.get(pointer);
    if (!state) return 0;
    if (state.releaseInfo && state.info) await this.host.callGuest(state.releaseInfo, [state.info]);
    const word = (index: number): number =>
        context ? this.host.read(context + index * WORD_BYTES) : 0,
      retain = word(Client.Retain);
    state.events = callback ? events : 0;
    state.callback = callback;
    state.info =
      callback && retain
        ? await this.host.callGuest(retain, [word(Client.Info)])
        : word(Client.Info);
    state.releaseInfo = callback ? word(Client.Release) : 0;
    return 1;
  }
  async schedule(pointer: number, loop: number, mode: number): Promise<void> {
    const state = this.get(pointer);
    if (!state) return;
    state.scheduled.set(`${loop}:${this.host.text(mode)}`, [loop, mode]);
    await this.sources.add(loop, state.source, mode);
  }
  async unschedule(pointer: number, loop: number, mode: number): Promise<void> {
    const state = this.get(pointer);
    if (!state) return;
    state.scheduled.delete(`${loop}:${this.host.text(mode)}`);
    await this.sources.remove(loop, state.source, mode);
  }
  async setProperty(pointer: number, key: number, value: number): Promise<number> {
    const state = this.get(pointer);
    if (!state || !key) return 0;
    const name = this.host.text(key),
      old = state.properties.get(name);
    if (value) state.properties.set(name, this.host.retain(value));
    else state.properties.delete(name);
    if (old) await this.host.release(old);
    return 1;
  }
  copyProperty(pointer: number, key: number): number {
    const value = key ? this.get(pointer)?.properties.get(this.host.text(key)) : undefined;
    return value ? this.host.retain(value) : 0;
  }
}
