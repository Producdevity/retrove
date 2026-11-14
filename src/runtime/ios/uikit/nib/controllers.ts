import type { FoundationHost } from "../../objc/host";
const CONTROLLER_CLASS = "UIViewController";
interface ControllerNib {
  readonly name: string;
  readonly bundle: number;
}
interface ControllerHost extends Pick<
  FoundationHost,
  "method" | "text" | "string" | "retain" | "release"
> {
  load(name: string, owner: number, bundle: number): Promise<number>;
}
export function installControllerNibs(host: ControllerHost) {
  const entries = new Map<number, ControllerNib>();
  host.method(CONTROLLER_CLASS, false, "initWithNibName:bundle:", async (self, args) => {
    const previous = entries.get(self);
    entries.set(self, { name: args(0) ? host.text(args(0)) : "", bundle: host.retain(args(1)) });
    if (previous) await host.release(previous.bundle);
    return self;
  });
  host.method(CONTROLLER_CLASS, false, "nibName", (self) => {
    const name = entries.get(self)?.name;
    return name ? host.string(name) : 0;
  });
  host.method(CONTROLLER_CLASS, false, "nibBundle", (self) => entries.get(self)?.bundle ?? 0);
  return {
    async load(self: number): Promise<boolean> {
      const entry = entries.get(self);
      if (!entry?.name) return false;
      await host.load(entry.name, self, entry.bundle);
      return true;
    },
    async dispose(self: number): Promise<void> {
      const entry = entries.get(self);
      entries.delete(self);
      if (entry) await host.release(entry.bundle);
    },
  };
}
