import { read32, readString, write32, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { Errno } from "./bsd-errno";
import type { GuestHeap, GuestImport } from "./guest-imports";
import { formatTime } from "./strftime";

const TM_BYTES = 44;
const TM_YEAR_BASE = 1900;
const MS_PER_DAY = 86400000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const JULY = 6;
const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const CLOCKS_PER_MILLISECOND = 1000;
const Tm = {
  Seconds: 0,
  Minutes: 1,
  Hours: 2,
  Day: 3,
  Month: 4,
  Year: 5,
} as const;
const Strftime = { Buffer: 0, Capacity: 1, Format: 2, Time: 3 } as const;
const Time = { Seconds: 0, Reentrant: 1 } as const;
const encoder = new TextEncoder();
const DEFAULT_ZONE = "UTC";

interface Fields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

function fields(date: Date, local: boolean): Fields {
  return local
    ? {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        weekday: date.getDay(),
        hours: date.getHours(),
        minutes: date.getMinutes(),
        seconds: date.getSeconds(),
      }
    : {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        hours: date.getUTCHours(),
        minutes: date.getUTCMinutes(),
        seconds: date.getUTCSeconds(),
      };
}

class TimeStructs {
  private readonly slots = new Map<number, number>();
  private readonly zones = new Map<string, number>();
  private readonly zoneName = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" });
  constructor(
    private readonly cpu: GuestMemory,
    private readonly heap: GuestHeap,
    private readonly threadID: () => number,
  ) {}
  shared(): number {
    const id = this.threadID();
    let slot = this.slots.get(id);
    if (slot === undefined) {
      slot = this.heap.zero(TM_BYTES);
      this.slots.set(id, slot);
    }
    return slot;
  }
  private zoneAddress(zone: string): number {
    let address = this.zones.get(zone);
    if (address === undefined) {
      address = this.heap.string(zone);
      this.zones.set(zone, address);
    }
    return address;
  }
  pack(seconds: number, ptr: number, local: boolean): number {
    const date = new Date(seconds * MS_PER_SECOND);
    const { year, month, day, weekday, hours, minutes, seconds: second } = fields(date, local);
    const offset = local ? -SECONDS_PER_MINUTE * date.getTimezoneOffset() : 0;
    const standard = local
      ? Math.max(
          new Date(year, 0, 1).getTimezoneOffset(),
          new Date(year, JULY, 1).getTimezoneOffset(),
        )
      : 0;
    const zone = local
      ? this.zoneName.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ||
        DEFAULT_ZONE
      : DEFAULT_ZONE;
    const words = [
      second,
      minutes,
      hours,
      day,
      month,
      year - TM_YEAR_BASE,
      weekday,
      (Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / MS_PER_DAY,
      Number(local && date.getTimezoneOffset() < standard),
      offset,
      this.zoneAddress(zone),
    ];
    words.forEach((value, index) => {
      write32(this.cpu, ptr + index * WORD_BYTES, value);
    });
    return ptr;
  }
}

export function calendarImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  errno: number,
  threadID: () => number,
): Record<string, GuestImport> {
  const structs = new TimeStructs(cpu, heap, threadID);
  const pack = (seconds: number, ptr: number, local: boolean): number =>
    structs.pack(seconds, ptr, local);
  function convert(a: (n: number) => number, local: boolean, reentrant: boolean): number {
    const out = reentrant ? a(Time.Reentrant) : structs.shared();
    if (!a(Time.Seconds) || !out) {
      write32(cpu, errno, Errno.BadAddress);
      return 0;
    }
    return pack(read32(cpu, a(Time.Seconds)) | 0, out, local);
  }
  const doubles = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  // clock() is process CPU time, which a busy game spends almost entirely running: wall time
  // matches iOS. Guest CPU time alone ran games that time with clock() at half speed or worse.
  const started = performance.now();
  return {
    _clock: () => Math.floor((performance.now() - started) * CLOCKS_PER_MILLISECOND) >>> 0,
    _difftime: (a) => {
      doubles.setFloat64(0, (a(0) | 0) - (a(1) | 0), true);
      return doubles.getBigUint64(0, true);
    },
    _gmtime: (a) => convert(a, false, false),
    _localtime: (a) => convert(a, true, false),
    _localtime_r: (a) => convert(a, true, true),
    _mktime: (a) => {
      const pointer = a(0),
        field = (index: number): number => read32(cpu, pointer + index * WORD_BYTES) | 0;
      const date = new Date(0);
      date.setFullYear(field(Tm.Year) + TM_YEAR_BASE, field(Tm.Month), field(Tm.Day));
      date.setHours(field(Tm.Hours), field(Tm.Minutes), field(Tm.Seconds), 0);
      const seconds = date.valueOf() / MS_PER_SECOND;
      if (!Number.isInteger(seconds) || seconds < INT32_MIN || seconds > INT32_MAX) {
        write32(cpu, errno, Errno.Overflow);
        return -1;
      }
      pack(seconds, pointer, true);
      return seconds;
    },
    _strftime: (a) => {
      const text = formatTime(cpu, a(Strftime.Time), readString(cpu, a(Strftime.Format)));
      const bytes = encoder.encode(text + "\0");
      if (bytes.length > a(Strftime.Capacity)) return 0;
      cpu.write(a(Strftime.Buffer), bytes);
      return bytes.length - 1;
    },
  };
}
