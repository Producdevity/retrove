import type { geometry } from "../../graphics/core-graphics/geometry";
import { cfNetwork } from "../cfnetwork/cfnetwork";
import type { Exceptions } from "./app-services";
import { ClassField } from "./class-registry";
import type { ObjcCore } from "./core";
import { DispatchMode } from "./messaging";
import type { FoundationFrameworks } from "./foundation-frameworks";
import { foundationFunctions } from "./foundation-functions";
import { Argument, type GuestArguments, type HostResult } from "./host";
import type { InvocationRuntime } from "./invocation-calls";
import { propertyAccessors, structCopyImports } from "./properties";
import { protocolMethodImports } from "./protocol-methods";
import { reflectionImports } from "./reflection";
import { runtimeMethodImports } from "./runtime-methods";
import { pointerResult } from "./runtime-types";
import type { Association } from "./root-object";

const HEX = 16;
const POLICY_MASK = 0xff;
/** objc_AssociationPolicy values that take a reference; the others are assign. */
const AssociationPolicy = { Retain: 1, Copy: 3 } as const;
const SYNC_NOT_OWNING_THREAD = -1;
export type GuestFunctions = Record<string, (args: GuestArguments) => unknown>;
export type Geometry = ReturnType<typeof geometry>;
export interface ExceptionThrowing {
  readonly throwException: (exception: number) => Promise<HostResult>;
  readonly functions: GuestFunctions;
}
/** objc_exception_throw and the uncaught exception handler it calls before failing. */
export function exceptionThrowing(core: ObjcCore, exceptions: () => Exceptions): ExceptionThrowing {
  const { guest, options } = core;
  let uncaughtHandler = 0;
  const uncaught = async (exception: number) => {
    if (uncaughtHandler) await guest.callGuest(uncaughtHandler, [exception]);
  };
  const throwException = async (exception: number): Promise<HostResult> => {
    if (options.cxx) return options.cxx.throwObjC(exception, () => uncaught(exception));
    await uncaught(exception);
    const description = exceptions().describe(exception);
    throw new Error(
      `Uncaught guest Objective-C exception at 0x${exception.toString(HEX)}${description ? ` (${description})` : ""}`,
    );
  };
  return {
    throwException,
    functions: {
      _NSSetUncaughtExceptionHandler: (a: GuestArguments) => {
        uncaughtHandler = a(Argument.First);
      },
      _NSGetUncaughtExceptionHandler: () => uncaughtHandler,
      _objc_exception_throw: (a: GuestArguments) => throwException(a(Argument.First)),
    },
  };
}
/** Associated objects, fast enumeration mutation and @synchronized monitors. */
function objectFunctions({ root, ownership, messenger }: ObjcCore): GuestFunctions {
  const monitors = new Map<number, { readonly owner: number; depth: number }>();
  return {
    _objc_setAssociatedObject: async (a: GuestArguments) => {
      const owner = a(Argument.First),
        key = a(Argument.Second),
        object = a(Argument.Third),
        policy = a(Argument.Fourth) & POLICY_MASK;
      if (!owner) return;
      let map = root.associations.get(owner);
      if (!map) root.associations.set(owner, (map = new Map<number, Association>()));
      const value = object
        ? policy === AssociationPolicy.Copy
          ? pointerResult(await messenger.send(object, "copy"))
          : policy === AssociationPolicy.Retain
            ? ownership.retain(object)
            : object
        : 0;
      const old = map.get(key);
      if (value) map.set(key, { value, policy });
      else map.delete(key);
      if (old?.policy) await ownership.releaseFromHost(old.value);
    },
    _objc_getAssociatedObject: (a: GuestArguments) =>
      root.associations.get(a(0))?.get(a(1))?.value ?? 0,
    _objc_enumerationMutation: () => {
      throw new Error("Collection mutated during guest fast enumeration");
    },
    _objc_sync_enter: (a: GuestArguments) => {
      const object = a(0),
        owner = ownership.threadId();
      if (!object) return 0;
      const take = () => {
        const monitor = monitors.get(object);
        if (monitor && monitor.owner !== owner) return undefined;
        if (monitor) monitor.depth++;
        else monitors.set(object, { owner, depth: 1 });
        return 0;
      };
      return take() ?? { wait: take };
    },
    _objc_sync_exit: (a: GuestArguments) => {
      const object = a(0),
        monitor = monitors.get(object);
      if (!object) return 0;
      if (!monitor || monitor.owner !== ownership.threadId()) return SYNC_NOT_OWNING_THREAD;
      if (!--monitor.depth) monitors.delete(object);
      return 0;
    },
  };
}
/** UIApplicationMain, objc_msgSend and its variants, and selector and class lookup. */
function messagingFunctions(
  core: ObjcCore,
  applicationMain: (args: GuestArguments) => Promise<never>,
): GuestFunctions {
  const { memory, registry, messenger, root } = core;
  const { dispatch } = messenger;
  return {
    _UIApplicationMain: applicationMain,
    _objc_msgSend: (a: GuestArguments) => dispatch(a),
    _objc_msgSendSuper2: (a: GuestArguments) => dispatch(a, DispatchMode.Super2),
    _objc_msgSendSuper: (a: GuestArguments) => dispatch(a, DispatchMode.Super),
    _objc_msgSend_stret: (a: GuestArguments) => dispatch(a, DispatchMode.Normal, true),
    _objc_msgSendSuper2_stret: (a: GuestArguments) => dispatch(a, DispatchMode.Super2, true),
    _sel_registerName: (a: GuestArguments) => registry.selector(memory.cString(a(0))),
    _sel_getUid: (a: GuestArguments) => registry.selector(memory.cString(a(0))),
    _sel_getName: (a: GuestArguments) => a(0),
    _sel_isEqual: (a: GuestArguments) => Number(a(0) === a(1)),
    _objc_getClass: (a: GuestArguments) => registry.names.get(memory.cString(a(0))) ?? 0,
    _objc_lookUpClass: (a: GuestArguments) => registry.names.get(memory.cString(a(0))) ?? 0,
    _object_getClass: (a: GuestArguments) => (a(0) ? memory.read(a(0)) : 0),
    _class_createInstance: (a: GuestArguments) => (a(0) ? root.allocateObject(a(0), a(1)) : 0),
    _object_dispose: (a: GuestArguments) => {
      if (a(0)) return root.dispose(a(0));
    },
  };
}
/** The class_*, method_*, protocol_* and Security entry points. */
function introspectionFunctions(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  invocation: InvocationRuntime,
): GuestFunctions {
  const { memory, registry, root } = core;
  return {
    ...reflectionImports({ read: memory.read, cString: invocation.permanentString }),
    ...runtimeMethodImports({
      read: memory.read,
      write: memory.write,
      allocate: memory.zero,
      cString: memory.cString,
      permanentString: invocation.permanentString,
      selector: registry.selector,
      methods: (pointer) => {
        const info = registry.classes.get(pointer);
        return info?.supported ? info.methods : undefined;
      },
      classList: () =>
        [...registry.classes.values()]
          .filter((info) => !info.isMeta && info.supported)
          .map((info) => info.pointer),
      address: (value, name) => root.implementationAddress(value, name),
      typeEncoding: (value) => registry.typeEncoding(value),
    }),
    ...invocation.protocols.funcs,
    ...protocolMethodImports({
      read: memory.read,
      write: memory.write,
      cString: memory.cString,
      selector: registry.selector,
    }),
    ...frameworks.security,
  };
}
/** Reference counting, autorelease pools and the NSString class and selector bridges. */
function ownershipFunctions({ memory, registry, ownership, strings }: ObjcCore): GuestFunctions {
  const { text, string } = strings;
  return {
    _class_getSuperclass: (a: GuestArguments) =>
      a(0) ? memory.read(a(0) + ClassField.Superclass) : 0,
    _objc_retain: (a: GuestArguments) => ownership.retain(a(0)),
    _objc_release: (a: GuestArguments) => ownership.release(a(0)),
    _objc_autorelease: (a: GuestArguments) => ownership.autorelease(a(0)),
    _objc_retainAutoreleasedReturnValue: (a: GuestArguments) => ownership.retain(a(0)),
    _objc_autoreleaseReturnValue: (a: GuestArguments) => ownership.autorelease(a(0)),
    _objc_autoreleasePoolPush: () => ownership.poolPush(),
    _objc_autoreleasePoolPop: (a: GuestArguments) => ownership.poolPop(a(0)),
    _NSClassFromString: (a: GuestArguments) => {
      const cls = a(0) && registry.names.get(text(a(0)));
      return cls && registry.classes.get(cls)?.supported ? cls : 0;
    },
    _NSStringFromClass: (a: GuestArguments) => (a(0) ? string(registry.record(a(0)).name) : 0),
    _NSSelectorFromString: (a: GuestArguments) => (a(0) ? registry.selector(text(a(0))) : 0),
    _NSStringFromSelector: (a: GuestArguments) => (a(0) ? string(memory.cString(a(0))) : 0),
  };
}
export interface FunctionParts {
  readonly core: ObjcCore;
  readonly frameworks: FoundationFrameworks;
  readonly invocation: InvocationRuntime;
  readonly cg: Geometry;
  readonly exceptions: ExceptionThrowing;
  readonly applicationMain: (args: GuestArguments) => Promise<never>;
}
/** Every C function the runtime exports to the guest, later entries overriding earlier ones. */
export function runtimeFunctions(parts: FunctionParts): GuestFunctions {
  const { core, frameworks, cg } = parts;
  const { memory, registry, ownership, messenger, data, guest } = core;
  return {
    ...cg.funcs,
    ...frameworks.cf.funcs,
    ...cfNetwork({
      cpu: guest.cpu,
      heap: guest.heap,
      read: memory.read,
      write: memory.write,
      hostClass: registry.hostClass,
      method: registry.method,
      names: registry.names,
      alloc: ownership.alloc,
      destroy: ownership.destroy,
      text: core.strings.text,
      callGuest: guest.callGuest,
      array: frameworks.input.array,
      dataFrom: data.createData,
      release: ownership.releaseFromHost,
    }),
    ...structCopyImports({ readBytes: memory.bytes, writeBytes: memory.writeBytes }),
    ...propertyAccessors({
      read: memory.read,
      write: memory.write,
      retain: ownership.retain,
      release: ownership.releaseFromHost,
      autorelease: ownership.autorelease,
      send: async (pointer, selector, args) =>
        pointerResult(await messenger.send(pointer, selector, args)),
    }),
    ...objectFunctions(core),
    ...parts.exceptions.functions,
    ...foundationFunctions(core, frameworks),
    ...messagingFunctions(core, parts.applicationMain),
    ...introspectionFunctions(core, frameworks, parts.invocation),
    ...ownershipFunctions(core),
  };
}
