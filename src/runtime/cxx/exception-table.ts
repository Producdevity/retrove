import { read32, type GuestMemory } from "../memory/guest-memory";
import type { ExceptionMatcher, ThrownValue } from "./exception-matcher";

/**
 * Clang's ARMv7 Darwin SjLj function context: previous, call-site number,
 * four landing-pad arguments, personality, LSDA, saved r7, pc and sp.
 */
export const Frame = {
  Previous: 0,
  CallSite: 4,
  Exception: 8,
  Selector: 12,
  Personality: 24,
  Lsda: 28,
  FramePointer: 32,
  Resume: 36,
  StackPointer: 40,
} as const;
const NO_LANDING_PAD = 0xffff_ffff;
const DW_EH_PE_OMIT = 0xff;
const TypeEncoding = { Absolute: 0, Udata4: 3, PcRelative: 0x1b, Indirect: 0x9b } as const;
const SUPPORTED_ENCODINGS: readonly number[] = Object.values(TypeEncoding);
const EncodingFlag = { PcRelative: 0x10, Indirect: 0x80 } as const;
const Leb = { Payload: 0x7f, More: 0x80, Sign: 0x40, Shift: 7, Limit: 35 } as const;
const RADIX = 2;
const WORD_BYTES = 4;

/** The landing pad chosen for a frame: cleanup only, or a handler with its selector and value. */
export interface CallSite {
  readonly pad: number;
  readonly cleanup?: boolean;
  readonly handler?: boolean;
  readonly selector?: number;
  readonly value?: number;
}

/** Reads one function's language-specific data area from guest memory. */
class ExceptionTable {
  ptr: number;
  typeEnd = 0;
  encoding = 0;
  readonly #memory: GuestMemory;
  constructor(memory: GuestMemory, lsda: number) {
    this.#memory = memory;
    this.ptr = lsda;
  }
  byte(): number {
    return this.#memory.read(this.ptr++, 1)[0] ?? 0;
  }
  leb(signed = false): number {
    let value = 0;
    for (let shift = 0; shift < Leb.Limit; shift += Leb.Shift) {
      const b = this.byte();
      value += (b & Leb.Payload) * RADIX ** shift;
      if (!(b & Leb.More))
        return signed && b & Leb.Sign ? value - RADIX ** (shift + Leb.Shift) : value;
    }
    throw new Error("Invalid integer in C++ exception table");
  }
  catchType(i: number): number {
    if (!this.typeEnd) throw new Error("Missing C++ type table");
    const slot = this.typeEnd - WORD_BYTES * i;
    let value = read32(this.#memory, slot);
    if (value && this.encoding & EncodingFlag.PcRelative) value = (slot + value) >>> 0;
    return value && this.encoding & EncodingFlag.Indirect ? read32(this.#memory, value) : value;
  }
}

function action(
  table: ExceptionTable,
  matcher: ExceptionMatcher,
  exception: ThrownValue,
  pad: number,
): CallSite {
  let cleanup = false;
  const visited = new Set<number>();
  while (!visited.has(table.ptr)) {
    visited.add(table.ptr);
    const selector = table.leb(true),
      nextField = table.ptr,
      delta = table.leb(true);
    if (selector > 0) {
      const value = matcher.adjusted(exception, table.catchType(selector));
      if (value !== undefined) return { pad, selector, value, handler: true };
    } else if (selector < 0) {
      const resume = table.ptr;
      table.ptr = table.typeEnd - selector - 1;
      let allowed = false;
      for (let entry = table.leb(); entry !== 0; entry = table.leb())
        if (matcher.adjusted(exception, table.catchType(entry)) !== undefined) allowed = true;
      table.ptr = resume;
      if (!allowed) return { pad, selector, value: exception.object, handler: true };
    } else cleanup = true;
    if (!delta) return { pad, cleanup };
    table.ptr = nextField + delta;
  }
  throw new Error("Cyclic C++ exception action table");
}

/** The landing pad of `frame`'s current call site for `exception`, if it has one. */
export function callSite(
  memory: GuestMemory,
  matcher: ExceptionMatcher,
  frame: number,
  exception: ThrownValue,
): CallSite | undefined {
  const lsda = read32(memory, frame + Frame.Lsda);
  let index = read32(memory, frame + Frame.CallSite);
  if (!lsda || index === NO_LANDING_PAD) return;
  if (!index) throw new Error("C++ exception crossed a non-throwing call");
  const table = new ExceptionTable(memory, lsda);
  if (table.byte() !== DW_EH_PE_OMIT)
    throw new Error("Unsupported C++ landing-pad address encoding");
  table.encoding = table.byte();
  if (table.encoding !== DW_EH_PE_OMIT) {
    if (!SUPPORTED_ENCODINGS.includes(table.encoding))
      throw new Error(`Unsupported C++ type table encoding ${table.encoding}`);
    const length = table.leb();
    table.typeEnd = table.ptr + length;
  }
  table.byte(); // The SjLj call-site table always uses ULEB pairs.
  const length = table.leb(),
    end = table.ptr + length;
  while (table.ptr < end) {
    const pad = table.leb(),
      next = table.leb();
    if (table.ptr > end) throw new Error("Truncated C++ call-site table");
    if (--index) continue;
    if (!next) return { pad, cleanup: true };
    table.ptr = end + next - 1;
    return action(table, matcher, exception, pad);
  }
  throw new Error("C++ call site outside its exception table");
}
