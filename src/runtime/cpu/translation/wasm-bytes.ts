const Leb = {
  Payload: 0x7f,
  Continue: 0x80,
  Sign: 0x40,
  Radix: 128,
  Bits: 7,
} as const;
const Limit = {
  Byte: 0xff,
  Unsigned: 0xffffffff,
  SignedMinimum: -0x80000000,
  SignedMaximum: 0x7fffffff,
  WordRange: 0x100000000,
  WordBytes: 4,
  ByteBits: 8,
} as const;
const Wide = {
  Bits: 64,
  Payload: 0x7fn,
  Shift: 7n,
  Zero: 0n,
  MinusOne: -1n,
} as const;

/** Byte sink with the LEB128 and vector encodings of the Wasm binary format. */
export class Bytes {
  readonly values: number[] = [];

  byte(...values: number[]): this {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > Limit.Byte)
        throw new RangeError("Invalid byte " + value);
      this.values.push(value);
    }
    return this;
  }

  append(values: readonly number[]): this {
    for (const value of values) this.values.push(value);
    return this;
  }

  /** Little-endian 32-bit word. */
  word(value: number): this {
    for (let index = 0; index < Limit.WordBytes; index++)
      this.byte((value >>> (index * Limit.ByteBits)) & Limit.Byte);
    return this;
  }

  unsigned(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > Limit.Unsigned)
      throw new RangeError("Invalid unsigned integer");
    let rest = value;
    do {
      let next = rest & Leb.Payload;
      rest = Math.floor(rest / Leb.Radix);
      if (rest) next |= Leb.Continue;
      this.values.push(next);
    } while (rest);
    return this;
  }

  signed(value: number): this {
    if (!Number.isInteger(value) || value < Limit.SignedMinimum || value > Limit.Unsigned)
      throw new RangeError("Invalid signed integer");
    let rest = value > Limit.SignedMaximum ? value - Limit.WordRange : value;
    for (;;) {
      const next = rest & Leb.Payload;
      rest >>= Leb.Bits;
      const done = (rest === 0 && !(next & Leb.Sign)) || (rest === -1 && !!(next & Leb.Sign));
      this.values.push(done ? next : next | Leb.Continue);
      if (done) return this;
    }
  }

  signed64(value: bigint): this {
    let rest = BigInt.asIntN(Wide.Bits, value);
    for (;;) {
      const next = Number(rest & Wide.Payload);
      rest >>= Wide.Shift;
      const done =
        (rest === Wide.Zero && !(next & Leb.Sign)) ||
        (rest === Wide.MinusOne && !!(next & Leb.Sign));
      this.values.push(done ? next : next | Leb.Continue);
      if (done) return this;
    }
  }

  name(text: string): this {
    const bytes = new TextEncoder().encode(text);
    this.unsigned(bytes.length);
    return this.byte(...bytes);
  }

  vector(items: readonly Bytes[]): this {
    this.unsigned(items.length);
    for (const item of items) this.append(item.values);
    return this;
  }

  sized(content: Bytes): this {
    this.unsigned(content.values.length);
    return this.append(content.values);
  }
}
