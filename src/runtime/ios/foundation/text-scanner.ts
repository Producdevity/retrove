import { CharacterSet, decimalValue } from "./character-set";
const INT32_MAX = 0x7fffffff;
const INT32_MIN_MAGNITUDE = 0x80000000;
const DECIMAL_RADIX = 10;
const HEX_RADIX = 16;
const UINT32_MAX = 0xffffffff;
const HEX_PREFIX_LENGTH = 2;

export class TextScanner {
  private position = 0;
  skipped = CharacterSet.whitespaceAndNewline();
  caseSensitive = false;
  constructor(readonly source: string) {}
  get location(): number {
    return this.position;
  }
  set location(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > this.source.length)
      throw new Error("Scanner location is outside its string.");
    this.position = value;
  }
  get atEnd(): boolean {
    return this.skip(this.position) === this.source.length;
  }

  integer(): number | null {
    let cursor = this.skip(this.position);
    const sign = this.source.charAt(cursor);
    const negative = sign === "-";
    if (negative || sign === "+") cursor = this.skip(cursor + 1);
    const start = cursor;
    const limit = negative ? INT32_MIN_MAGNITUDE : INT32_MAX;
    let magnitude = 0;
    while (cursor < this.source.length) {
      const digit = decimalValue(this.source.charAt(cursor));
      if (digit === undefined) break;
      magnitude = Math.min(limit, magnitude * DECIMAL_RADIX + digit);
      cursor++;
    }
    if (cursor === start) return null;
    this.position = cursor;
    return negative ? -magnitude : magnitude;
  }

  hexInteger(): number | null {
    let cursor = this.skip(this.position);
    if (/^0[xX][0-9a-fA-F]/.test(this.source.slice(cursor))) cursor += HEX_PREFIX_LENGTH;
    const start = cursor;
    let magnitude = 0;
    while (cursor < this.source.length && /^[0-9a-fA-F]$/.test(this.source.charAt(cursor))) {
      magnitude = Math.min(
        UINT32_MAX,
        magnitude * HEX_RADIX + Number.parseInt(this.source.charAt(cursor), HEX_RADIX),
      );
      cursor++;
    }
    if (cursor === start) return null;
    this.position = cursor;
    return magnitude;
  }

  characters(set: CharacterSet, invert = false): string | null {
    const start = this.skip(this.position);
    let end = start;
    while (end < this.source.length && set.contains(this.source.charAt(end)) !== invert) end++;
    if (end === start) return null;
    this.position = end;
    return this.source.slice(start, end);
  }

  string(value: string): string | null {
    const start = this.skip(this.position);
    if (!value.length || !this.matches(start, value)) return null;
    this.position = start + value.length;
    return this.source.slice(start, this.position);
  }

  upToString(value: string): string | null {
    const start = this.skip(this.position);
    let end = start;
    if (!value.length) return null;
    while (end < this.source.length && !this.matches(end, value)) end++;
    if (end === start) return null;
    this.position = end;
    return this.source.slice(start, end);
  }

  private matches(at: number, value: string): boolean {
    const candidate = this.source.slice(at, at + value.length);
    return this.caseSensitive
      ? candidate === value
      : candidate.toLowerCase() === value.toLowerCase();
  }
  private skip(at: number): number {
    while (at < this.source.length && this.skipped.contains(this.source.charAt(at))) at++;
    return at;
  }
}
