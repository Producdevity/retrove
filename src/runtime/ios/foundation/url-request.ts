import { doubleBits, doubleFromBits } from "../abi/scalars";
import { Argument } from "../objc/host";
import type { FoundationHost, GuestArguments } from "../objc/host";
export const RequestClass = { Base: "NSURLRequest", Mutable: "NSMutableURLRequest" } as const;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60;
interface RequestOptions {
  cachePolicy: number;
  timeoutInterval: number;
  HTTPShouldHandleCookies: boolean;
  HTTPShouldUsePipelining: boolean;
}
const defaults: Readonly<RequestOptions> = {
  cachePolicy: 0,
  timeoutInterval: DEFAULT_REQUEST_TIMEOUT_SECONDS,
  HTTPShouldHandleCookies: true,
  HTTPShouldUsePipelining: false,
};
interface RequestHost extends Pick<FoundationHost, "method" | "alloc" | "autorelease"> {
  setURL(pointer: number, url: number): Promise<void>;
}
function initialOptions(args: GuestArguments, extended: boolean): RequestOptions {
  return extended
    ? {
        ...defaults,
        cachePolicy: args(1),
        timeoutInterval: doubleFromBits(args(Argument.Third), args(Argument.Third + 1)),
      }
    : { ...defaults };
}
export function installRequestOptions(host: RequestHost): (pointer: number) => void {
  const options = new Map<number, RequestOptions>();
  const read = (pointer: number) => options.get(pointer) ?? defaults;
  const mutable = (pointer: number) => {
    let value = options.get(pointer);
    if (!value) {
      value = { ...defaults };
      options.set(pointer, value);
    }
    return value;
  };
  for (const factory of [false, true])
    for (const extended of [false, true]) {
      const selector =
        (factory ? "request" : "init") +
        "WithURL:" +
        (extended ? "cachePolicy:timeoutInterval:" : "");
      host.method(RequestClass.Base, factory, selector, async (receiver, args) => {
        const url = args(0),
          values = initialOptions(args, extended),
          self = factory ? host.alloc(receiver) : receiver;
        options.set(self, values);
        await host.setURL(self, url);
        return factory ? host.autorelease(self) : self;
      });
    }
  host.method(RequestClass.Base, false, "cachePolicy", (self) => read(self).cachePolicy);
  host.method(RequestClass.Mutable, false, "setCachePolicy:", (self, args) => {
    mutable(self).cachePolicy = args(0);
  });
  host.method(RequestClass.Base, false, "timeoutInterval", (self) =>
    doubleBits(read(self).timeoutInterval),
  );
  host.method(RequestClass.Mutable, false, "setTimeoutInterval:", (self, args) => {
    mutable(self).timeoutInterval = doubleFromBits(args(0), args(1));
  });
  for (const [getter, setter] of [
    ["HTTPShouldHandleCookies", "setHTTPShouldHandleCookies:"],
    ["HTTPShouldUsePipelining", "setHTTPShouldUsePipelining:"],
  ] as const) {
    host.method(RequestClass.Base, false, getter, (self) => Number(read(self)[getter]));
    host.method(RequestClass.Mutable, false, setter, (self, args) => {
      mutable(self)[getter] = Boolean(args(0));
    });
  }
  return (pointer) => {
    options.delete(pointer);
  };
}
