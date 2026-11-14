export const NibNumberBytes = { Byte: 1, Half: 2, Word: 4, Double: 8 } as const;
const VARINT_PAYLOAD = 0x7f;
const VARINT_END = 0x80;
const VARINT_RADIX = 128;
const VARINT_BYTES = 8;
export class NibReader {
  private readonly view: DataView;
  constructor(
    private readonly bytes: Uint8Array,
    private offset: number,
    private readonly end: number,
  ) {
    if (offset < 0 || end > bytes.length || offset > end)
      throw new Error("Invalid nib section bounds.");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.end)
      throw new Error("Truncated nib archive.");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  byte(): number {
    return this.take(1)[0] ?? 0;
  }
  varint(): number {
    let value = 0,
      scale = 1;
    for (let index = 0; index < VARINT_BYTES; index++) {
      const byte = this.byte();
      value += (byte & VARINT_PAYLOAD) * scale;
      if (!Number.isSafeInteger(value)) throw new Error("Nib integer exceeds safe range.");
      // Nib varints set the high bit on the final byte.
      if (byte & VARINT_END) return value;
      scale *= VARINT_RADIX;
    }
    throw new Error("Unterminated nib integer.");
  }
  number(bytes: number, signed = false, floating = false): number | bigint {
    const offset = this.offset;
    this.take(bytes);
    if (floating)
      return bytes === Float32Array.BYTES_PER_ELEMENT
        ? this.view.getFloat32(offset, true)
        : this.view.getFloat64(offset, true);
    switch (bytes) {
      case 1:
        return signed ? this.view.getInt8(offset) : this.view.getUint8(offset);
      case NibNumberBytes.Half:
        return signed ? this.view.getInt16(offset, true) : this.view.getUint16(offset, true);
      case NibNumberBytes.Word:
        return signed ? this.view.getInt32(offset, true) : this.view.getUint32(offset, true);
      default:
        return signed ? this.view.getBigInt64(offset, true) : this.view.getBigUint64(offset, true);
    }
  }
}
