import type { FoundationHost, GuestArguments } from "../../objc/host";
import type { NumericValue } from "../numbers";
import { decimal, decimalInteger, decimalText, parseDecimal } from "./value";
import type { DecimalValue } from "./value";
const DECIMAL_CLASS = "NSDecimalNumber";
const Word = { Bits: 32, LongLong: 64, Short: 16 } as const;
const MantissaArgument = { Exponent: 2, Negative: 3 } as const;
interface DecimalHost extends FoundationHost {
  set(pointer: number, value: NumericValue): void;
  cString(value: string): number;
  writeBytes(pointer: number, bytes: Uint8Array): void;
}
function mantissa(args: GuestArguments): DecimalValue | undefined {
  const value = BigInt(args(0) >>> 0) | (BigInt(args(1) >>> 0) << BigInt(Word.Bits));
  const exponent = Number(BigInt.asIntN(Word.Short, BigInt(args(MantissaArgument.Exponent))));
  return decimal(args(MantissaArgument.Negative) ? -value : value, exponent);
}
export function installDecimalNumbers(host: DecimalHost): {
  text(pointer: number): string | undefined;
  forget(pointer: number): void;
} {
  host.hostClass(DECIMAL_CLASS, "NSNumber");
  const values = new Map<number, DecimalValue | undefined>();
  const initialize = (pointer: number, value: DecimalValue | undefined): number => {
    values.set(pointer, value);
    host.set(pointer, Number(decimalText(value)));
    return pointer;
  };
  for (const factory of [true, false]) {
    for (const localized of [true, false]) {
      const selector =
        (factory ? "decimalNumber" : "init") + "WithString:" + (localized ? "locale:" : "");
      host.method(DECIMAL_CLASS, factory, selector, (receiver, args) => {
        if (localized && args(1))
          throw new Error("NSDecimalNumber localized parsing is not implemented.");
        const value = args(0) ? parseDecimal(host.text(args(0))) : undefined;
        const pointer = initialize(factory ? host.alloc(receiver) : receiver, value);
        return factory ? host.autorelease(pointer) : pointer;
      });
    }
    host.method(
      DECIMAL_CLASS,
      factory,
      (factory ? "decimalNumber" : "init") + "WithMantissa:exponent:isNegative:",
      (receiver, args) => {
        const pointer = initialize(factory ? host.alloc(receiver) : receiver, mantissa(args));
        return factory ? host.autorelease(pointer) : pointer;
      },
    );
  }
  for (const [selector, value] of [
    ["zero", decimal(BigInt(0), 0)],
    ["one", decimal(BigInt(1), 0)],
    ["notANumber", undefined],
  ] as const)
    host.method(DECIMAL_CLASS, true, selector, (cls) =>
      host.autorelease(initialize(host.alloc(cls), value)),
    );
  for (const selector of ["stringValue", "description"])
    host.method(DECIMAL_CLASS, false, selector, (self) =>
      host.string(decimalText(values.get(self))),
    );
  let encoding: number | undefined;
  host.method(DECIMAL_CLASS, false, "objCType", () => (encoding ??= host.cString("d")));
  host.method(DECIMAL_CLASS, false, "getValue:", (self, args) => {
    const bytes = new Uint8Array(Float64Array.BYTES_PER_ELEMENT);
    new DataView(bytes.buffer).setFloat64(0, Number(decimalText(values.get(self))), true);
    host.writeBytes(args(0), bytes);
  });
  for (const [selector, bits, unsigned] of [
    ["intValue", Word.Bits, false],
    ["integerValue", Word.Bits, false],
    ["longValue", Word.Bits, false],
    ["unsignedIntValue", Word.Bits, true],
    ["unsignedIntegerValue", Word.Bits, true],
    ["unsignedLongValue", Word.Bits, true],
    ["longLongValue", Word.LongLong, false],
    ["unsignedLongLongValue", Word.LongLong, true],
  ] as const)
    host.method(DECIMAL_CLASS, false, selector, (self) => {
      const value = decimalInteger(values.get(self));
      const narrowed = unsigned ? BigInt.asUintN(bits, value) : BigInt.asIntN(bits, value);
      return bits === Word.LongLong ? narrowed : Number(narrowed);
    });
  return {
    text: (pointer) => (values.has(pointer) ? decimalText(values.get(pointer)) : undefined),
    forget: (pointer) => {
      values.delete(pointer);
    },
  };
}
