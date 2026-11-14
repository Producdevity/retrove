import { Argument, type FoundationHost, type GuestArguments, type HostResult } from "../objc/host";
const CLASS = "CFBitVector";
const BITS_PER_BYTE = 8;
const HIGH_BIT = BITS_PER_BYTE - 1;
const CF_INDEX_MAXIMUM = 0x7fffffff;
interface Vector {
  readonly bytes: Uint8Array;
  readonly count: number;
  readonly mutable: boolean;
}
interface BitVectorHost extends FoundationHost {
  readBytes(address: number, count: number): Uint8Array;
}
export function bitVectorFunctions(
  host: BitVectorHost,
): Record<string, (args: GuestArguments) => HostResult> {
  const klass = host.hostClass(CLASS, "NSObject"),
    vectors = new Map<number, Vector>();
  const get = (pointer: number): Vector => {
    const value = vectors.get(pointer);
    if (!value) throw new Error("Invalid CFBitVector.");
    return value;
  };
  const count = (value: number): number => {
    if (!Number.isInteger(value) || value < 0 || value > CF_INDEX_MAXIMUM)
      throw new RangeError("Invalid CFBitVector size.");
    return value;
  };
  const create = (allocator: number, value: Vector): number => {
    if (allocator) throw new Error("Custom CFBitVector allocator is unsupported.");
    const pointer = host.alloc(klass);
    vectors.set(pointer, value);
    return pointer;
  };
  const indexed = (pointer: number, index: number): Vector => {
    const value = get(pointer);
    if (!Number.isInteger(index) || index < 0 || index >= value.count)
      throw new RangeError("CFBitVector index is out of bounds.");
    return value;
  };
  const copy = (allocator: number, pointer: number, mutable: boolean): number => {
    const value = get(pointer);
    return create(allocator, { bytes: value.bytes.slice(), count: value.count, mutable });
  };
  host.method(CLASS, false, "dealloc", (self) => {
    vectors.delete(self);
    host.destroy(self);
  });
  return {
    _CFBitVectorCreate: (args) => {
      const size = count(args(Argument.Third)),
        length = Math.ceil(size / BITS_PER_BYTE);
      if (!args(1) && length) throw new Error("Missing CFBitVector bytes.");
      return create(args(0), {
        bytes: length ? host.readBytes(args(1), length).slice() : new Uint8Array(),
        count: size,
        mutable: false,
      });
    },
    _CFBitVectorCreateCopy: (args) => copy(args(0), args(1), false),
    _CFBitVectorCreateMutableCopy: (args) => {
      count(args(1));
      return copy(args(0), args(Argument.Third), true);
    },
    _CFBitVectorGetCount: (args) => get(args(0)).count,
    _CFBitVectorGetBitAtIndex: (args) => {
      const value = indexed(args(0), args(1)),
        byte = value.bytes[Math.floor(args(1) / BITS_PER_BYTE)];
      return ((byte ?? 0) >>> (HIGH_BIT - (args(1) % BITS_PER_BYTE))) & 1;
    },
    _CFBitVectorSetBitAtIndex: (args) => {
      const value = indexed(args(0), args(1));
      if (!value.mutable) throw new Error("Cannot mutate an immutable CFBitVector.");
      const index = Math.floor(args(1) / BITS_PER_BYTE),
        mask = 1 << (HIGH_BIT - (args(1) % BITS_PER_BYTE)),
        old = value.bytes[index] ?? 0;
      value.bytes[index] = args(Argument.Third) ? old | mask : old & ~mask;
    },
  };
}
