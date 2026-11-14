export const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
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
