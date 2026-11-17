import { ArchiveReference } from "../../ios/foundation/archives/graph";
import { MAX_PLIST_DEPTH, type PlistValue, plistDictionary, plistInteger } from "./values";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const utf16be = new TextDecoder("utf-16be", { fatal: true });
const HEADER_BYTES = 8;
const TRAILER_BYTES = 32;
const MAX_WIDTH = 8;
const MAX_INTEGER_WIDTH = 16;
const BYTE_RADIX = 256;
const BITS_PER_BYTE = 8;
const NIBBLE = 4;
const NIBBLE_MASK = 15;
const INLINE_LENGTH_LIMIT = 15;
const UTF16_UNIT = 2;
const Trailer = { OffsetSize: 6, ReferenceSize: 7, Count: 8, Root: 16, Table: 24 } as const;
const Kind = {
  Scalar: 0,
  Integer: 1,
  Real: 2,
  Date: 3,
  Data: 4,
  Ascii: 5,
  Utf16: 6,
  Utf8: 7,
  Uid: 8,
  Array: 10,
  Set: 12,
  Dictionary: 13,
} as const;
const Scalar = { Null: 0, False: 8, True: 9 } as const;
const Real = { Float32: 2, Float64: 3 } as const;
const DATE_FLOAT64 = 3;
const APPLE_EPOCH_MS = 978_307_200_000;
const BYTE_SHIFT = BigInt(BITS_PER_BYTE);
const ZERO = BigInt(0);
const DICTIONARY_REFERENCES = 2;
const MILLISECONDS_PER_SECOND = 1000;

