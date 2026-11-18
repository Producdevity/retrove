import { Argument, type FoundationHost } from "../../objc/host";
import { MILLISECONDS_PER_SECOND, offsetForZone, systemZone, type TimeZone } from "./zone";

export interface DateFormatterHost extends FoundationHost {
  unixSeconds(date: number): number;
  createDate(unixSeconds: number): number;
  zone(pointer: number): TimeZone;
}
const CLASS = "NSDateFormatter";
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_HALF_DAY = 12;
const Width = { Pair: 2, Short: 3, Long: 4 } as const;
const CENTURY = 100;
const DECIMAL = 10;
/** Month and weekday names come from 2001, whose 7 January is a Sunday. */
const NAME_YEAR = 2001;
const FIRST_SUNDAY = 7;
const TOKEN = /'[^']*'|y+|M+|d+|H+|h+|m+|s+|S+|a|E+|Z+|z+|./gu;
/** NSDateFormatterStyle to Intl styles; None (0) omits the part. */
const STYLES = [undefined, "short", "medium", "long", "full"] as const;
interface State {
  pattern: string;
  dateStyle: number;
  timeStyle: number;
  zone: TimeZone;
}
interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function partsAt(unix: number, zone: TimeZone): Parts {
  const shifted = new Date((unix + offsetForZone(zone, unix)) * MILLISECONDS_PER_SECOND);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}
const pad = (value: number, width: number): string => String(value).padStart(width, "0");
function name(kind: "month" | "weekday", index: number, width: "short" | "long"): string {
  const date =
    kind === "month"
      ? new Date(Date.UTC(NAME_YEAR, index - 1, 1))
      : new Date(Date.UTC(NAME_YEAR, 0, index + FIRST_SUNDAY));
  return new Intl.DateTimeFormat("en-US", { [kind]: width, timeZone: "UTC" }).format(date);
}
function offsetText(seconds: number): string {
  const minutes = Math.abs(seconds) / SECONDS_PER_MINUTE;
  return `${seconds < 0 ? "-" : "+"}${pad(Math.floor(minutes / MINUTES_PER_HOUR), Width.Pair)}${pad(minutes % MINUTES_PER_HOUR, Width.Pair)}`;
}
/** Formats with a Unicode date pattern, as NSDateFormatter's dateFormat does. */
export function formatPattern(pattern: string, unix: number, zone: TimeZone): string {
  const p = partsAt(unix, zone);
  return (pattern.match(TOKEN) ?? [])
    .map((token) => {
      const head = token[0] ?? "",
        width = token.length;
      if (head === "'") return token.length > Width.Pair ? token.slice(1, -1) : "'";
      if (head === "y")
        return width === Width.Pair ? pad(p.year % CENTURY, Width.Pair) : String(p.year);
      if (head === "M")
        return width >= Width.Long
          ? name("month", p.month, "long")
          : width === Width.Short
            ? name("month", p.month, "short")
            : pad(p.month, width);
      if (head === "d") return pad(p.day, width);
      if (head === "H") return pad(p.hour, width);
      if (head === "h") return pad(p.hour % HOURS_PER_HALF_DAY || HOURS_PER_HALF_DAY, width);
      if (head === "m") return pad(p.minute, width);
      if (head === "s") return pad(p.second, width);
      if (head === "S") return pad(Math.floor((unix % 1) * DECIMAL ** width), width);
      if (head === "a") return p.hour < HOURS_PER_HALF_DAY ? "AM" : "PM";
      if (head === "E") return name("weekday", p.weekday, width >= Width.Long ? "long" : "short");
      if (head === "Z" || head === "z")
        return head === "z" ? zone.name : offsetText(offsetForZone(zone, unix));
      return token;
    })
    .join("");
}
/** Parses numeric patterns (y, M, d, H, h, m, s, a and literals); undefined when it does not match. */
export function parsePattern(pattern: string, text: string, zone: TimeZone): number | undefined {
  const fields: string[] = [];
  const source = (pattern.match(TOKEN) ?? [])
    .map((token) => {
      const head = token[0] ?? "";
      if (head === "'")
        return token.length > Width.Pair
          ? token.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
          : "'";
      if ("yMdHhmsS".includes(head)) {
        fields.push(head);
        return "(\\d+)";
      }
      if (head === "a") {
        fields.push("a");
        return "(AM|PM)";
      }
      return token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    })
    .join("");
  const match = new RegExp(`^${source}$`, "iu").exec(text.trim());
  if (!match) return undefined;
  const value = { y: 1970, M: 1, d: 1, H: 0, h: 0, m: 0, s: 0, S: 0, pm: false };
  fields.forEach((field, index) => {
    const part = match[index + 1] ?? "";
    if (field === "a") value.pm = part.toUpperCase() === "PM";
    else if (field in value) Object.assign(value, { [field]: Number(part) });
  });
  const hour = fields.includes("h")
    ? (value.h % HOURS_PER_HALF_DAY) + (value.pm ? HOURS_PER_HALF_DAY : 0)
    : value.H;
  const local =
    Date.UTC(value.y, value.M - 1, value.d, hour, value.m, value.s) / MILLISECONDS_PER_SECOND;
  return local - offsetForZone(zone, local);
}

