import { composeGregorian } from "./composition";
import { installDateFormatter } from "./date-formatter";
import { REFERENCE_DATE_UNIX_SECONDS } from "../dates";
import type { FoundationHost } from "../../objc/host";
import {
  CalendarUnit,
  COMPONENT_UNDEFINED,
  componentField,
  gregorianComponents,
} from "./gregorian";
import type { DateComponent } from "./gregorian";
import { installTimeZones } from "./time-zones";
import { systemZone } from "./zone";
import type { TimeZone } from "./zone";
interface CalendarHost extends FoundationHost {
  referenceTime(pointer: number): number;
  createDate(seconds: number): number;
}
const CALENDAR_CLASS = "NSCalendar",
  COMPONENTS_CLASS = "NSDateComponents",
  GREGORIAN_IDENTIFIER = "gregorian";
export function installCalendars(host: CalendarHost): void {
  const dateSeconds = (pointer: number): number =>
    host.referenceTime(pointer) + REFERENCE_DATE_UNIX_SECONDS;
  const zones = installTimeZones({ ...host, dateSeconds });
  installDateFormatter({
    ...host,
    unixSeconds: dateSeconds,
    createDate: (seconds) => host.createDate(seconds),
    zone: (pointer) => zones.get(pointer),
  });
  const calendarClass = host.hostClass(CALENDAR_CLASS, "NSObject"),
    componentClass = host.hostClass(COMPONENTS_CLASS, "NSObject");
  const calendars = new Map<number, TimeZone>(),
    components = new Map<number, Map<DateComponent, number>>();
  const calendar = (pointer: number): TimeZone => {
    const zone = calendars.get(pointer);
    if (!zone) throw new Error("Uninitialized NSCalendar receiver.");
    return zone;
  };
  const initialize = (self: number, identifier: number): number => {
    if (!identifier || host.text(identifier) !== GREGORIAN_IDENTIFIER)
      throw new Error("Only Gregorian NSCalendar is implemented.");
    calendars.set(self, systemZone());
    return self;
  };
  host.method(CALENDAR_CLASS, false, "initWithCalendarIdentifier:", (self, args) =>
    initialize(self, args(0)),
  );
  host.method(CALENDAR_CLASS, true, "currentCalendar", () => {
    const pointer = host.alloc(calendarClass);
    calendars.set(pointer, systemZone());
    return host.autorelease(pointer);
  });
  host.method(CALENDAR_CLASS, false, "calendarIdentifier", () => host.string(GREGORIAN_IDENTIFIER));
  host.method(CALENDAR_CLASS, false, "setTimeZone:", (self, args) => {
    calendars.set(self, zones.get(args(0)));
  });
  host.method(CALENDAR_CLASS, false, "timeZone", (self) => zones.create(calendar(self)));
  host.method(CALENDAR_CLASS, false, "components:fromDate:", (self, args) => {
    const value = gregorianComponents(dateSeconds(args(1)), calendar(self), args(0));
    const pointer = host.alloc(componentClass);
    components.set(pointer, value);
    return host.autorelease(pointer);
  });
  host.method(CALENDAR_CLASS, false, "dateFromComponents:", (self, args) => {
    const value = components.get(args(0));
    if (!value) throw new Error("NSCalendar requires initialized NSDateComponents.");
    return host.createDate(composeGregorian(value, calendar(self)));
  });
  host.method(CALENDAR_CLASS, false, "dealloc", (self) => {
    calendars.delete(self);
    host.destroy(self);
  });
  for (const field of Object.keys(CalendarUnit)) {
    const name = componentField(field);
    host.method(
      COMPONENTS_CLASS,
      false,
      field,
      (self) => components.get(self)?.get(name) ?? COMPONENT_UNDEFINED,
    );
    host.method(
      COMPONENTS_CLASS,
      false,
      `set${field[0]?.toUpperCase()}${field.slice(1)}:`,
      (self, args) => {
        let value = components.get(self);
        if (!value) {
          value = new Map();
          components.set(self, value);
        }
        value.set(name, args(0) | 0);
      },
    );
  }
  host.method(COMPONENTS_CLASS, false, "dealloc", (self) => {
    components.delete(self);
    host.destroy(self);
  });
}
