import { bufferImports } from "../../ios/libc/format-imports";
import { stringImports } from "../../ios/libc/strings";
import { f32, floatWord } from "../../ios/libc/pure-math";
import { write32, type GuestMemory } from "../../memory/guest-memory";
import { Forward, type LocalImport } from "./local-import-types";

export const FORMAT_NAMES = [
  "_snprintf",
  "_vsnprintf",
  "_sprintf",
  "_vsprintf",
  "___sprintf_chk",
  "___snprintf_chk",
  "___vsnprintf_chk",
  "___vsprintf_chk",
] as const;
export const NUMERIC_NAMES = ["___sincosf_stret", "_atof", ...FORMAT_NAMES] as const;
const NO_ERRNO = 0;
const WORD_BYTES = 4;
/** `___sincosf_stret` argument words: the result struct's address, then the angle. */
const Sincos = { Result: 0, Angle: 1 } as const;

/** Reads pass through; any write is `atof` reporting ERANGE, which only the main thread can record. */
class ErrnoProbe implements GuestMemory {
  written = false;
  constructor(private readonly memory: GuestMemory) {}
  read(address: number, size: number): Uint8Array {
    return this.memory.read(address, size);
  }
  write(): void {
    this.written = true;
  }
}

function localAtof(memory: GuestMemory): LocalImport | undefined {
  const probe = new ErrnoProbe(memory),
    atof = stringImports(probe, NO_ERRNO)["_atof"];
  if (!atof) return undefined;
  return (a) => {
    probe.written = false;
    const value = atof(a);
    return probe.written ? Forward : value;
  };
}

/** A formatting failure is the main thread's to report, with its thread and gate context. */
function guarded(run: (a: (n: number) => number) => number): LocalImport {
  return (a) => {
    try {
      return run(a);
    } catch {
      return Forward;
    }
  };
}

/** Floating-point and printf-family imports that read and write only guest memory. */
export function numericImports(memory: GuestMemory): Map<string, LocalImport> {
  const table = new Map<string, LocalImport>();
  table.set("___sincosf_stret", (a) => {
    const angle = f32(a, Sincos.Angle),
      result = a(Sincos.Result);
    write32(memory, result, floatWord(Math.sin(angle)));
    write32(memory, result + WORD_BYTES, floatWord(Math.cos(angle)));
    return result;
  });
  const atof = localAtof(memory);
  if (atof) table.set("_atof", atof);
  const formats = bufferImports(memory);
  for (const name of FORMAT_NAMES) {
    const run = formats[name];
    if (run) table.set(name, guarded(run));
  }
  return table;
}
