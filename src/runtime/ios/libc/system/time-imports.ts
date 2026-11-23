import { write32, type GuestMemory } from "../../../memory/guest-memory";
import type { SystemImport } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const MICROSECONDS_PER_MILLISECOND = 1000;
const NANOSECONDS_PER_MILLISECOND = 1e6;
const CORE_FOUNDATION_EPOCH_SECONDS = 978307200;
const WORD_BITS = 32n;
const TimeBase = { Numerator: 0, Denominator: 4 } as const;
const TimeValue = { Seconds: 0, Microseconds: 4 } as const;

const absoluteTime = (): bigint =>
  BigInt(Math.floor(performance.now() * NANOSECONDS_PER_MILLISECOND));

export function timeImports(cpu: GuestMemory): Record<string, SystemImport> {
  const double = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  return {
    _time: (a) => {
      const seconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      if (a(0)) write32(cpu, a(0), seconds);
      return seconds;
    },
    _CFAbsoluteTimeGetCurrent: () => {
      double.setFloat64(
        0,
        Date.now() / MILLISECONDS_PER_SECOND - CORE_FOUNDATION_EPOCH_SECONDS,
        true,
      );
      return double.getBigUint64(0, true);
    },
    _mach_absolute_time: absoluteTime,
    _mach_wait_until: (a) => {
      const deadline = BigInt(a(0)) | (BigInt(a(1)) << WORD_BITS);
      const poll = (): number | undefined => (absoluteTime() >= deadline ? 0 : undefined);
      return poll() ?? { wait: poll };
    },
    _mach_timebase_info: (a) => {
      write32(cpu, a(0) + TimeBase.Numerator, 1);
      write32(cpu, a(0) + TimeBase.Denominator, 1);
      return 0;
    },
    _gettimeofday: (a) => {
      const now = Date.now();
      if (a(0)) {
        write32(cpu, a(0) + TimeValue.Seconds, Math.floor(now / MILLISECONDS_PER_SECOND));
        write32(
          cpu,
          a(0) + TimeValue.Microseconds,
          (now % MILLISECONDS_PER_SECOND) * MICROSECONDS_PER_MILLISECOND,
        );
      }
      return 0;
    },
  };
}
