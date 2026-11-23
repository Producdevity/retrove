import { readCString, requireFormat } from "./format";

const PAYLOAD_MASK = 0x7f;
const CONTINUATION = 0x80;
const SIGN_BIT = 0x40;
const SEPTET_BITS = 7n;
const MAX_SHIFT = 70n;
const FINAL_SHIFT = 63n;
const NO_BITS = 0n;
const ONE_BIT = 1n;
const FULL_SEPTET = 127n;
const WORD_BITS = 32;
const MAX_UINT32 = 0xffffffffn;
const MIN_INT32 = -0x80000000n;

export class Cursor {
  readonly bytes: Uint8Array;
  offset: number;
  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.offset = offset;
  }
  byte(): number {
    requireFormat(this.offset < this.bytes.length, "truncated dyld stream");
    return this.bytes[this.offset++] ?? 0;
  }
  leb(signed = false, wrap32 = false): number {
    let bits = NO_BITS;
    for (let shift = NO_BITS; shift < MAX_SHIFT; shift += SEPTET_BITS) {
      const b = this.byte();
      const value = BigInt(b & PAYLOAD_MASK);
      requireFormat(
        shift !== FINAL_SHIFT ||
          (signed ? value === NO_BITS || value === FULL_SEPTET : value <= ONE_BIT),
        "oversized dyld integer",
      );
      bits |= value << shift;
      if (!(b & CONTINUATION)) {
        if (signed && b & SIGN_BIT) bits -= ONE_BIT << (shift + SEPTET_BITS);
        if (wrap32) return Number(BigInt.asUintN(WORD_BITS, bits));
        requireFormat(bits <= MAX_UINT32 && bits >= MIN_INT32, "dyld value exceeds 32 bits");
        return Number(bits);
      }
    }
    throw new Error("Mach-O: invalid dyld integer");
  }
  string(): string {
    const { value, end } = readCString(this.bytes, this.offset);
    this.offset = end;
    return value;
  }
}
