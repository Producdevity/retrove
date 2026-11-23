import { read32, readString, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const Tm = {
  Seconds: 0,
  Minutes: 1,
  Hours: 2,
  Day: 3,
  Month: 4,
  Year: 5,
  Weekday: 6,
  YearDay: 7,
  Offset: 9,
  Zone: 10,
} as const;
const TM_YEAR_BASE = 1900;
const DEFAULT_WIDTH = 2;
const DAY_OF_YEAR_WIDTH = 3;
const ABBREVIATION_LENGTH = 3;
const CENTURY = 100;
const HALF_DAY = 12;
const DAYS_PER_WEEK = 7;
const SUNDAY_AS_ISO = 7;
const ISO_THURSDAY_OFFSET = 4;
const MONDAY_BASED_SHIFT = 6;
const MS_PER_DAY = 86400000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const DIRECTIVE = /%[EO]?(.)/g;

const pad = (value: number, width = DEFAULT_WIDTH): string => String(value).padStart(width, "0");
const space = (value: number): string => String(value).padStart(DEFAULT_WIDTH, " ");

function isoWeek(year: number, month: number, day: number, weekday: number) {
  const thursday = new Date(Date.UTC(year, month, day));
  thursday.setUTCDate(day + ISO_THURSDAY_OFFSET - (weekday || SUNDAY_AS_ISO));
  const isoYear = thursday.getUTCFullYear();
  const week = Math.ceil(
    ((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / MS_PER_DAY + 1) / DAYS_PER_WEEK,
  );
  return { isoYear, week };
}

interface BrokenDownTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly yearDay: number;
  readonly hour: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly offset: number;
}
type Directives = Record<string, string | number>;

function dateDirectives(t: BrokenDownTime): Directives {
  const { year, month, day, weekday, yearDay } = t;
  const { isoYear, week } = isoWeek(year, month, day, weekday);
  const dayName = WEEKDAYS[weekday] || "",
    monthName = MONTHS[month] || "";
  const shortDate = pad(month + 1) + "/" + pad(day) + "/" + pad(year % CENTURY);
  return {
    a: dayName.slice(0, ABBREVIATION_LENGTH),
    A: dayName,
    b: monthName.slice(0, ABBREVIATION_LENGTH),
    B: monthName,
    h: monthName.slice(0, ABBREVIATION_LENGTH),
    C: pad(Math.floor(year / CENTURY)),
    d: pad(day),
    e: space(day),
    m: pad(month + 1),
    y: pad(year % CENTURY),
    Y: year,
    F: year + "-" + pad(month + 1) + "-" + pad(day),
    j: pad(yearDay + 1, DAY_OF_YEAR_WIDTH),
    u: weekday || SUNDAY_AS_ISO,
    w: weekday,
    U: pad(Math.floor((yearDay + DAYS_PER_WEEK - weekday) / DAYS_PER_WEEK)),
    W: pad(
      Math.floor(
        (yearDay + DAYS_PER_WEEK - ((weekday + MONDAY_BASED_SHIFT) % DAYS_PER_WEEK)) /
          DAYS_PER_WEEK,
      ),
    ),
    V: pad(week),
    G: isoYear,
    g: pad(isoYear % CENTURY),
    x: shortDate,
    D: shortDate,
  };
}

function clockDirectives(t: BrokenDownTime): Directives {
  const { hour, minutes, seconds, offset } = t;
  const time = pad(hour) + ":" + pad(minutes) + ":" + pad(seconds);
  const meridiem = hour < HALF_DAY ? "AM" : "PM";
  const clockHour = hour % HALF_DAY || HALF_DAY;
  return {
    I: pad(clockHour),
    H: pad(hour),
    k: space(hour),
    l: space(clockHour),
    M: pad(minutes),
    S: pad(seconds),
    T: time,
    X: time,
    R: pad(hour) + ":" + pad(minutes),
    p: meridiem,
    r: pad(clockHour) + ":" + pad(minutes) + ":" + pad(seconds) + " " + meridiem,
    s: Math.floor(
      Date.UTC(t.year, t.month, t.day, hour, minutes, seconds) / MS_PER_SECOND - offset,
    ),
    z:
      (offset < 0 ? "-" : "+") +
      pad(Math.floor(Math.abs(offset) / SECONDS_PER_HOUR)) +
      pad(Math.floor(Math.abs(offset) / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE),
  };
}

function composedDirectives(t: BrokenDownTime, date: Directives, clock: Directives): Directives {
  return {
    c: `${String(date["a"])} ${String(date["b"])} ${space(t.day)} ${String(clock["T"])} ${t.year}`,
  };
}

export function formatTime(cpu: GuestMemory, tm: number, template: string): string {
  const field = (index: number): number => read32(cpu, tm + WORD_BYTES * index) | 0;
  const time: BrokenDownTime = {
    year: TM_YEAR_BASE + field(Tm.Year),
    month: field(Tm.Month),
    day: field(Tm.Day),
    weekday: field(Tm.Weekday),
    yearDay: field(Tm.YearDay),
    hour: field(Tm.Hours),
    minutes: field(Tm.Minutes),
    seconds: field(Tm.Seconds),
    offset: field(Tm.Offset),
  };
  const date = dateDirectives(time),
    clock = clockDirectives(time);
  const names: Directives = {
    ...date,
    ...clock,
    ...composedDirectives(time, date, clock),
    Z: field(Tm.Zone) ? readString(cpu, field(Tm.Zone) >>> 0) : "",
    t: "\t",
    n: "\n",
    "%": "%",
  };
  return template.replace(DIRECTIVE, (token, directive: string) => {
    const value = names[directive];
    return value === undefined ? token : String(value);
  });
}
