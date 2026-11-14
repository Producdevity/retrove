import { Argument } from "../objc/host";
import type { FoundationHost } from "../objc/host";
import { RunLoopMode } from "./ports";
const CONNECTION_CLASS = "NSURLConnection";
interface Response {
  data?: number;
  response?: number;
  error?: number;
}
interface Result {
  data: number;
  response: number;
  error: number;
}
interface ConnectionHost extends Pick<
  FoundationHost,
  "method" | "alloc" | "destroy" | "autorelease" | "retain" | "release" | "text"
> {
  supported(request: number): boolean;
  currentLoop(): number;
  load(request: number): Promise<Response>;
  notify(delegate: number, selector: string, args: number[]): Promise<void>;
}
type Stage = "response" | "data" | "finish" | "error";
interface Connection {
  request: number;
  delegate: number;
  started: boolean;
  pending: boolean;
  cancelled: boolean;
  delivering: boolean;
  held: boolean;
  schedules: Map<number, Set<string>>;
  result: Result | undefined;
  stage: Stage;
}
class URLConnections {
  private readonly connections = new Map<number, Connection>();
  constructor(private readonly host: ConnectionHost) {}
  create(self: number, request: number, delegate: number, immediate: boolean): number {
    if (!this.host.supported(request)) {
      this.host.destroy(self);
      return 0;
    }
    this.connections.set(self, {
      request: this.host.retain(request),
      delegate: this.host.retain(delegate),
      started: false,
      pending: false,
      cancelled: false,
      delivering: false,
      held: false,
      schedules: new Map(),
      result: undefined,
      stage: "response",
    });
    if (immediate) this.start(self);
    return self;
  }
  start(self: number): void {
    const connection = this.connections.get(self);
    if (!connection || connection.started || connection.cancelled) return;
    connection.started = true;
    connection.pending = true;
    this.host.retain(self);
    connection.held = true;
    if (!connection.schedules.size)
      this.schedule(self, this.host.currentLoop(), RunLoopMode.Default);
  }
  schedule(self: number, loop: number, mode: string): void {
    const connection = this.connections.get(self);
    if (!connection || !loop) return;
    let modes = connection.schedules.get(loop);
    if (!modes) {
      modes = new Set();
      connection.schedules.set(loop, modes);
    }
    modes.add(mode);
  }
  unschedule(self: number, loop: number, mode: string): void {
    const schedules = this.connections.get(self)?.schedules,
      modes = schedules?.get(loop);
    modes?.delete(mode);
    if (modes?.size === 0) schedules?.delete(loop);
  }
  private matches(connection: Connection, loop: number, mode: string): boolean {
    const modes = connection.schedules.get(loop);
    return Boolean(
      modes?.has(mode) || (mode === RunLoopMode.Default && modes?.has(RunLoopMode.Common)),
    );
  }
  async cancel(self: number): Promise<void> {
    const connection = this.connections.get(self);
    if (!connection) return;
    connection.cancelled = true;
    connection.pending = false;
    await this.finish(self, connection);
  }
  private async finish(self: number, connection: Connection): Promise<void> {
    if (connection.delivering) return;
    const result = connection.result;
    connection.result = undefined;
    if (result)
      for (const pointer of [result.data, result.response, result.error])
        await this.host.release(pointer);
    if (connection.held) {
      connection.held = false;
      await this.host.release(self);
    }
  }
  async destroy(self: number): Promise<void> {
    const connection = this.connections.get(self);
    this.connections.delete(self);
    if (connection) {
      await this.host.release(connection.request);
      await this.host.release(connection.delegate);
    }
    this.host.destroy(self);
  }
  private async receive(self: number, connection: Connection): Promise<void> {
    const result = connection.result;
    if (!result) return;
    switch (connection.stage) {
      case "error":
        connection.pending = false;
        await this.host.notify(connection.delegate, "connection:didFailWithError:", [
          self,
          result.error,
        ]);
        break;
      case "response":
        connection.stage = "data";
        await this.host.notify(connection.delegate, "connection:didReceiveResponse:", [
          self,
          result.response,
        ]);
        break;
      case "data":
        connection.stage = "finish";
        if (result.data)
          await this.host.notify(connection.delegate, "connection:didReceiveData:", [
            self,
            result.data,
          ]);
        break;
      case "finish":
        connection.pending = false;
        await this.host.notify(connection.delegate, "connectionDidFinishLoading:", [self]);
        break;
    }
  }
  async pump(loop: number, mode: string): Promise<boolean> {
    let handled = false;
    for (const [self, connection] of [...this.connections]) {
      if (!connection.pending || connection.delivering || !this.matches(connection, loop, mode))
        continue;
      connection.delivering = true;
      try {
        if (!connection.result) {
          const loaded = await this.host.load(connection.request);
          connection.result = {
            data: this.host.retain(loaded.data ?? 0),
            response: this.host.retain(loaded.response ?? 0),
            error: this.host.retain(loaded.error ?? 0),
          };
          connection.stage = connection.result.error ? "error" : "response";
        }
        while (
          connection.pending &&
          !connection.cancelled &&
          this.matches(connection, loop, mode)
        ) {
          handled = true;
          await this.receive(self, connection);
        }
      } catch (error) {
        connection.pending = false;
        throw error;
      } finally {
        connection.delivering = false;
        if (!connection.pending) await this.finish(self, connection);
      }
    }
    return handled;
  }
  pending(): number {
    return [...this.connections.values()].filter((c) => c.pending).length;
  }
}
export function installURLConnections(host: ConnectionHost): URLConnections {
  const connections = new URLConnections(host);
  host.method(CONNECTION_CLASS, true, "canHandleRequest:", (_, args) =>
    Number(host.supported(args(0))),
  );
  host.method(CONNECTION_CLASS, true, "connectionWithRequest:delegate:", (cls, args) =>
    host.autorelease(connections.create(host.alloc(cls), args(0), args(1), true)),
  );
  for (const immediate of [true, false]) {
    const selector = "initWithRequest:delegate:" + (immediate ? "" : "startImmediately:");
    host.method(CONNECTION_CLASS, false, selector, (self, args) =>
      connections.create(self, args(0), args(1), immediate || Boolean(args(Argument.Third))),
    );
  }
  host.method(CONNECTION_CLASS, false, "start", (self) => connections.start(self));
  host.method(CONNECTION_CLASS, false, "cancel", (self) => connections.cancel(self));
  host.method(CONNECTION_CLASS, false, "scheduleInRunLoop:forMode:", (self, args) =>
    connections.schedule(self, args(0), host.text(args(1))),
  );
  host.method(CONNECTION_CLASS, false, "unscheduleFromRunLoop:forMode:", (self, args) =>
    connections.unschedule(self, args(0), host.text(args(1))),
  );
  host.method(CONNECTION_CLASS, false, "dealloc", (self) => connections.destroy(self));
  return connections;
}