class BinaryPlist {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #trailer: number;
  readonly #offsetSize: number;
  readonly #referenceSize: number;
  readonly #count: number;
  readonly #table: number;
  readonly #decoded = new Map<number, PlistValue>();
  readonly #visiting = new Set<number>();
  readonly root: number;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#trailer = bytes.length - TRAILER_BYTES;
    if (this.#trailer < HEADER_BYTES) throw Error("Missing binary plist trailer");
    this.#offsetSize = bytes[this.#trailer + Trailer.OffsetSize] ?? 0;
    this.#referenceSize = bytes[this.#trailer + Trailer.ReferenceSize] ?? 0;
    this.#count = this.uint(this.#trailer + Trailer.Count, MAX_WIDTH);
    this.root = this.uint(this.#trailer + Trailer.Root, MAX_WIDTH);
    this.#table = this.uint(this.#trailer + Trailer.Table, MAX_WIDTH);
    if (
      !this.#offsetSize ||
      this.#offsetSize > MAX_WIDTH ||
      !this.#referenceSize ||
      this.#referenceSize > MAX_WIDTH ||
      this.#table < HEADER_BYTES ||
      this.#count > (this.#trailer - this.#table) / this.#offsetSize ||
      this.root >= this.#count
    )
      throw Error("Invalid binary plist object table");
  }

  uint(at: number, width: number, end = this.#bytes.length): number {
    if (width < 1 || width > MAX_WIDTH || at < 0 || at + width > end)
      throw Error("Invalid binary plist integer");
    let value = 0;
    for (let index = 0; index < width; index++)
      value = value * BYTE_RADIX + (this.#bytes[at + index] ?? 0);
    if (!Number.isSafeInteger(value)) throw Error("Binary plist offset exceeds integer precision");
    return value;
  }

  read(reference: number): PlistValue {
    if (this.#decoded.has(reference)) return this.#decoded.get(reference) ?? null;
    if (
      reference >= this.#count ||
      this.#visiting.has(reference) ||
      this.#visiting.size >= MAX_PLIST_DEPTH
    )
      throw Error("Invalid binary plist reference");
    this.#visiting.add(reference);
    const at = this.uint(
      this.#table + reference * this.#offsetSize,
      this.#offsetSize,
      this.#trailer,
    );
    if (at < HEADER_BYTES || at >= this.#table) throw Error("Invalid binary plist object offset");
    const value = this.#object(at);
    this.#visiting.delete(reference);
    this.#decoded.set(reference, value);
    return value;
  }

  #object(offset: number): PlistValue {
    const cursor = new Cursor(this, this.#bytes, offset, this.#table);
    const marker = cursor.byte();
    const kind = marker >>> NIBBLE,
      argument = marker & NIBBLE_MASK;
    switch (kind) {
      case Kind.Scalar:
        return scalar(argument);
      case Kind.Integer:
        return this.#integer(cursor, argument);
      case Kind.Real:
        return this.#real(cursor, argument);
      case Kind.Date:
        if (argument !== DATE_FLOAT64) throw Error("Unsupported binary plist date");
        return new Date(
          APPLE_EPOCH_MS + MILLISECONDS_PER_SECOND * this.#view.getFloat64(cursor.take(MAX_WIDTH)),
        );
      case Kind.Data:
      case Kind.Ascii:
      case Kind.Utf16:
      case Kind.Utf8:
        return this.#text(cursor, kind, argument);
      case Kind.Uid:
        return new ArchiveReference(
          this.uint(cursor.take(argument + 1), argument + 1, this.#table),
        );
      case Kind.Array:
      case Kind.Set:
      case Kind.Dictionary:
        return this.#collection(cursor, kind, argument);
      default:
        throw Error(`Unsupported binary plist object type ${kind}`);
    }
  }

  #integer(cursor: Cursor, argument: number): number | bigint {
    const width = 1 << argument;
    if (width > MAX_INTEGER_WIDTH) throw Error("Unsupported binary plist integer width");
    const start = cursor.take(width);
    const raw = this.#bytes
      .subarray(start, start + width)
      .reduce((value, byte) => (value << BYTE_SHIFT) + BigInt(byte), ZERO);
    return plistInteger(width >= MAX_WIDTH ? BigInt.asIntN(width * BITS_PER_BYTE, raw) : raw);
  }

  #real(cursor: Cursor, argument: number): number {
    if (argument === Real.Float32) return this.#view.getFloat32(cursor.take(NIBBLE));
    if (argument === Real.Float64) return this.#view.getFloat64(cursor.take(MAX_WIDTH));
    throw Error("Unsupported binary plist real width");
  }

  #text(cursor: Cursor, kind: number, argument: number): Uint8Array | string {
    const length = cursor.size(argument);
    const bytes = kind === Kind.Utf16 ? length * UTF16_UNIT : length;
    const start = cursor.take(bytes);
    const payload = this.#bytes.subarray(start, start + bytes);
    if (kind === Kind.Data) return payload;
    return (kind === Kind.Utf16 ? utf16be : utf8).decode(payload);
  }

  #collection(cursor: Cursor, kind: number, argument: number): PlistValue {
    const length = cursor.size(argument);
    const references = kind === Kind.Dictionary ? length * DICTIONARY_REFERENCES : length;
    const start = cursor.take(references * this.#referenceSize);
    const element = (index: number) =>
      this.read(this.uint(start + index * this.#referenceSize, this.#referenceSize, this.#table));
    if (kind !== Kind.Dictionary) return Array.from({ length }, (_, index) => element(index));
    return plistDictionary(
      Array.from({ length }, (_, index) => [element(index), element(length + index)] as const),
    );
  }
}

class Cursor {
  constructor(
    readonly plist: BinaryPlist,
    readonly bytes: Uint8Array,
    public at: number,
    readonly end: number,
  ) {}

  byte(): number {
    return this.bytes[this.at++] ?? 0;
  }

  size(argument: number): number {
    if (argument < INLINE_LENGTH_LIMIT) return argument;
    if (this.at >= this.end || (this.bytes[this.at] ?? 0) >>> NIBBLE !== Kind.Integer)
      throw Error("Missing binary plist length");
    const width = 1 << (this.byte() & NIBBLE_MASK);
    const value = this.plist.uint(this.at, width, this.end);
    this.at += width;
    return value;
  }

  take(count: number): number {
    if (!Number.isSafeInteger(count) || count > this.end - this.at)
      throw Error("Truncated binary plist object");
    const start = this.at;
    this.at += count;
    return start;
  }
}

function scalar(argument: number): PlistValue {
  if (argument === Scalar.Null) return null;
  if (argument === Scalar.False) return false;
  if (argument === Scalar.True) return true;
  throw Error("Unsupported binary plist scalar");
}

export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  const plist = new BinaryPlist(bytes);
  return plist.read(plist.root);
}
