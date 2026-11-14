import { Argument, type FoundationHost, type HostResult } from "../objc/host";
export const RunLoopMode = {
  Default: "kCFRunLoopDefaultMode",
  Common: "kCFRunLoopCommonModes",
} as const;
const PORT_CLASS = "NSPort";
const MACH_PORT_CLASS = "NSMachPort";
const RUN_LOOP_CLASS = "NSRunLoop";
const MILLISECONDS_PER_SECOND = 1000;
const DOUBLE_BYTES = 8;
export interface PortHost extends FoundationHost {
  hasPendingSource?(loop: number, mode: string): boolean;
  pollSources?(loop: number, mode: string): Promise<boolean>;
  send(self: number, name: string, args?: number[]): Promise<HostResult>;
  waitMethod(
    className: string,
    name: string,
    implementation: (
      self: number,
      args: (index: number) => number,
    ) => Promise<number | { wait(): number | undefined }>,
  ): void;
}
interface Registration {
  readonly port: number;
  readonly mode: string;
}
export class PortRunLoops {
  private readonly ports = new Set<number>();
  private readonly registrations = new Map<number, Registration[]>();
  private readonly modes = new Map<number, string>();
  constructor(private readonly host: PortHost) {}
  initialize(self: number): number {
    this.ports.add(self);
    return self;
  }
  valid(self: number): boolean {
    return this.ports.has(self);
  }
  add(loop: number, port: number, mode: number): void {
    if (!this.valid(port)) throw new Error("Cannot add an invalid port to a run loop.");
    const name = this.host.text(mode),
      entries = this.registrations.get(loop) ?? [];
    if (!entries.some((entry) => entry.port === port && entry.mode === name))
      entries.push({ port: this.host.retain(port), mode: name });
    this.registrations.set(loop, entries);
  }
  async remove(loop: number, port: number, mode: number): Promise<void> {
    const name = this.host.text(mode),
      entries = this.registrations.get(loop) ?? [];
    this.registrations.set(
      loop,
      entries.filter((entry) => entry.port !== port || entry.mode !== name),
    );
    for (const entry of entries)
      if (entry.port === port && entry.mode === name) await this.host.release(port);
  }
  async invalidate(port: number): Promise<void> {
    this.ports.delete(port);
    for (const [loop, entries] of this.registrations) {
      this.registrations.set(
        loop,
        entries.filter((entry) => entry.port !== port),
      );
      for (const entry of entries) if (entry.port === port) await this.host.release(port);
    }
  }
  private hasSource(loop: number, mode: string): boolean {
    return (
      this.registrations
        .get(loop)
        ?.some((entry) => entry.mode === mode && this.valid(entry.port)) ?? false
    );
  }
  async run(
    loop: number,
    mode: number,
    date: number,
  ): Promise<number | { wait(): number | undefined }> {
    const name = this.host.text(mode),
      previous = this.modes.get(loop);
    this.modes.set(loop, name);
    try {
      if (await this.host.pollSources?.(loop, name)) return 1;
    } finally {
      if (previous === undefined) this.modes.delete(loop);
      else this.modes.set(loop, previous);
    }
    if (!this.hasSource(loop, name)) return 0;
    const value = await this.host.send(date, "timeIntervalSince1970");
    if (typeof value !== "bigint") throw new Error("Invalid run loop deadline.");
    const scratch = new DataView(new ArrayBuffer(DOUBLE_BYTES));
    scratch.setBigUint64(0, value, true);
    const deadline = scratch.getFloat64(0, true) * MILLISECONDS_PER_SECOND;
    if (!Number.isFinite(deadline)) throw new Error("Invalid run loop deadline.");
    if (Date.now() >= deadline) return 1;
    this.modes.set(loop, name);
    return {
      wait: () => {
        if (
          Date.now() < deadline &&
          this.hasSource(loop, name) &&
          !this.host.hasPendingSource?.(loop, name)
        )
          return;
        this.modes.delete(loop);
        return 1;
      },
    };
  }
  destroy(self: number): void {
    this.ports.delete(self);
    this.host.destroy(self);
  }
  currentMode(loop: number): number {
    const mode = this.modes.get(loop);
    return mode === undefined ? 0 : this.host.string(mode);
  }
}
export function installPorts(host: PortHost): PortRunLoops {
  const ports = new PortRunLoops(host);
  host.hostClass(PORT_CLASS, "NSObject");
  const mach = host.hostClass(MACH_PORT_CLASS, PORT_CLASS);
  host.method(PORT_CLASS, true, "port", () => host.autorelease(ports.initialize(host.alloc(mach))));
  host.method(PORT_CLASS, false, "init", (self) => ports.initialize(self));
  host.method(PORT_CLASS, false, "isValid", (self) => Number(ports.valid(self)));
  host.method(PORT_CLASS, false, "invalidate", (self) => ports.invalidate(self));
  host.method(PORT_CLASS, false, "dealloc", (self) => {
    ports.destroy(self);
  });
  host.method(RUN_LOOP_CLASS, false, "addPort:forMode:", (self, args) =>
    ports.add(self, args(Argument.First), args(Argument.Second)),
  );
  host.method(RUN_LOOP_CLASS, false, "removePort:forMode:", (self, args) =>
    ports.remove(self, args(Argument.First), args(Argument.Second)),
  );
  host.method(RUN_LOOP_CLASS, false, "currentMode", (self) => ports.currentMode(self));
  host.waitMethod(RUN_LOOP_CLASS, "runMode:beforeDate:", (self, args) =>
    ports.run(self, args(Argument.First), args(Argument.Second)),
  );
  return ports;
}