export function installDateFormatter(host: DateFormatterHost): void {
  host.hostClass(CLASS, "NSObject");
  const states = new Map<number, State>();
  const get = (self: number): State => {
    let state = states.get(self);
    if (!state) {
      state = { pattern: "", dateStyle: 0, timeStyle: 0, zone: systemZone() };
      states.set(self, state);
    }
    return state;
  };
  const format = (state: State, unix: number): string => {
    if (state.pattern) return formatPattern(state.pattern, unix, state.zone);
    const options: Intl.DateTimeFormatOptions = {
      timeZone: state.zone.offset === undefined ? state.zone.name : "UTC",
    };
    const date = STYLES[state.dateStyle],
      time = STYLES[state.timeStyle];
    if (date) options.dateStyle = date;
    if (time) options.timeStyle = time;
    if (!date && !time) return "";
    const shift = state.zone.offset ?? 0;
    return new Intl.DateTimeFormat(undefined, options).format(
      (unix + shift) * MILLISECONDS_PER_SECOND,
    );
  };
  host.method(CLASS, false, "init", (self) => {
    get(self);
    return self;
  });
  host.method(CLASS, false, "setDateFormat:", (self, args) => {
    get(self).pattern = args(Argument.First) ? host.text(args(Argument.First)) : "";
  });
  host.method(CLASS, false, "dateFormat", (self) => host.string(get(self).pattern));
  host.method(CLASS, false, "setDateStyle:", (self, args) => {
    get(self).dateStyle = args(Argument.First);
  });
  host.method(CLASS, false, "setTimeStyle:", (self, args) => {
    get(self).timeStyle = args(Argument.First);
  });
  host.method(CLASS, false, "setTimeZone:", (self, args) => {
    get(self).zone = args(Argument.First) ? host.zone(args(Argument.First)) : systemZone();
  });
  for (const ignored of [
    "setLocale:",
    "setFormatterBehavior:",
    "setCalendar:",
    "setLenient:",
    "setDoesRelativeDateFormatting:",
  ])
    host.method(CLASS, false, ignored, () => undefined);
  host.method(CLASS, false, "stringFromDate:", (self, args) =>
    args(Argument.First)
      ? host.string(format(get(self), host.unixSeconds(args(Argument.First))))
      : 0,
  );
  host.method(CLASS, false, "dateFromString:", (self, args) => {
    const state = get(self);
    if (!args(Argument.First) || !state.pattern) return 0;
    const unix = parsePattern(state.pattern, host.text(args(Argument.First)), state.zone);
    return unix === undefined ? 0 : host.createDate(unix);
  });
  host.method(CLASS, false, "dealloc", (self) => {
    states.delete(self);
    host.destroy(self);
  });
}
