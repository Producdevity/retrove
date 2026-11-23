import { write32, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";

const BYTE_BYTES = 1;
const HALF_BYTES = 2;
const QUAD_BYTES = 8;
const BIT_WIDTH = 64;
const HEX_RADIX = 16;
const OCTAL_RADIX = 8;
const DECIMAL_RADIX = 10;
const HEX_DIGIT_BITS = 4;
const BINARY_BASE = 2;
const SINGLE_FLOAT_BYTES = 4;
const encoder = new TextEncoder();

const DECIMAL = /^[+-]?\d+/;
const OCTAL = /^[+-]?[0-7]+/;
const HEXADECIMAL = /^[+-]?(?:0[xX])?[0-9a-fA-F]+/;
const AUTOMATIC = /^[+-]?(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9]\d*)/;
const FLOAT =
  /^[+-]?(?:inf(?:inity)?|nan(?:\([a-z0-9_]*\))?|0x(?:[0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)(?:p[+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i;

export interface Target {
  readonly cpu: GuestMemory;
  readonly out: number;
  readonly suppress: boolean;
  readonly length: string | undefined;
}

export function integerBytes(length: string | undefined): number {
  if (length === "hh") return BYTE_BYTES;
  if (length === "h") return HALF_BYTES;
  return length !== undefined && ["ll", "q", "j"].includes(length) ? QUAD_BYTES : WORD_BYTES;
}

export function writeInteger(target: Target, value: bigint): void {
  if (target.suppress) return;
  const bytes = new Uint8Array(QUAD_BYTES);
  new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(BIT_WIDTH, value), true);
  target.cpu.write(target.out, bytes.subarray(0, integerBytes(target.length)));
}

function integerPattern(code: string): { base: number; pattern: RegExp } {
  if ("xXp".includes(code)) return { base: HEX_RADIX, pattern: HEXADECIMAL };
  if (code === "o") return { base: OCTAL_RADIX, pattern: OCTAL };
  if (code === "i") return { base: 0, pattern: AUTOMATIC };
  return { base: DECIMAL_RADIX, pattern: DECIMAL };
}

/** Returns the characters consumed, or undefined when no integer starts the input. */
export function scanInteger(target: Target, code: string, chunk: string): number | undefined {
  const { base, pattern } = integerPattern(code);
  const token = pattern.exec(chunk)?.[0];
  if (!token) return undefined;
  const negative = token.startsWith("-"),
    digits = token.replace(/^[+-]/, "");
  const radix =
    base ||
    (/^0x/i.test(digits) ? HEX_RADIX : digits.startsWith("0") ? OCTAL_RADIX : DECIMAL_RADIX);
  const magnitude = BigInt(
    radix === HEX_RADIX
      ? "0x" + digits.replace(/^0x/i, "")
      : radix === OCTAL_RADIX
        ? "0o" + digits
        : digits,
  );
  writeInteger(target, negative ? -magnitude : magnitude);
  return token.length;
}

function floatValue(token: string): number {
  if (/^[+-]?inf/i.test(token)) return token.startsWith("-") ? -Infinity : Infinity;
  if (!/^[+-]?0x/i.test(token)) return Number(token);
  const [mantissa = "", power] = token.replace(/^[+-]?0x/i, "").split(/p/i);
  const [whole = "", fraction = ""] = mantissa.split(".");
  const magnitude =
    parseInt(whole + fraction, HEX_RADIX) *
    BINARY_BASE ** ((Number(power) || 0) - HEX_DIGIT_BITS * fraction.length);
  return magnitude * (token.startsWith("-") ? -1 : 1);
}

export function scanFloat(target: Target, chunk: string): number | undefined {
  const token = FLOAT.exec(chunk)?.[0];
  if (!token) return undefined;
  const value = floatValue(token);
  if (!target.suppress) {
    const double = target.length === "l" || target.length === "L";
    const bytes = new Uint8Array(double ? QUAD_BYTES : SINGLE_FLOAT_BYTES),
      view = new DataView(bytes.buffer);
    if (double) view.setFloat64(0, value, true);
    else view.setFloat32(0, value, true);
    target.cpu.write(target.out, bytes);
  }
  return token.length;
}

export function writeText(target: Target, code: string, text: string, wideInput: boolean): void {
  if (target.suppress) return;
  const { cpu, out } = target;
  const terminated = !"cC".includes(code);
  if (target.length === "l" || code === "C" || code === "S") {
    const characters = Array.from(text);
    characters.forEach((character, index) => {
      write32(cpu, out + WORD_BYTES * index, character.codePointAt(0) ?? 0);
    });
    if (terminated) write32(cpu, out + characters.length * WORD_BYTES, 0);
  } else {
    const bytes = wideInput ? encoder.encode(text) : Uint8Array.from(text, (c) => c.charCodeAt(0));
    cpu.write(out, bytes);
    if (terminated) cpu.write(out + bytes.length, Uint8Array.of(0));
  }
}
