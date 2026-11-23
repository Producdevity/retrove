import { move, read32, write32, type GuestMemory } from "../../memory/guest-memory";
import type { GuestHeap } from "../libc/guest-imports";

export const BlockFlag = {
  OnHeap: 0x100_0000,
  Helpers: 0x200_0000,
  Global: 0x1000_0000,
  CountMask: 0xffff,
} as const;
export const BlockField = { Flags: 4, Invoke: 12, Descriptor: 16 } as const;
const Descriptor = { Size: 4, Copy: 8, Dispose: 12 } as const;
const Byref = { Forwarding: 4, Flags: 8, Size: 12, Copy: 16, Dispose: 20 } as const;
const MIN_BLOCK_BYTES = 20;
const MIN_BYREF_BYTES = 16;
const MIN_BYREF_HELPER_BYTES = 24;
const FieldFlag = { Object: 3, Block: 7, Byref: 8, Kind: 15, Weak: 16, Caller: 128 } as const;
const MALLOC_BLOCK_CLASS = "__NSConcreteMallocBlock";
const INITIAL_BYREF_COUNT = 2;

export type NestedCall = (target: number, args: number[]) => Promise<number | void>;
export interface BlockObjects {
  readonly blockClasses: ReadonlyMap<string, number>;
  readonly retainObject: (pointer: number) => number;
  readonly releaseObject: (pointer: number) => Promise<void> | void;
}

export class BlockRuntime {
  constructor(
    private readonly cpu: GuestMemory,
    private readonly heap: Pick<GuestHeap, "alloc" | "free">,
    private readonly nested: NestedCall,
    private readonly objects: BlockObjects,
  ) {}

  private read(address: number): number {
    return read32(this.cpu, address);
  }
  private write(address: number, value: number): void {
    write32(this.cpu, address, value);
  }

  private retainAt(address: number): void {
    const flags = this.read(address);
    if (flags & BlockFlag.OnHeap && (flags & BlockFlag.CountMask) !== BlockFlag.CountMask)
      this.write(address, flags + 1);
  }

  async copy(block: number): Promise<number> {
    if (!block) return 0;
    const flags = this.read(block + BlockField.Flags);
    if (flags & BlockFlag.Global) return block;
    if (flags & BlockFlag.OnHeap) {
      this.retainAt(block + BlockField.Flags);
      return block;
    }
    const descriptor = this.read(block + BlockField.Descriptor),
      size = this.read(descriptor + Descriptor.Size);
    if (size < MIN_BLOCK_BYTES) throw new Error("Invalid guest block size");
    const destination = this.heap.alloc(size);
    if (!destination) throw new Error("Guest block allocation failed");
    move(this.cpu, destination, block, size);
    this.write(destination, this.objects.blockClasses.get(MALLOC_BLOCK_CLASS) ?? 0);
    this.write(
      destination + BlockField.Flags,
      (flags & ~BlockFlag.CountMask) | BlockFlag.OnHeap | 1,
    );
    try {
      if (flags & BlockFlag.Helpers)
        await this.nested(this.read(descriptor + Descriptor.Copy), [destination, block]);
    } catch (error) {
      this.heap.free(destination);
      throw error;
    }
    return destination;
  }

  async copyByref(original: number): Promise<number> {
    const source = this.read(original + Byref.Forwarding),
      flags = this.read(source + Byref.Flags);
    if (flags & BlockFlag.OnHeap) {
      this.retainAt(source + Byref.Flags);
      return source;
    }
    const size = this.read(source + Byref.Size);
    if (size < (flags & BlockFlag.Helpers ? MIN_BYREF_HELPER_BYTES : MIN_BYREF_BYTES))
      throw new Error("Invalid byref block capture size");
    const destination = this.heap.alloc(size);
    if (!destination) throw new Error("Guest block capture allocation failed");
    move(this.cpu, destination, source, size);
    this.write(destination + Byref.Forwarding, destination);
    this.write(source + Byref.Forwarding, destination);
    this.write(
      destination + Byref.Flags,
      (flags & ~BlockFlag.CountMask) | BlockFlag.OnHeap | INITIAL_BYREF_COUNT,
    );
    if (flags & BlockFlag.Helpers)
      await this.nested(this.read(source + Byref.Copy), [destination, source]);
    return destination;
  }

  async release(block: number, byref = false): Promise<void> {
    if (!block) return;
    const destination = byref ? this.read(block + Byref.Forwarding) : block,
      at = destination + (byref ? Byref.Flags : BlockField.Flags),
      flags = this.read(at);
    const count = flags & BlockFlag.CountMask;
    if (!(flags & BlockFlag.OnHeap) || count === BlockFlag.CountMask) return;
    if (!count) throw new Error("Guest block released too many times");
    this.write(at, flags - 1);
    if (count !== 1) return;
    try {
      if (flags & BlockFlag.Helpers)
        await this.nested(
          byref
            ? this.read(destination + Byref.Dispose)
            : this.read(this.read(destination + BlockField.Descriptor) + Descriptor.Dispose),
          [destination],
        );
    } finally {
      this.heap.free(destination);
    }
  }

  /** Handles one captured variable for `_Block_object_assign` and `_Block_object_dispose`. */
  async field(value: number, flags: number, dispose: boolean): Promise<number | void> {
    // The caller retains byref members; weak captures are unretained.
    if (flags & FieldFlag.Caller || flags & FieldFlag.Weak || !value) return value;
    switch (flags & FieldFlag.Kind) {
      case FieldFlag.Object:
        return dispose ? this.objects.releaseObject(value) : this.objects.retainObject(value);
      case FieldFlag.Block:
        return dispose ? this.release(value) : this.copy(value);
      case FieldFlag.Byref:
        return dispose ? this.release(value, true) : this.copyByref(value);
      default:
        throw new Error("Unsupported guest block capture flags " + flags);
    }
  }
}
