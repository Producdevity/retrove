import { MILLISECONDS_PER_SECOND, offsetForZone } from "./zone";
import type { TimeZone } from "./zone";
export const COMPONENT_UNDEFINED = 0x7fffffff;
export const CalendarUnit = {
  era: 2,
  year: 4,
  month: 8,
  day: 16,
  hour: 32,
  minute: 64,
  second: 128,
  weekday: 512,
  weekdayOrdinal: 1024,
  quarter: 2048,
} as const;
const DAYS_PER_WEEK = 7,
  MONTHS_PER_QUARTER = 3;
const SUPPORTED_UNITS = Object.values(CalendarUnit).reduce((mask, unit) => mask | unit, 0);
export type DateComponent = keyof typeof CalendarUnit;
export function gregorianComponents(
  seconds: number,
  zone: TimeZone,
  mask: number,
): Map<DateComponent, number> {
  if (mask & ~SUPPORTED_UNITS) throw new Error("Requested NSCalendar units are not implemented.");
  const date = new Date((seconds + offsetForZone(zone, seconds)) * MILLISECONDS_PER_SECOND);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError("NSCalendar date outside supported range.");
  const year = date.getUTCFullYear();
  const values: Record<DateComponent, number> = {
    era: year > 0 ? 1 : 0,
    year: year > 0 ? year : 1 - year,
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay() + 1,
    weekdayOrdinal: Math.floor((date.getUTCDate() - 1) / DAYS_PER_WEEK) + 1,
    quarter: Math.floor(date.getUTCMonth() / MONTHS_PER_QUARTER) + 1,
  };
  const components = new Map<DateComponent, number>();
  for (const [key, unit] of Object.entries(CalendarUnit)) {
    const field = componentField(key);
    if (mask & unit) components.set(field, values[field]);
  }
  return components;
}
export function componentField(key: string): DateComponent {
  switch (key) {
    case "era":
    case "year":
    case "month":
    case "day":
    case "hour":
    case "minute":
    case "second":
    case "weekday":
    case "weekdayOrdinal":
    case "quarter":
      return key;
    default:
      throw new Error("Unknown NSCalendar date component.");
  }
}
