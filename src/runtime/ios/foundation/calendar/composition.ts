import type { DateComponent } from "./gregorian";
import { MILLISECONDS_PER_SECOND, offsetForZone } from "./zone";
import type { TimeZone } from "./zone";
const MONTH_INDEX = 1;
const HISTORICAL_CUTOVER_YEAR = 1582;
const OFFSET_SAMPLE_SECONDS = 129600;
export function composeGregorian(
  components: ReadonlyMap<DateComponent, number>,
  zone: TimeZone,
): number {
  const year = components.get("year") ?? 1;
  if (year < HISTORICAL_CUTOVER_YEAR || components.get("era") === 0)
    throw new Error("Historical NSCalendar date composition is not implemented.");
  const date = new Date(0);
  date.setUTCFullYear(
    year,
    (components.get("month") ?? 1) - MONTH_INDEX,
    components.get("day") ?? 1,
  );
  date.setUTCHours(
    components.get("hour") ?? 0,
    components.get("minute") ?? 0,
    components.get("second") ?? 0,
    0,
  );
  const local = date.getTime() / MILLISECONDS_PER_SECOND;
  if (!Number.isFinite(local))
    throw new RangeError("NSCalendar components outside supported range.");
  const offsets = new Set(
    [-OFFSET_SAMPLE_SECONDS, 0, OFFSET_SAMPLE_SECONDS].map((delta) =>
      offsetForZone(zone, local + delta),
    ),
  );
  const candidates = [...offsets].map((offset) => {
    const instant = local - offset;
    return { instant, wall: instant + offsetForZone(zone, instant) };
  });
  const exact = candidates
    .filter((candidate) => candidate.wall === local)
    .sort((left, right) => left.instant - right.instant)[0];
  if (exact) return exact.instant;
  const afterGap = candidates
    .filter((candidate) => candidate.wall > local)
    .sort((left, right) => left.wall - right.wall)[0];
  if (afterGap) return afterGap.instant;
  throw new Error("Unable to compose NSCalendar date in this time zone.");
}
