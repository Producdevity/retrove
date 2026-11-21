import { write32, type GuestMemory } from "../../memory/guest-memory";
import { doubleWide } from "../../ios/libc/pure-math";
import type { LocalImport } from "./local-import-types";

export const CLOCK_NAMES = ["_CFAbsoluteTimeGetCurrent", "_gettimeofday"] as const;
const MS_PER_SECOND = 1000;
const US_PER_MS = 1000;
/** Seconds from the Unix epoch to CoreFoundation's reference date, 2001-01-01. */
const CF_EPOCH_OFFSET = 978_307_200;
const MICROSECONDS_OFFSET = 4;
const TIME_ARGUMENT = 0;

/** Wall-clock imports: `Date.now()` is the same absolute clock on every thread. */
export function clockImports(
  memory: GuestMemory,
): Record<(typeof CLOCK_NAMES)[number], LocalImport> {
  return {
    _CFAbsoluteTimeGetCurrent: () => doubleWide(Date.now() / MS_PER_SECOND - CF_EPOCH_OFFSET),
    _gettimeofday: (a) => {
      const now = Date.now(),
        time = a(TIME_ARGUMENT);
      if (time) {
        write32(memory, time, Math.floor(now / MS_PER_SECOND));
        write32(memory, time + MICROSECONDS_OFFSET, (now % MS_PER_SECOND) * US_PER_MS);
      }
      return 0;
    },
  };
}
