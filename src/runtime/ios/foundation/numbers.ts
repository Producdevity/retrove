import { floatBits, floatFromBits, WORD_BYTES } from "../abi/scalars";
import type { FoundationHost, GuestArguments } from "../objc/host";
const NUMBER_CLASS = "NSNumber";
const Bits = { Char: 8, Short: 16, Word: 32, LongLong: 64 } as const;
const Types = [
  ["Bool", "bool", Bits.Char, "c"],
  ["Char", "signed", Bits.Char, "c"],
  ["UnsignedChar", "unsigned", Bits.Char, "s"],
  ["Short", "signed", Bits.Short, "s"],
  ["UnsignedShort", "unsigned", Bits.Short, "i"],
  ["Int", "signed", Bits.Word, "i"],
  ["UnsignedInt", "unsigned", Bits.Word, "q"],
  ["Long", "signed", Bits.Word, "i"],
  ["UnsignedLong", "unsigned", Bits.Word, "q"],
  ["Integer", "signed", Bits.Word, "i"],
  ["UnsignedInteger", "unsigned", Bits.Word, "q"],
  ["LongLong", "signed", Bits.LongLong, "q"],
  ["UnsignedLongLong", "unsigned", Bits.LongLong, "q"],
  ["Float", "float", Bits.Word, "f"],
  ["Double", "double", Bits.LongLong, "d"],
] as const;
type NumberType = (typeof Types)[number];
export type NumericValue = boolean | number | bigint;
interface NumberHost extends Pick<FoundationHost, "method" | "alloc" | "autorelease"> {
  get(pointer: number): NumericValue;
  set(pointer: number, value: NumericValue): void;
  cString(value: string): number;
  writeBytes(pointer: number, bytes: Uint8Array): void;
}
function integer(value: NumericValue): bigint {
  if (typeof value === "bigint") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? BigInt(Math.trunc(numeric)) : BigInt(0);
}
function narrowed(value: bigint, type: NumberType): number | bigint {
  const [, kind, bits] = type,
    result = kind === "unsigned" ? BigInt.asUintN(bits, value) : BigInt.asIntN(bits, value);
  return bits === Bits.LongLong ? result : Number(result);
}
function decode(type: NumberType, args: GuestArguments): NumericValue {
  const [, kind, bits] = type;
  if (kind === "bool") return args(0) !== 0;
  if (kind === "float") return floatFromBits(args(0));
  if (kind === "double") {
    const scratch = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
    scratch.setUint32(0, args(0), true);
    scratch.setUint32(WORD_BYTES, args(1), true);
    return scratch.getFloat64(0, true);
  }
  const value =
    BigInt(args(0) >>> 0) |
    (bits === Bits.LongLong ? BigInt(args(1) >>> 0) << BigInt(Bits.Word) : BigInt(0));
  return narrowed(value, type);
}
function encode(type: NumberType, value: NumericValue): number | bigint {
  const [, kind] = type;
  if (kind === "bool") return Number(Boolean(value));
  if (kind === "float") return floatBits(Number(value));
  if (kind === "double") {
    const scratch = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
    scratch.setFloat64(0, Number(value), true);
    return scratch.getBigUint64(0, true);
  }
  return narrowed(integer(value), type);
}
const SIGNED_WORD_MINIMUM = -2147483648;
const SIGNED_WORD_MAXIMUM = 2147483647;
const SIGNED_LONG_LONG_MAXIMUM = 0x7fffffffffffffffn;
function inferredEncoding(value: NumericValue): string {
  if (typeof value === "boolean") return "c";
  if (typeof value === "bigint") return value > SIGNED_LONG_LONG_MAXIMUM ? "Q" : "q";
  if (Number.isSafeInteger(value))
    return value >= SIGNED_WORD_MINIMUM && value <= SIGNED_WORD_MAXIMUM ? "i" : "q";
  return "d";
}
function encoding(type: NumberType, value: NumericValue): string {
  if (type[1] === "float" && !Number.isFinite(value)) return "d";
  if (type[0] === "UnsignedLongLong" && integer(value) > SIGNED_LONG_LONG_MAXIMUM) return "Q";
  const [, , , stored] = type;
  return stored;
}
function boxedBytes(value: NumericValue, type: string): Uint8Array {
  const sizes: Readonly<Record<string, number>> = {
    c: Int8Array.BYTES_PER_ELEMENT,
    s: Int16Array.BYTES_PER_ELEMENT,
    i: Int32Array.BYTES_PER_ELEMENT,
    q: BigInt64Array.BYTES_PER_ELEMENT,
    Q: BigUint64Array.BYTES_PER_ELEMENT,
    f: Float32Array.BYTES_PER_ELEMENT,
    d: Float64Array.BYTES_PER_ELEMENT,
  };
  const size = sizes[type];
  if (!size) throw new Error("Unsupported NSNumber storage type.");
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  switch (type) {
    case "c":
      view.setInt8(0, Number(value));
      break;
    case "s":
      view.setInt16(0, Number(value), true);
      break;
    case "i":
      view.setInt32(0, Number(value), true);
      break;
    case "q":
      view.setBigInt64(0, integer(value), true);
      break;
    case "Q":
      view.setBigUint64(0, integer(value), true);
      break;
    case "f":
      view.setFloat32(0, Number(value), true);
      break;
    case "d":
      view.setFloat64(0, Number(value), true);
      break;
  }
  return bytes;
}
export function installNumbers(host: NumberHost): (pointer: number) => void {
  const types = new Map<number, string>(),
    encodings = new Map<string, number>();
  const storage = (self: number): string => types.get(self) ?? inferredEncoding(host.get(self));
  const initialize = (self: number, type: NumberType, args: GuestArguments): void => {
    const value = decode(type, args);
    host.set(self, value);
    types.set(self, encoding(type, value));
  };
  host.method(NUMBER_CLASS, false, "objCType", (self) => {
    const type = storage(self);
    let pointer = encodings.get(type);
    if (pointer === undefined) {
      pointer = host.cString(type);
      encodings.set(type, pointer);
    }
    return pointer;
  });
  host.method(NUMBER_CLASS, false, "getValue:", (self, args) => {
    host.writeBytes(args(0), boxedBytes(host.get(self), storage(self)));
  });
  for (const type of Types) {
    const [suffix] = type;
    host.method(NUMBER_CLASS, true, `numberWith${suffix}:`, (cls, args) => {
      const pointer = host.alloc(cls);
      initialize(pointer, type, args);
      return host.autorelease(pointer);
    });
    host.method(NUMBER_CLASS, false, `initWith${suffix}:`, (self, args) => {
      initialize(self, type, args);
      return self;
    });
    const getter = suffix.charAt(0).toLowerCase() + suffix.slice(1) + "Value";
    host.method(NUMBER_CLASS, false, getter, (self) => encode(type, host.get(self)));
  }
  return (pointer) => {
    types.delete(pointer);
  };
}
