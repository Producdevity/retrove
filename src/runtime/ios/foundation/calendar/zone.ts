export const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const OFFSET_DIGITS = 2;
export interface TimeZone {
  name: string;
  offset?: number;
}
export function namedZone(name: string): TimeZone | undefined {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions()
      .timeZone;
    return { name: resolved === "UTC" ? "GMT" : name };
  } catch {
    return undefined;
  }
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
