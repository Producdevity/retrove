import type { FoundationHost } from "../../objc/host";
import {
  MILLISECONDS_PER_SECOND,
  fixedZone,
  namedZone,
  offsetForZone,
  systemZone,
  zoneAbbreviation,
} from "./zone";
import type { TimeZone } from "./zone";
const ZONE_CLASS = "NSTimeZone";
export interface TimeZoneHost extends FoundationHost {
  dateSeconds(pointer: number): number;
}
export function installTimeZones(host: TimeZoneHost): {
  get(pointer: number): TimeZone;
  create(zone: TimeZone): number;
} {
  const cls = host.hostClass(ZONE_CLASS, "NSObject"),
    zones = new Map<number, TimeZone>();
  const create = (zone: TimeZone): number => {
    const pointer = host.alloc(cls);
    zones.set(pointer, zone);
    return host.autorelease(pointer);
  };
  const get = (pointer: number): TimeZone => {
    const zone = zones.get(pointer);
    if (!zone) throw new Error("Uninitialized NSTimeZone receiver.");
    return zone;
  };
  for (const selector of ["systemTimeZone", "defaultTimeZone", "localTimeZone"])
    host.method(ZONE_CLASS, true, selector, () => create(systemZone()));
  host.method(ZONE_CLASS, true, "timeZoneWithName:", (_self, args) => {
    const zone = args(0) ? namedZone(host.text(args(0))) : undefined;
    return zone ? create(zone) : 0;
  });
  host.method(ZONE_CLASS, true, "timeZoneForSecondsFromGMT:", (_self, args) =>
    create(fixedZone(args(0) | 0)),
  );
  host.method(ZONE_CLASS, false, "name", (self) => host.string(get(self).name));
  host.method(ZONE_CLASS, false, "abbreviation", (self) => {
    const zone = get(self);
    return host.string(
      zone.offset === undefined
        ? zoneAbbreviation(zone, Date.now() / MILLISECONDS_PER_SECOND)
        : zone.name,
    );
  });
  host.method(ZONE_CLASS, false, "secondsFromGMT", (self) =>
    offsetForZone(get(self), Date.now() / MILLISECONDS_PER_SECOND),
  );
  host.method(ZONE_CLASS, false, "secondsFromGMTForDate:", (self, args) =>
    offsetForZone(get(self), host.dateSeconds(args(0))),
  );
  for (const selector of ["copy", "copyWithZone:"])
    host.method(ZONE_CLASS, false, selector, (self) => host.retain(self));
  host.method(ZONE_CLASS, false, "dealloc", (self) => {
    zones.delete(self);
    host.destroy(self);
  });
  return { get, create };
}
