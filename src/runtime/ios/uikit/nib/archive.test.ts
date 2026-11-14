import { expect, test } from "vite-plus/test";
import { ArchiveReference, archiveArray, archiveFields } from "../../foundation/archives/graph";
import { parseNib } from "./archive";
import { keyedNib, NibKey } from "./keyed-archive";
const text = new TextEncoder();
function join(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function varint(value: number): Uint8Array {
  const result: number[] = [];
  do {
    const byte = value & 127;
    value = Math.floor(value / 128);
    result.push(byte | (value ? 0 : 128));
  } while (value);
  return Uint8Array.from(result);
}
function word(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
function reference(key: number, object: number): Uint8Array {
  return join([varint(key), Uint8Array.of(10), word(object)]);
}
function data(key: number, value: Uint8Array): Uint8Array {
  return join([varint(key), Uint8Array.of(8), varint(value.length), value]);
}
function fixture(): Uint8Array {
  const objects = join(
    [
      [0, 0, 2],
      [1, 2, 2],
      [2, 4, 3],
      [3, 7, 1],
      [3, 8, 1],
    ].map((record) => join(record.map(varint))),
  );
  const keys = join(
    [
      NibKey.Objects,
      NibKey.TopLevel,
      "NSInlinedValue",
      "UINibEncoderEmptyKey",
      "UIClassName",
      "UIOriginalClassName",
      "NS.bytes",
      "UIBounds",
    ].map((key) => {
      const bytes = text.encode(key);
      return join([varint(bytes.length), bytes]);
    }),
  );
  const values = join([
    reference(0, 1),
    reference(1, 1),
    join([varint(2), Uint8Array.of(5)]),
    reference(3, 2),
    reference(4, 3),
    reference(5, 4),
    data(7, Uint8Array.of(6, 0, 0, 0, 0)),
    data(6, text.encode("ExampleDelegate")),
    data(6, text.encode("UICustomObject")),
  ]);
  const classes = join(
    ["NSObject", "NSArray", "UIClassSwapper", "NSString"].map((name) => {
      const bytes = text.encode(name + "\0");
      return join([varint(bytes.length), varint(0), bytes]);
    }),
  );
  const header = new Uint8Array(50),
    view = new DataView(header.buffer);
  header.set(text.encode("NIBArchive"));
  [
    1,
    9,
    5,
    50,
    8,
    50 + objects.length,
    9,
    50 + objects.length + keys.length,
    4,
    50 + objects.length + keys.length + values.length,
  ].forEach((value, index) => view.setUint32(10 + index * 4, value, true));
  return join([header, objects, keys, values, classes]);
}
test("nib parsing preserves class substitutions, inline byte fields and object references", () => {
  const nib = parseNib(fixture());
  expect(nib.objects).toHaveLength(5);
  expect(nib.objects[2]?.className).toBe("UIClassSwapper");
  const keyed = keyedNib(nib),
    objects = archiveArray(keyed.$objects),
    delegate = archiveFields(objects[3]);
  expect(delegate[NibKey.CustomObject]).toBe(true);
  const type = delegate.$class;
  if (!(type instanceof ArchiveReference)) throw new Error("Missing class reference");
  expect(archiveFields(objects[type.index]).$classname).toBe("ExampleDelegate");
  const bounds = delegate.UIBounds;
  if (!(bounds instanceof ArchiveReference))
    throw new Error("Inline bytes must be object references");
  expect(objects[bounds.index]).toEqual(Uint8Array.of(6, 0, 0, 0, 0));
  const array = archiveFields(objects[2]);
  expect(array["NS.objects"]).toEqual([new ArchiveReference(3)]);
  expect(archiveFields(keyed.$top)[NibKey.Objects]).toEqual(new ArchiveReference(2));
});
test("malformed nib versions, truncated tables and invalid references are rejected", () => {
  const bytes = fixture();
  expect(() => parseNib(bytes.subarray(0, bytes.length - 1))).toThrow();
  const version = bytes.slice();
  new DataView(version.buffer).setUint32(14, 99, true);
  expect(() => parseNib(version)).toThrow("version");
  const counts = bytes.slice();
  new DataView(counts.buffer).setUint32(18, 0xffffffff, true);
  expect(() => parseNib(counts)).toThrow("table");
  const reference = bytes.slice(),
    view = new DataView(reference.buffer),
    values = view.getUint32(38, true);
  view.setUint32(values + 2, 999, true);
  expect(() => parseNib(reference)).toThrow("reference");
});
