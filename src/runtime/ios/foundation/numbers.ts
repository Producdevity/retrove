import { floatBits, floatFromBits, WORD_BYTES } from "../abi/scalars";
import type { FoundationHost, GuestArguments } from "../objc/host";
const NUMBER_CLASS = "NSNumber";
const Bits = { Char: 8, Short: 16, Word: 32, LongLong: 64 } as const;
const Types = [
  ["Bool", "bool", Bits.Char],
  ["Char", "signed", Bits.Char],
  ["UnsignedChar", "unsigned", Bits.Char],
  ["Short", "signed", Bits.Short],
  ["UnsignedShort", "unsigned", Bits.Short],
  ["Int", "signed", Bits.Word],
  ["UnsignedInt", "unsigned", Bits.Word],
  ["Long", "signed", Bits.Word],
  ["UnsignedLong", "unsigned", Bits.Word],
  ["Integer", "signed", Bits.Word],
  ["UnsignedInteger", "unsigned", Bits.Word],
  ["LongLong", "signed", Bits.LongLong],
  ["UnsignedLongLong", "unsigned", Bits.LongLong],
  ["Float", "float", Bits.Word],
  ["Double", "double", Bits.LongLong],
] as const;
type NumberType = (typeof Types)[number];
export type NumericValue = boolean | number | bigint;
interface NumberHost extends Pick<FoundationHost, "method" | "alloc" | "autorelease"> {
  get(pointer: number): NumericValue;
  set(pointer: number, value: NumericValue): void;
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
export function installNumbers(host: NumberHost): void {
  for (const type of Types) {
    const [suffix] = type;
    host.method(NUMBER_CLASS, true, `numberWith${suffix}:`, (cls, args) => {
      const pointer = host.alloc(cls);
      host.set(pointer, decode(type, args));
      return host.autorelease(pointer);
    });
    host.method(NUMBER_CLASS, false, `initWith${suffix}:`, (self, args) => {
      host.set(self, decode(type, args));
      return self;
    });
    const getter = suffix.charAt(0).toLowerCase() + suffix.slice(1) + "Value";
    host.method(NUMBER_CLASS, false, getter, (self) => encode(type, host.get(self)));
  }
}
