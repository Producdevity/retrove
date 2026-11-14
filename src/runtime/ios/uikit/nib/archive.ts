import { ArchiveReference } from "../../foundation/archives/graph";
import { NibReader, NibNumberBytes } from "./reader";
const HEADER_BYTES = 50;
const Signature = { Length: 10, Version: 10, CoderVersion: 14, SupportedCoder: 9 } as const;
const TableIndex = { Keys: 1, Values: 2, Classes: 3 } as const;
const MAX_ITEMS = 1_048_576;
const MAX_BYTES = 33_554_432;
const WORD_BYTES = 4;
const Header = { Objects: 18, Keys: 26, Values: 34, Classes: 42 } as const;
const ValueType = {
  Int8: 0,
  Int16: 1,
  Int32: 2,
  Int64: 3,
  True: 4,
  False: 5,
  Float: 6,
  Double: 7,
  Data: 8,
  Nil: 9,
  Reference: 10,
} as const;
const TEXT = new TextDecoder("utf-8", { fatal: true });
export interface NibObject {
  readonly className: string;
  readonly values: ReadonlyArray<readonly [string, unknown]>;
}
export interface NibArchive {
  readonly objects: readonly NibObject[];
}
function checkedIndex<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error("Invalid nib table index.");
  return value;
}
function scalar(reader: NibReader): unknown {
  const type = reader.byte();
  switch (type) {
    case ValueType.Int8:
      return reader.number(1, true);
    case ValueType.Int16:
      return reader.number(NibNumberBytes.Half, true);
    case ValueType.Int32:
      return reader.number(NibNumberBytes.Word, true);
    case ValueType.Int64:
      return reader.number(NibNumberBytes.Double, true);
    case ValueType.True:
      return true;
    case ValueType.False:
      return false;
    case ValueType.Float:
      return reader.number(NibNumberBytes.Word, false, true);
    case ValueType.Double:
      return reader.number(NibNumberBytes.Double, false, true);
    case ValueType.Data:
      return reader.take(reader.varint()).slice();
    case ValueType.Nil:
      return null;
    case ValueType.Reference:
      return new ArchiveReference(Number(reader.number(WORD_BYTES)));
    default:
      throw new Error("Unsupported nib value type: " + type);
  }
}
export function parseNib(bytes: Uint8Array): NibArchive {
  if (
    bytes.length < HEADER_BYTES ||
    bytes.length > MAX_BYTES ||
    TEXT.decode(bytes.subarray(0, Signature.Length)) !== "NIBArchive"
  )
    throw new Error("Invalid nib archive header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(Signature.Version, true) !== 1 ||
    view.getUint32(Signature.CoderVersion, true) !== Signature.SupportedCoder
  )
    throw new Error("Unsupported nib archive version.");
  const offsets = Object.values(Header).map((field) => view.getUint32(field + WORD_BYTES, true));
  const section = (field: number, next: number) => {
    const count = view.getUint32(field, true),
      offset = view.getUint32(field + WORD_BYTES, true);
    if (count > MAX_ITEMS || offset < HEADER_BYTES) throw new Error("Invalid nib table.");
    return { count, reader: new NibReader(bytes, offset, next) };
  };
  const objectSection = section(Header.Objects, checkedIndex(offsets, TableIndex.Keys)),
    objects = [];
  for (let index = 0; index < objectSection.count; index++)
    objects.push({
      classIndex: objectSection.reader.varint(),
      first: objectSection.reader.varint(),
      count: objectSection.reader.varint(),
    });
  const keySection = section(Header.Keys, checkedIndex(offsets, TableIndex.Values)),
    keys = [];
  for (let index = 0; index < keySection.count; index++)
    keys.push(TEXT.decode(keySection.reader.take(keySection.reader.varint())));
  const valueSection = section(Header.Values, checkedIndex(offsets, TableIndex.Classes)),
    values: Array<readonly [string, unknown]> = [];
  for (let index = 0; index < valueSection.count; index++)
    values.push([checkedIndex(keys, valueSection.reader.varint()), scalar(valueSection.reader)]);
  const classSection = section(Header.Classes, bytes.length),
    classes: string[] = [];
  for (let index = 0; index < classSection.count; index++) {
    const length = classSection.reader.varint(),
      extra = classSection.reader.varint();
    classSection.reader.take(extra * WORD_BYTES);
    classes.push(TEXT.decode(classSection.reader.take(length)).replace(/\0$/, ""));
  }
  return {
    objects: objects.map((object) => {
      if (object.first + object.count > values.length)
        throw new Error("Invalid nib object value range.");
      const fields = values.slice(object.first, object.first + object.count);
      for (const [, value] of fields)
        if (value instanceof ArchiveReference && value.index >= objects.length)
          throw new Error("Invalid nib object reference.");
      return { className: checkedIndex(classes, object.classIndex), values: fields };
    }),
  };
}
