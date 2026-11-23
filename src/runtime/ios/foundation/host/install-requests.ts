import { readString } from "../../../memory/guest-memory";
import { installRequestHeaders } from "../http-headers";
import { installOperations } from "../operations/bindings";
import { installRequestOptions } from "../url-request";
import type { FoundationContext } from "./types";
import { Late } from "./types";

const REQUEST = "NSURLRequest";
const MUTABLE_REQUEST = "NSMutableURLRequest";
const BODY_PROPERTIES = [
  ["HTTPBody", "setHTTPBody:"],
  ["HTTPMethod", "setHTTPMethod:"],
] as const;

export function installOperationService(ctx: FoundationContext) {
  const { cpu, method, threads, hostGate } = ctx;
  const tasks = new Map<number, () => Promise<void>>();
  let gate: number | undefined;
  return installOperations({
    hostClass: ctx.hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    release: ctx.release,
    autorelease: ctx.autorelease,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    send: ctx.send,
    isKind: ctx.isKind,
    array: ctx.array,
    items: ctx.items,
    returnType: ctx.returnType,
    selector: (pointer) => readString(cpu, pointer),
    waitMethod: (cls, name, handler) => method(cls, false, name, handler),
    worker: (operation, task, exited) => {
      if (!hostGate || !threads) throw new Error("Operation workers are unavailable");
      gate ??= hostGate(
        { name: "NSOperationQueue worker", library: "Foundation" },
        async (args) => {
          const pending = tasks.get(args(0));
          if (!pending) throw new Error("Unknown operation worker");
          await pending();
          return 0;
        },
      );
      tasks.set(operation, task);
      const spawned = threads.spawnDetached(gate, [operation], async () => {
        tasks.delete(operation);
        await exited();
      });
      if (!spawned) {
        tasks.delete(operation);
        throw new Error("Operation worker allocation failed");
      }
    },
  });
}

export function installRequestObjects(ctx: FoundationContext): void {
  const { method, hostClass, state, retain, release, destroy, h } = ctx;
  hostClass(REQUEST, "NSObject");
  hostClass(MUTABLE_REQUEST, REQUEST);
  const setURL = async (self: number, pointer: number): Promise<void> => {
    const old = state.requests.get(self);
    state.requests.set(self, retain(pointer));
    if (old) await release(old);
  };
  const releaseOptions = installRequestOptions({
    method,
    alloc: ctx.alloc,
    autorelease: ctx.autorelease,
    setURL,
  });
  method(MUTABLE_REQUEST, false, "setURL:", (self, args) => setURL(self, args(0)));
  method(REQUEST, false, "URL", (self) => state.requests.get(self) ?? 0);
  const releaseHeaders = new Late<(pointer: number) => void>("request headers");
  method(REQUEST, false, "dealloc", async (self) => {
    const properties = state.requestProperties.get(self);
    const url = state.requests.get(self);
    releaseHeaders.get()(self);
    releaseOptions(self);
    state.requests.delete(self);
    state.requestProperties.delete(self);
    for (const pointer of Object.values(properties ?? {})) await release(pointer);
    if (url) await release(url);
    destroy(self);
  });
  releaseHeaders.set(
    installRequestHeaders({
      method,
      text: ctx.text,
      string: ctx.string,
      property: h.property,
      isString: (pointer) => ctx.isKind(pointer, "NSString"),
      isDictionary: (pointer) => ctx.isKind(pointer, "NSDictionary"),
      entries: h.entries,
    }),
  );
  for (const [getter, setter] of BODY_PROPERTIES) {
    method(
      REQUEST,
      false,
      getter,
      (self) =>
        state.requestProperties.get(self)?.[getter] ??
        (getter === "HTTPMethod" ? ctx.string("GET") : 0),
    );
    method(MUTABLE_REQUEST, false, setter, async (self, args) => {
      const properties = state.requestProperties.get(self) ?? {};
      state.requestProperties.set(self, properties);
      const old = properties[getter];
      properties[getter] = retain(args(0));
      if (old) await release(old);
    });
  }
}
