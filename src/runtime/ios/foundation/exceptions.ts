import { Argument, type FoundationHost, type HostResult } from "../objc/host";

export interface ExceptionHost extends FoundationHost {
  /** Formats a printf-style NSString format with the guest variadic arguments. */
  formatted(format: number, argument: (index: number) => number): string;
  /** objc_exception_throw: unwinds to a guest @catch or reports an uncaught exception. */
  throwException(exception: number): HostResult | Promise<HostResult>;
  emptyArray(): number;
}
interface ExceptionState {
  name: number;
  reason: number;
  userInfo: number;
}
export const ExceptionName = {
  Generic: "NSGenericException",
  Range: "NSRangeException",
  InvalidArgument: "NSInvalidArgumentException",
  InternalInconsistency: "NSInternalInconsistencyException",
  Malloc: "NSMallocException",
  ObjectInaccessible: "NSObjectInaccessibleException",
  ObjectNotAvailable: "NSObjectNotAvailableException",
  DestinationInvalid: "NSDestinationInvalidException",
  Port: "NSPortTimeoutException",
  InvalidSendPort: "NSInvalidSendPortException",
  InvalidReceivePort: "NSInvalidReceivePortException",
  PortSend: "NSPortSendException",
  PortReceive: "NSPortReceiveException",
  CharacterConversion: "NSCharacterConversionException",
  FileHandleOperation: "NSFileHandleOperationException",
  UndefinedKey: "NSUndefinedKeyException",
} as const;
/** Exported NSString symbols for every exception name. */
export const ExceptionSymbols: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(ExceptionName).map((name) => [`_${name}`, name]),
);
const CLASS = "NSException";
const HANDLER = "NSAssertionHandler";
/** Argument positions of the file, line and description format in each failure handler. */
const Assertion = {
  Method: { file: 2, line: 3, format: 4 },
  Function: { file: 1, line: 2, format: 3 },
} as const;
const RAISE_VARIADIC_FIRST = 2;

/** NSException and NSAssertionHandler; raising unwinds through the guest's @try/@catch. */
export function installExceptions(host: ExceptionHost): {
  describe(pointer: number): string | undefined;
} {
  const exceptionClass = host.hostClass(CLASS, "NSObject");
  const states = new Map<number, ExceptionState>();
  const retained = (pointer: number) => (pointer ? host.retain(pointer) : 0);
  const initialize = (self: number, name: number, reason: number, userInfo: number) => {
    states.set(self, {
      name: retained(name),
      reason: retained(reason),
      userInfo: retained(userInfo),
    });
    return self;
  };
  const create = (name: string, reason: string) =>
    host.autorelease(
      initialize(host.alloc(exceptionClass), host.string(name), host.string(reason), 0),
    );
  host.method(CLASS, false, "initWithName:reason:userInfo:", (self, args) =>
    initialize(self, args(Argument.First), args(Argument.Second), args(Argument.Third)),
  );
  host.method(CLASS, true, "exceptionWithName:reason:userInfo:", (_self, args) =>
    host.autorelease(
      initialize(
        host.alloc(exceptionClass),
        args(Argument.First),
        args(Argument.Second),
        args(Argument.Third),
      ),
    ),
  );
  host.method(CLASS, true, "raise:format:", (_self, args) =>
    host.throwException(
      create(
        args(Argument.First) ? host.text(args(Argument.First)) : ExceptionName.Generic,
        args(Argument.Second)
          ? host.formatted(args(Argument.Second), (index) => args(index + RAISE_VARIADIC_FIRST))
          : "",
      ),
    ),
  );
  host.method(CLASS, false, "raise", (self) => host.throwException(self));
  host.method(CLASS, false, "name", (self) => states.get(self)?.name ?? 0);
  host.method(CLASS, false, "reason", (self) => states.get(self)?.reason ?? 0);
  host.method(CLASS, false, "userInfo", (self) => states.get(self)?.userInfo ?? 0);
  for (const name of ["callStackSymbols", "callStackReturnAddresses"])
    host.method(CLASS, false, name, () => host.emptyArray());
  const describe = (pointer: number): string | undefined => {
    const state = states.get(pointer);
    if (!state) return undefined;
    const name = state.name ? host.text(state.name) : CLASS;
    return state.reason ? `${name}: ${host.text(state.reason)}` : name;
  };
  host.method(CLASS, false, "description", (self) => host.string(describe(self) ?? CLASS));
  host.method(CLASS, false, "dealloc", async (self) => {
    const state = states.get(self);
    states.delete(self);
    for (const pointer of [state?.name, state?.reason, state?.userInfo])
      if (pointer) await host.release(pointer);
    host.destroy(self);
  });

  installAssertionHandler(host, create);
  return { describe };
}

function installAssertionHandler(
  host: ExceptionHost,
  create: (name: string, reason: string) => number,
): void {
  const handlerClass = host.hostClass(HANDLER, "NSObject");
  let current = 0;
  host.method(HANDLER, true, "currentHandler", () => (current ||= host.alloc(handlerClass)));
  for (const [selector, at] of [
    ["handleFailureInMethod:object:file:lineNumber:description:", Assertion.Method],
    ["handleFailureInFunction:file:lineNumber:description:", Assertion.Function],
  ] as const)
    host.method(HANDLER, false, selector, (_self, args) => {
      const description = args(at.format)
        ? host.formatted(args(at.format), (index) => args(at.format + 1 + index))
        : "Assertion failed";
      const file = args(at.file) ? host.text(args(at.file)) : "?";
      return host.throwException(
        create(ExceptionName.InternalInconsistency, `${description} (${file}:${args(at.line)})`),
      );
    });
}
