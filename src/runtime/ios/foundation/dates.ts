import { doubleBits, doubleFromBits } from "../abi/scalars";
import { Argument, type FoundationHost, type GuestArguments } from "../objc/host";
const DATE_CLASS = "NSDate";
const MILLISECONDS_PER_SECOND = 1000;
export const REFERENCE_DATE_UNIX_SECONDS = 978307200;
const DistantDate = { distantPast: -62135769600, distantFuture: 64092211200 } as const;
interface DateHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "alloc" | "destroy" | "retain" | "autorelease"
> {
  isDate(pointer: number): boolean;
}
export function installDates(host: DateHost) {
  const cls = host.hostClass(DATE_CLASS, "NSObject"),
    times = new Map<number, number>();
  const now = () => Date.now() / MILLISECONDS_PER_SECOND;
  const get = (pointer: number): number => {
    const value = times.get(pointer);
    if (value === undefined) throw new Error("Uninitialized NSDate receiver.");
    return value;
  };
  const create = (value: number, type = cls): number => {
    const pointer = host.alloc(type);
    times.set(pointer, value);
    return host.autorelease(pointer);
  };
  const initialize = (self: number, value: number): number => {
    times.set(self, value);
    return self;
  };
  host.method(DATE_CLASS, true, "date", (type) => create(now(), type));
  host.method(DATE_CLASS, false, "init", (self) => initialize(self, now()));
  const bases = [
    ["1970", () => 0],
    ["ReferenceDate", () => REFERENCE_DATE_UNIX_SECONDS],
    ["Now", now],
  ] as const;
  for (const [suffix, base] of bases) {
    host.method(DATE_CLASS, true, `dateWithTimeIntervalSince${suffix}:`, (type, args) =>
      create(base() + doubleFromBits(args(0), args(1)), type),
    );
    host.method(DATE_CLASS, false, `initWithTimeIntervalSince${suffix}:`, (self, args) =>
      initialize(self, base() + doubleFromBits(args(0), args(1))),
    );
    host.method(DATE_CLASS, false, `timeIntervalSince${suffix}`, (self) =>
      doubleBits(get(self) - base()),
    );
  }
  host.method(DATE_CLASS, true, "timeIntervalSinceReferenceDate", () =>
    doubleBits(now() - REFERENCE_DATE_UNIX_SECONDS),
  );
  const relative = (args: GuestArguments) =>
    get(args(Argument.Third)) + doubleFromBits(args(0), args(1));
  host.method(DATE_CLASS, true, "dateWithTimeInterval:sinceDate:", (type, args) =>
    create(relative(args), type),
  );
  host.method(DATE_CLASS, false, "initWithTimeInterval:sinceDate:", (self, args) =>
    initialize(self, relative(args)),
  );
  host.method(DATE_CLASS, false, "timeIntervalSinceDate:", (self, args) =>
    doubleBits(get(self) - get(args(0))),
  );
  for (const name of ["dateByAddingTimeInterval:", "addTimeInterval:"])
    host.method(DATE_CLASS, false, name, (self, args) =>
      create(get(self) + doubleFromBits(args(0), args(1))),
    );
  installComparisons(host, get);
  for (const [selector, value] of Object.entries(DistantDate)) {
    let singleton = 0;
    host.method(DATE_CLASS, true, selector, () => (singleton ||= host.retain(create(value))));
  }
  host.method(DATE_CLASS, false, "copy", host.retain);
  host.method(DATE_CLASS, false, "dealloc", (self) => {
    times.delete(self);
    host.destroy(self);
  });
  return {
    create,
    referenceTime: (pointer: number) => get(pointer) - REFERENCE_DATE_UNIX_SECONDS,
    setReferenceTime: (pointer: number, value: number) => {
      times.set(pointer, value + REFERENCE_DATE_UNIX_SECONDS);
    },
  };
}

function installComparisons(host: DateHost, get: (pointer: number) => number): void {
  host.method(DATE_CLASS, false, "compare:", (self, args) => {
    const left = get(self),
      right = get(args(0));
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const name of ["isEqual:", "isEqualToDate:"])
    host.method(DATE_CLASS, false, name, (self, args) =>
      Number(host.isDate(args(0)) && get(self) === get(args(0))),
    );
  host.method(DATE_CLASS, false, "earlierDate:", (self, args) =>
    get(self) <= get(args(0)) ? self : args(0),
  );
  host.method(DATE_CLASS, false, "laterDate:", (self, args) =>
    get(self) >= get(args(0)) ? self : args(0),
  );
}
