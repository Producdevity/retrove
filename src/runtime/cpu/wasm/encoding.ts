const Encoding = {
  PayloadBits: 7,
  PayloadMask: 0x7f,
  Continuation: 0x80,
  Sign: 0x40,
  MaximumUnsigned: 0xffff_ffff,
  MinimumSigned: -0x8000_0000,
  MaximumSigned: 0x7fff_ffff,
};
export class Bytes {
  private readonly values: number[] = [];
  add(...values: number[]): this {
    for (const value of values) this.values.push(value);
    return this;
  }
  append(values: Uint8Array): this {
    for (const value of values) this.values.push(value);
    return this;
  }
  unsigned(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0 || value > Encoding.MaximumUnsigned)
      throw new RangeError("Invalid unsigned WebAssembly integer.");
    do {
      const byte = value & Encoding.PayloadMask;
      value = Math.floor(value / Encoding.Continuation);
      this.add(byte | (value ? Encoding.Continuation : 0));
    } while (value);
    return this;
  }
  signed(value: number): this {
    if (
      !Number.isSafeInteger(value) ||
      value < Encoding.MinimumSigned ||
      value > Encoding.MaximumSigned
    )
      throw new RangeError("Invalid signed WebAssembly integer.");
    for (;;) {
      const byte = value & Encoding.PayloadMask;
      value >>= Encoding.PayloadBits;
      const complete =
        (value === 0 && !(byte & Encoding.Sign)) || (value === -1 && !!(byte & Encoding.Sign));
      this.add(byte | (complete ? 0 : Encoding.Continuation));
      if (complete) return this;
    }
  }
  name(value: string): this {
    const bytes = new TextEncoder().encode(value);
    return this.unsigned(bytes.length).append(bytes);
  }
  sized(values: Uint8Array): this {
    return this.unsigned(values.length).append(values);
  }
  finish(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.values);
  }
}
