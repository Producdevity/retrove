import { ArchiveReference } from "./graph";

const Marker = {
  Null: 0x00,
  False: 0x08,
  True: 0x09,
  Integer: 0x10,
  Real: 0x23,
  Date: 0x33,
  Data: 0x40,
  String: 0x60,
  Reference: 0x80,
  Array: 0xa0,
  Dictionary: 0xd0,
} as const;
const INLINE_LENGTH = 15;
const TRAILER_BYTES = 32;
const OFFSET_SIZE_FIELD = 6;
const REFERENCE_SIZE_FIELD = 7;
const COUNT_FIELD = 8;
const ROOT_FIELD = 16;
const TABLE_FIELD = 24;
const MAX_OBJECTS = 1_048_576;
const MAX_BYTES = 268_435_456;
const MAX_DEPTH = 128;
const BITS_PER_BYTE = 8;
const WORD_BYTES = 8;
const UTF16_BYTES = 2;
const BYTE_MASK = 0xffn;
const SIGNED_LIMIT = 0x8000000000000000n;
const UNSIGNED_LIMIT = 0x10000000000000000n;
const WIDE_INTEGER_BYTES = 16;
const INTEGER_RADIX = 2;
const INTEGER_WIDTHS = { Byte: 1, Half: 2, Word: 4, Double: 8 } as const;
const REFERENCE_EPOCH_MS = 978_307_200_000;
const MILLISECONDS_PER_SECOND = 1000;

function width(value: number) {
  for (const bytes of Object.values(INTEGER_WIDTHS))
    if (value < INTEGER_RADIX ** (bytes * BITS_PER_BYTE)) return bytes;
  throw Error("Binary plist integer exceeds offset range");
}
function unsigned(value: bigint, bytes: number) {
  const result = new Uint8Array(bytes);
  for (let index = bytes - 1; index >= 0; index--) {
    result[index] = Number(value & BYTE_MASK);
    value >>= BigInt(BITS_PER_BYTE);
  }
  return result;
}
function join(chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (size > MAX_BYTES) throw Error("Keyed archive exceeds size limit");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function prefix(marker: number, length: number) {
  if (length < INLINE_LENGTH) return Uint8Array.of(marker | length);
  const bytes = width(length);
  return join([
    Uint8Array.of(marker | INLINE_LENGTH, Marker.Integer | Math.log2(bytes)),
    unsigned(BigInt(length), bytes),
  ]);
}
function real(marker: number, value: number) {
  const bytes = new Uint8Array(1 + Float64Array.BYTES_PER_ELEMENT);
  bytes[0] = marker;
  new DataView(bytes.buffer).setFloat64(1, value);
  return bytes;
}
function integer(value: bigint) {
  if (value < -SIGNED_LIMIT || value >= UNSIGNED_LIMIT)
    throw Error("Binary plist integer out of range");
  const bytes =
    value < 0 ? WORD_BYTES : value >= SIGNED_LIMIT ? WIDE_INTEGER_BYTES : width(Number(value));
  return join([
    Uint8Array.of(Marker.Integer | Math.log2(bytes)),
    unsigned(BigInt.asUintN(bytes * BITS_PER_BYTE, value), bytes),
  ]);
}
function scalar(value: unknown): Uint8Array | undefined {
  if (value === null) return Uint8Array.of(Marker.Null);
  if (typeof value === "boolean") return Uint8Array.of(value ? Marker.True : Marker.False);
  if (typeof value === "bigint") return integer(value);
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? integer(BigInt(value)) : real(Marker.Real, value);
  if (value instanceof ArchiveReference) {
    const bytes = width(value.index);
    return join([
      Uint8Array.of(Marker.Reference | (bytes - 1)),
      unsigned(BigInt(value.index), bytes),
    ]);
  }
  if (value instanceof Uint8Array) return join([prefix(Marker.Data, value.length), value]);
  if (value instanceof Date)
    return real(Marker.Date, (value.getTime() - REFERENCE_EPOCH_MS) / MILLISECONDS_PER_SECOND);
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length * UTF16_BYTES),
      view = new DataView(bytes.buffer);
    for (let index = 0; index < value.length; index++)
      view.setUint16(index * UTF16_BYTES, value.charCodeAt(index));
    return join([prefix(Marker.String, value.length), bytes]);
  }
  return undefined;
}
interface PlistObject {
  marker: number;
  length: number;
  references: number[];
}
export function encodeBinaryPlist(value: unknown): Uint8Array {
  const objects: (Uint8Array | PlistObject)[] = [];
  const active = new Set<object>();
  function add(value: unknown, depth: number): number {
    if (depth > MAX_DEPTH || objects.length >= MAX_OBJECTS)
      throw Error("Binary plist object limit exceeded");
    const index = objects.length,
      bytes = scalar(value);
    if (bytes) {
      objects.push(bytes);
      return index;
    }
    if (!value || typeof value !== "object" || active.has(value))
      throw Error("Invalid binary plist object");
    active.add(value);
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== null &&
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw Error("Invalid binary plist dictionary");
    const entries = array ? [] : Object.entries(value);
    const object: PlistObject = {
      marker: array ? Marker.Array : Marker.Dictionary,
      length: array ? value.length : entries.length,
      references: [],
    };
    objects.push(object);
    if (array) object.references = Array.from(value, (item: unknown) => add(item, depth + 1));
    else
      object.references = [
        ...entries.map(([key]) => add(key, depth + 1)),
        ...entries.map(([, item]) => add(item, depth + 1)),
      ];
    active.delete(value);
    return index;
  }
  const root = add(value, 0),
    referenceSize = width(objects.length - 1);
  const chunks: Uint8Array[] = [new TextEncoder().encode("bplist00")],
    offsets: number[] = [];
  let offset = chunks[0]?.length ?? 0;
  for (const object of objects) {
    const bytes =
      object instanceof Uint8Array
        ? object
        : join([
            prefix(object.marker, object.length),
            ...object.references.map((ref) => unsigned(BigInt(ref), referenceSize)),
          ]);
    offsets.push(offset);
    chunks.push(bytes);
    offset += bytes.length;
    if (offset > MAX_BYTES) throw Error("Keyed archive exceeds size limit");
  }
  const offsetSize = width(offset),
    table = offset;
  for (const offset of offsets) chunks.push(unsigned(BigInt(offset), offsetSize));
  const trailer = new Uint8Array(TRAILER_BYTES),
    view = new DataView(trailer.buffer);
  trailer[OFFSET_SIZE_FIELD] = offsetSize;
  trailer[REFERENCE_SIZE_FIELD] = referenceSize;
  view.setBigUint64(COUNT_FIELD, BigInt(objects.length));
  view.setBigUint64(ROOT_FIELD, BigInt(root));
  view.setBigUint64(TABLE_FIELD, BigInt(table));
  return join([...chunks, trailer]);
}
