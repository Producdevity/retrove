import { read32, readCStringBytes, readString, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import type { GuestArguments } from "../objc/host";
import { byteString } from "./byte-string";
import type { GuestHeap, GuestImport } from "./guest-imports";
import { scanFloat, scanInteger, writeInteger, writeText, type Target } from "./scan-conversions";
import { parseScanset } from "./scanset";

const SPECIFICATION = /%(?:(\d+)\$)?(\*)?(\d*)(hh|ll|[hlqjztL])?([diouxXpeEfFgGaAcsnCSc%[])/y;
const WHITESPACE = /[\t\n\v\f\r ]/;
const SPECIFICATION_PREVIEW = 16;
const FILE_CHUNK = 4096;
const Fscanf = { File: 0, Format: 1, Arguments: 2 } as const;
const Sscanf = { Input: 0, Format: 1, Arguments: 2 } as const;
const SEEK_SET = 0;

export interface ScanResult {
  count: number;
  used: number;
}
export interface ScanFiles {
  _ftell(a: GuestArguments): Promise<number>;
  _fread(a: GuestArguments): Promise<number>;
  _fseek(a: GuestArguments): Promise<unknown>;
}

const STOP = Symbol("stop");
const space = (character: string | undefined): boolean =>
  character !== undefined && WHITESPACE.test(character);

function wideText(cpu: GuestMemory, pointer: number): string {
  let text = "",
    index = 0;
  for (;;) {
    const character = read32(cpu, pointer + index * WORD_BYTES);
    if (!character) return text;
    text += String.fromCodePoint(character);
    index++;
  }
}

class Scan {
  private index = 0;
  private position = 0;
  private nextArgument = 0;
  private assigned = 0;
  private completed = 0;
  constructor(
    private readonly cpu: GuestMemory,
    private readonly input: string,
    private readonly format: string,
    private readonly arg: (index: number) => number,
    private readonly wide: boolean,
  ) {}

  run(): ScanResult {
    while (this.position < this.format.length) {
      const early = this.step();
      if (early) return early === STOP ? { count: this.assigned, used: this.index } : early;
    }
    return { count: this.assigned, used: this.index };
  }

  private step(): ScanResult | typeof STOP | undefined {
    const symbol = this.format[this.position];
    if (space(symbol)) {
      while (space(this.format[this.position])) this.position++;
      while (space(this.input[this.index])) this.index++;
      return undefined;
    }
    if (symbol !== "%") return this.literal(symbol);
    return this.conversion();
  }

  private literal(symbol: string | undefined): ScanResult | undefined {
    if (this.input[this.index] !== symbol)
      return {
        count: this.index === this.input.length && !this.completed ? -1 : this.assigned,
        used: this.index,
      };
    this.index++;
    this.position++;
    return undefined;
  }

  private conversion(): ScanResult | typeof STOP | undefined {
    SPECIFICATION.lastIndex = this.position;
    const match = SPECIFICATION.exec(this.format);
    if (!match)
      throw new Error(
        "Unsupported Darwin scanf conversion " +
          this.format.slice(this.position, this.position + SPECIFICATION_PREVIEW),
      );
    this.position = SPECIFICATION.lastIndex;
    const [, argumentPosition, star, width, length, code = ""] = match;
    const maximum = width ? Number(width) : Infinity;
    if (code === "%") {
      if (this.input[this.index] !== "%") return STOP;
      this.index++;
      return undefined;
    }
    const suppress = Boolean(star);
    const out = suppress
      ? 0
      : this.arg(argumentPosition ? Number(argumentPosition) - 1 : this.nextArgument++);
    const target: Target = { cpu: this.cpu, out, suppress, length };
    if (code === "n") {
      writeInteger(target, BigInt(this.index));
      this.completed++;
      return undefined;
    }
    if (!"cC[".includes(code)) while (space(this.input[this.index])) this.index++;
    if (this.index >= this.input.length)
      return { count: this.completed ? this.assigned : -1, used: this.index };
    const chunk = this.input.slice(
      this.index,
      Number.isFinite(maximum) ? this.index + maximum : undefined,
    );
    const consumed = this.convert(target, code, width, chunk);
    if (consumed === undefined) return STOP;
    if (typeof consumed === "object") return consumed;
    this.index += consumed;
    if (!suppress) this.assigned++;
    this.completed++;
    return undefined;
  }

  private convert(
    target: Target,
    code: string,
    width: string | undefined,
    chunk: string,
  ): number | ScanResult | undefined {
    if ("diouxXp".includes(code)) return scanInteger(target, code, chunk);
    if ("eEfFgGaA".includes(code)) return scanFloat(target, chunk);
    let length = 0;
    if (code === "[") {
      const { matches, end } = parseScanset(this.format, this.position);
      this.position = end;
      while (length < chunk.length && matches(chunk.charAt(length))) length++;
    } else if ("cC".includes(code)) {
      length = width ? Number(width) : 1;
      if (chunk.length < length)
        return { count: this.completed ? this.assigned : -1, used: this.input.length };
    } else while (length < chunk.length && !space(chunk[length])) length++;
    if (!length) return undefined;
    writeText(target, code, chunk.slice(0, length), this.wide);
    return length;
  }
}
export function scanDarwin(
  cpu: GuestMemory,
  input: string,
  format: string,
  arg: (index: number) => number,
  wide = false,
): ScanResult {
  return new Scan(cpu, input, format, arg, wide).run();
}

export function scanImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  files: ScanFiles,
): Record<string, GuestImport> {
  return {
    _sscanf: (a) =>
      scanDarwin(
        cpu,
        byteString(readCStringBytes(cpu, a(Sscanf.Input))),
        readString(cpu, a(Sscanf.Format)),
        (i) => a(Sscanf.Arguments + i),
      ).count,
    _swscanf: (a) =>
      scanDarwin(
        cpu,
        wideText(cpu, a(Sscanf.Input)),
        wideText(cpu, a(Sscanf.Format)),
        (i) => a(Sscanf.Arguments + i),
        true,
      ).count,
    _fscanf: async (a) => {
      const file = a(Fscanf.File),
        format = readString(cpu, a(Fscanf.Format)),
        word = (i: number): number => a(Fscanf.Arguments + i),
        start = await files._ftell(() => file);
      if (start < 0) return -1;
      const buffer = heap.alloc(FILE_CHUNK);
      if (!buffer) return -1;
      let text = "";
      try {
        for (;;) {
          const readArguments = [buffer, 1, FILE_CHUNK, file];
          const count = await files._fread((i) => readArguments[i] ?? 0);
          text += String.fromCharCode(...cpu.read(buffer, count));
          const result = scanDarwin(cpu, text, format, word);
          if (count < FILE_CHUNK || result.used < text.length) {
            if (result.used < text.length) {
              const seekArguments = [file, start + result.used, SEEK_SET];
              await files._fseek((i) => seekArguments[i] ?? 0);
            }
            return result.count;
          }
        }
      } finally {
        heap.free(buffer);
      }
    },
  };
}
