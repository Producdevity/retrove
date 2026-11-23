import type { ClassRegistry } from "./class-registry";
import { ClassField } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import { MISSING_DESTINATION } from "./guest-access";
import type { GuestArguments, HostResult } from "./host";
import type { ClassRecord, ObjcGuest } from "./runtime-types";
import { returnsStructure } from "./runtime-types";

const HEX = 16;
const NAME_LIMIT = { Class: 96, Selector: 128 } as const;
/** objc_super is the receiver and the class to start the lookup from. */
const SuperField = { Receiver: 0, Class: 4 } as const;
const STRUCTURE_RETURN_REGISTER = 1;
const RESULT_HIGH_REGISTER = 1;
const MESSAGE_ARGUMENTS = 2;
const FORWARDING_TARGET = "forwardingTargetForSelector:";
const FORWARD_INVOCATION = "forwardInvocation:";
/** objc_msgSend, objc_msgSendSuper and objc_msgSendSuper2 lookups. */
export const DispatchMode = { Normal: "normal", Super: "super", Super2: "super2" } as const;
export type DispatchMode = (typeof DispatchMode)[keyof typeof DispatchMode];
export type ForwardInvocation = (
  self: number,
  selector: number,
  args: GuestArguments,
  output?: number,
) => Promise<HostResult>;
interface LastDispatch {
  cls: ClassRecord | undefined;
  method: string;
}
export interface Messenger {
  readonly initialize: (cls: number) => Promise<void>;
  readonly dispatch: (
    arg: GuestArguments,
    mode?: DispatchMode,
    stret?: boolean,
  ) => Promise<HostResult>;
  readonly send: (
    self: number,
    name: string,
    args?: number[],
    optional?: boolean,
  ) => Promise<HostResult>;
  /** Installed once NSInvocation exists. */
  forwardInvocation: ForwardInvocation | undefined;
  readonly forgetThread: (thread: number) => void;
  readonly lastSelector: (thread: number) => string | undefined;
}
/** Runs +initialize once per class, superclasses first, as objc_msgSend does on first use. */
function classInitializer(
  { callGuest }: ObjcGuest,
  { read }: GuestAccess,
  { classes, lookup, selector }: ClassRegistry,
): (cls: number) => Promise<void> {
  const initializing = new Set<number>(),
    initialized = new Set<number>();
  async function initialize(cls: number): Promise<void> {
    if (!cls || initialized.has(cls) || initializing.has(cls)) return;
    const info = classes.get(cls);
    if (!info?.supported) throw new Error(`Unimplemented Objective-C class ${info?.name ?? cls}`);
    initializing.add(cls);
    try {
      await initialize(read(cls + ClassField.Superclass));
      const implementation = lookup(read(cls), "initialize");
      if (typeof implementation === "number")
        await callGuest(implementation, [cls, selector("initialize")]);
      initialized.add(cls);
    } finally {
      initializing.delete(cls);
    }
  }
  return initialize;
}
/** The last selector each guest thread sent, for crash reports. */
function dispatchHistory(threadId: () => number) {
  const lastDispatch = new Map<number, LastDispatch>();
  return {
    remember: (cls: ClassRecord | undefined, method: string): void => {
      const id = threadId();
      let latest = lastDispatch.get(id);
      if (!latest) {
        latest = { cls, method };
        lastDispatch.set(id, latest);
      }
      latest.cls = cls;
      latest.method = method;
    },
    forget: (thread: number) => {
      lastDispatch.delete(thread);
    },
    lastSelector: (thread: number): string | undefined => {
      const latest = lastDispatch.get(thread);
      if (!latest) return undefined;
      const { cls, method } = latest;
      return `${cls?.isMeta ? "+" : "-"}[${(cls?.name || "?").slice(0, NAME_LIMIT.Class)} ${method.slice(0, NAME_LIMIT.Selector)}]`;
    },
  };
}
/** objc_msgSend from the host: guest IMPs run as nested guest calls. */
function sender(
  { callGuest }: ObjcGuest,
  { read }: GuestAccess,
  registry: ClassRegistry,
  initialize: (cls: number) => Promise<void>,
  forward: ForwardInvocation,
): Messenger["send"] {
  const { lookup, selector } = registry;
  async function send(
    self: number,
    name: string,
    args: number[] = [],
    optional = false,
  ): Promise<HostResult> {
    if (!self) return 0;
    const cls = read(self);
    await initialize(registry.record(cls).owner);
    const implementation = lookup(cls, name);
    const argument = (index: number) => args[index] ?? 0;
    if (typeof implementation === "number")
      return callGuest(implementation, [self, selector(name), ...args]);
    if (implementation) {
      if (returnsStructure(implementation))
        return implementation(self, argument, MISSING_DESTINATION);
      return implementation(self, argument);
    }
    if (optional) return 0;
    const target = lookup(cls, FORWARDING_TARGET)
      ? await send(self, FORWARDING_TARGET, [selector(name)])
      : 0;
    if (typeof target === "number" && target && target !== self) return send(target, name, args);
    if (lookup(cls, FORWARD_INVOCATION)) return forward(self, selector(name), argument);
    throw new Error(`Unimplemented Objective-C method [${registry.record(cls).name} ${name}]`);
  }
  return send;
}
interface DispatchSteps {
  readonly initialize: (cls: number) => Promise<void>;
  readonly remember: (cls: ClassRecord | undefined, method: string) => void;
  readonly send: Messenger["send"];
  readonly forward: ForwardInvocation;
}
/** objc_msgSend from guest code: guest IMPs become tail jumps, host methods run in place. */
function dispatcher(
  cpu: ObjcGuest["cpu"],
  memory: GuestAccess,
  { classes, lookup }: ClassRegistry,
  { initialize, remember, send, forward }: DispatchSteps,
): Messenger["dispatch"] {
  const { read } = memory;
  async function dispatch(
    arg: GuestArguments,
    mode: DispatchMode = DispatchMode.Normal,
    stret = false,
  ): Promise<HostResult> {
    const r = stret ? STRUCTURE_RETURN_REGISTER : 0;
    let self = arg(r),
      start: number | undefined;
    if (mode !== DispatchMode.Normal) {
      const superInfo = self;
      self = read(superInfo + SuperField.Receiver);
      const current = read(superInfo + SuperField.Class);
      start = mode === DispatchMode.Super2 ? read(current + ClassField.Superclass) : current;
      cpu.setReg(r, self);
    }
    if (!self) {
      if (!stret) cpu.setReg(RESULT_HIGH_REGISTER, 0);
      return stret ? arg(0) : 0;
    }
    start ??= read(self);
    const name = memory.cString(arg(r + 1));
    const first = classes.get(start);
    remember(first, name);
    if (!first) throw new Error(`Unknown Objective-C receiver class at 0x${start.toString(HEX)}`);
    await initialize(first.owner);
    const implementation = lookup(start, name);
    if (typeof implementation === "number") return { jump: implementation };
    if (!implementation) {
      const target = lookup(start, FORWARDING_TARGET)
        ? await send(self, FORWARDING_TARGET, [arg(r + 1)])
        : 0;
      if (typeof target === "number" && target && target !== self)
        return dispatch((index) => (index === r ? target : arg(index)), DispatchMode.Normal, stret);
      if (lookup(start, FORWARD_INVOCATION))
        return forward(
          self,
          arg(r + 1),
          (index) => arg(index + r + MESSAGE_ARGUMENTS),
          stret ? arg(0) : undefined,
        );
      const info = classes.get(start);
      throw new Error(
        `Unimplemented Objective-C method ${info?.isMeta ? "+" : "-"}[${info?.name} ${name}]`,
      );
    }
    if (stret !== returnsStructure(implementation))
      throw new Error(`Unsupported return ABI for ${name}`);
    if (returnsStructure(implementation)) {
      await implementation(self, (index) => arg(index + MESSAGE_ARGUMENTS + 1), arg(0));
      return arg(0);
    }
    return implementation(self, (index) => arg(index + MESSAGE_ARGUMENTS));
  }
  return dispatch;
}
export function messenger(
  guest: ObjcGuest,
  memory: GuestAccess,
  registry: ClassRegistry,
  threadId: () => number,
): Messenger {
  const initialize = classInitializer(guest, memory, registry),
    history = dispatchHistory(threadId);
  const forward: ForwardInvocation = (self, name, args, output) => {
    if (!api.forwardInvocation)
      throw new ReferenceError("Cannot access 'forwardInvocation' before initialization");
    return api.forwardInvocation(self, name, args, output);
  };
  const send = sender(guest, memory, registry, initialize, forward);
  const dispatch = dispatcher(guest.cpu, memory, registry, {
    initialize,
    remember: history.remember,
    send,
    forward,
  });
  const api: Messenger = {
    initialize,
    dispatch,
    send,
    forwardInvocation: undefined,
    forgetThread: history.forget,
    lastSelector: history.lastSelector,
  };
  return api;
}
