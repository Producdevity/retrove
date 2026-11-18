import type { FoundationHost, HostResult } from "../../objc/host";
import { objectResult } from "../host";
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
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
}
const Key = {
  NibName: "UINibName",
  View: "UIView",
  Title: "UITitle",
  FullScreen: "UIWantsFullScreenLayout",
} as const;
export function installControllerNibs(host: ControllerHost) {
  const entries = new Map<number, ControllerNib>();
  const titles = new Map<number, number>();
  /** Controllers whose view came from their own archive and still owe viewDidLoad. */
  const unloaded = new Set<number>();
  const decoded = async (coder: number, key: string) =>
    objectResult(await host.send(coder, "decodeObjectForKey:", [host.string(key)]));
  host.method(CONTROLLER_CLASS, false, "initWithCoder:", async (self, args) => {
    const coder = args(0);
    const name = await decoded(coder, Key.NibName);
    if (name) entries.set(self, { name: host.text(name), bundle: 0 });
    const view = await decoded(coder, Key.View);
    if (view) {
      await host.send(self, "setView:", [view]);
      unloaded.add(self);
    }
    const title = await decoded(coder, Key.Title);
    if (title) await host.send(self, "setTitle:", [title]);
    const fullScreen = await host.send(coder, "decodeBoolForKey:", [host.string(Key.FullScreen)]);
    if (fullScreen) await host.send(self, "setWantsFullScreenLayout:", [1]);
    return self;
  });
  host.method(CONTROLLER_CLASS, false, "title", (self) => titles.get(self) ?? 0);
  host.method(CONTROLLER_CLASS, false, "setTitle:", async (self, args) => {
    const previous = titles.get(self);
    if (args(0)) titles.set(self, host.retain(args(0)));
    else titles.delete(self);
    if (previous) await host.release(previous);
  });
  host.method(CONTROLLER_CLASS, false, "initWithNibName:bundle:", async (self, args) => {
    const previous = entries.get(self);
    entries.set(self, { name: args(0) ? host.text(args(0)) : "", bundle: host.retain(args(1)) });
    if (previous?.bundle) await host.release(previous.bundle);
    return self;
  });
  host.method(CONTROLLER_CLASS, false, "nibName", (self) => {
    const name = entries.get(self)?.name;
    return name ? host.string(name) : 0;
  });
  host.method(CONTROLLER_CLASS, false, "nibBundle", (self) => entries.get(self)?.bundle ?? 0);
  return {
    /** True once for a controller decoded with its view: UIKit sends viewDidLoad on first access. */
    owesViewDidLoad(self: number): boolean {
      return unloaded.delete(self);
    },
    async load(self: number): Promise<boolean> {
      const entry = entries.get(self);
      if (!entry?.name) return false;
      await host.load(entry.name, self, entry.bundle);
      return true;
    },
    async dispose(self: number): Promise<void> {
      const entry = entries.get(self),
        title = titles.get(self);
      entries.delete(self);
      titles.delete(self);
      unloaded.delete(self);
      if (entry?.bundle) await host.release(entry.bundle);
      if (title) await host.release(title);
    },
  };
}
