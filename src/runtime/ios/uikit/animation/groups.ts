import { doubleFromBits } from "../../abi/scalars";
import type { FoundationHost, HostResult } from "../../objc/host";
const VIEW_CLASS = "UIView";
const DEFAULT_DURATION = 0.2;
const MILLISECONDS_PER_SECOND = 1000;
const CURVES = ["ease-in-out", "ease-in", "ease-out", "linear"] as const;
interface Timing {
  duration: number;
  delay: number;
  curve: string;
  start: number;
}
interface Group {
  readonly identifier: number;
  readonly context: number;
  readonly timing: Timing;
  delegate: number;
  willStart: string;
  didStop: string;
}
interface AnimationHost extends Pick<FoundationHost, "method" | "retain" | "release"> {
  thread(): number;
  now(): number;
  selectorName(pointer: number): string;
  send(self: number, selector: string, args: number[]): Promise<HostResult>;
}
class AnimationGroups {
  readonly stacks = new Map<number, Group[]>();
  readonly waiting: { group: Group; deadline: number }[] = [];
  enabled = true;
  constructor(readonly host: AnimationHost) {}
  current() {
    return this.stacks.get(this.host.thread())?.at(-1);
  }
  requireGroup() {
    const group = this.current();
    if (!group) throw new Error("UIView animation setting outside beginAnimations.");
    return group;
  }
  begin(identifier: number, context: number) {
    const thread = this.host.thread();
    let stack = this.stacks.get(thread);
    if (!stack) {
      stack = [];
      this.stacks.set(thread, stack);
    }
    stack.push({
      identifier: this.host.retain(identifier),
      context,
      timing: { duration: DEFAULT_DURATION, delay: 0, curve: CURVES[0], start: this.host.now() },
      delegate: 0,
      willStart: "",
      didStop: "",
    });
  }
  async dispose(group: Group) {
    await this.host.release(group.identifier);
    await this.host.release(group.delegate);
  }
  async commit() {
    const thread = this.host.thread(),
      stack = this.stacks.get(thread),
      group = stack?.pop();
    if (!group) throw new Error("Unbalanced UIView animation commit.");
    if (!stack?.length) this.stacks.delete(thread);
    group.timing.start = this.host.now();
    if (!this.enabled) group.timing.duration = 0;
    try {
      if (group.delegate && group.willStart)
        await this.host.send(group.delegate, group.willStart, [group.identifier, group.context]);
    } catch (error) {
      await this.dispose(group);
      throw error;
    }
    this.waiting.push({
      group,
      deadline:
        group.timing.start + (group.timing.delay + group.timing.duration) * MILLISECONDS_PER_SECOND,
    });
  }
  context() {
    return this.enabled ? this.current()?.timing : undefined;
  }
  async pump() {
    const due = this.waiting.filter((value) => value.deadline <= this.host.now());
    for (const item of due) {
      const index = this.waiting.indexOf(item);
      if (index < 0) continue;
      this.waiting.splice(index, 1);
      const group = item.group;
      try {
        if (group.delegate && group.didStop)
          await this.host.send(group.delegate, group.didStop, [group.identifier, 1, group.context]);
      } finally {
        await this.dispose(group);
      }
    }
  }
  pending() {
    return this.waiting.length > 0;
  }
}
export function installAnimationGroups(host: AnimationHost) {
  const groups = new AnimationGroups(host),
    requireGroup = () => groups.requireGroup();
  host.method(VIEW_CLASS, true, "beginAnimations:context:", (_, args) =>
    groups.begin(args(0), args(1)),
  );
  for (const [name, key] of [
    ["setAnimationDuration:", "duration"],
    ["setAnimationDelay:", "delay"],
  ] as const)
    host.method(VIEW_CLASS, true, name, (_, args) => {
      const value = doubleFromBits(args(0), args(1));
      if (!Number.isFinite(value) || value < 0)
        throw new Error("Invalid UIView animation interval.");
      requireGroup().timing[key] = value;
    });
  host.method(VIEW_CLASS, true, "setAnimationCurve:", (_, args) => {
    const curve = CURVES[args(0)];
    if (!curve) throw new Error("Invalid UIView animation curve.");
    requireGroup().timing.curve = curve;
  });
  host.method(VIEW_CLASS, true, "setAnimationDelegate:", async (_, args) => {
    const group = requireGroup(),
      old = group.delegate;
    group.delegate = host.retain(args(0));
    await host.release(old);
  });
  for (const [name, key] of [
    ["setAnimationWillStartSelector:", "willStart"],
    ["setAnimationDidStopSelector:", "didStop"],
  ] as const)
    host.method(VIEW_CLASS, true, name, (_, args) => {
      requireGroup()[key] = args(0) ? host.selectorName(args(0)) : "";
    });
  // Animations render as CSS transitions, which already start from the in-flight value YES asks for.
  host.method(VIEW_CLASS, true, "setAnimationBeginsFromCurrentState:", () => {
    requireGroup();
  });
  host.method(VIEW_CLASS, true, "setAnimationsEnabled:", (_, args) => {
    groups.enabled = Boolean(args(0));
  });
  host.method(VIEW_CLASS, true, "areAnimationsEnabled", () => Number(groups.enabled));
  host.method(VIEW_CLASS, true, "commitAnimations", () => groups.commit());
  return groups;
}
