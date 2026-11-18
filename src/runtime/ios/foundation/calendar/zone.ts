export const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const OFFSET_DIGITS = 2;
export interface TimeZone {
  name: string;
  offset?: number;
}
/** Part of NSTimeZone's abbreviationDictionary; Foundation also resolves names through it. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  GMT: "GMT",
  UTC: "UTC",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  AKST: "America/Juneau",
  AKDT: "America/Juneau",
  HST: "Pacific/Honolulu",
  BST: "Europe/London",
  WET: "Europe/Lisbon",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EET: "Europe/Istanbul",
  MSK: "Europe/Moscow",
  IST: "Asia/Calcutta",
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  HKT: "Asia/Hong_Kong",
  SGT: "Asia/Singapore",
};
function ianaZone(name: string): TimeZone | undefined {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions()
      .timeZone;
    return { name: resolved === "UTC" ? "GMT" : name };
  } catch {
    return undefined;
  }
}
/** The zone for an abbreviation such as "PST", as +[NSTimeZone timeZoneWithAbbreviation:]. */
export function abbreviatedZone(abbreviation: string): TimeZone | undefined {
  const name = ABBREVIATIONS[abbreviation.toUpperCase()];
  return name ? ianaZone(name) : undefined;
}
export function namedZone(name: string): TimeZone | undefined {
  return ianaZone(name) ?? abbreviatedZone(name);
}
/** Foundation names a fixed-offset zone "GMT", "GMT+0530" or "GMT-0800". */
export function fixedZone(seconds: number): TimeZone {
  if (!seconds) return { name: "GMT", offset: 0 };
  const minutes = Math.round(Math.abs(seconds) / SECONDS_PER_MINUTE),
    hours = Math.floor(minutes / SECONDS_PER_MINUTE),
    rest = minutes % SECONDS_PER_MINUTE;
  const digits = (value: number): string => String(value).padStart(OFFSET_DIGITS, "0");
  return { name: `GMT${seconds < 0 ? "-" : "+"}${digits(hours)}${digits(rest)}`, offset: seconds };
}
export function zoneAbbreviation(zone: TimeZone, seconds: number): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: zone.name, timeZoneName: "short" })
      .formatToParts(new Date(seconds * MILLISECONDS_PER_SECOND))
      .find((part) => part.type === "timeZoneName")?.value ?? zone.name
  );
}
export function systemZone(): TimeZone {
  return { name: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function offsetForZone(zone: TimeZone, seconds: number): number {
  if (zone.offset !== undefined) return zone.offset;
  const text = new Intl.DateTimeFormat("en-US", { timeZone: zone.name, timeZoneName: "longOffset" })
    .formatToParts(new Date(seconds * MILLISECONDS_PER_SECOND))
    .find((part) => part.type === "timeZoneName")?.value;
  if (text === "GMT" || text === "UTC") return 0;
  const match = /^GMT(?<sign>[+-])(?<hour>\d+):(?<minute>\d+)(?::(?<second>\d+))?$/.exec(
    text ?? "",
  )?.groups;
  if (!match) throw new Error("Unable to resolve named time-zone offset.");
  return (
    (match.sign === "-" ? -1 : 1) *
    (Number(match.hour) * SECONDS_PER_HOUR +
      Number(match.minute) * SECONDS_PER_MINUTE +
      Number(match.second ?? 0))
  );
}
