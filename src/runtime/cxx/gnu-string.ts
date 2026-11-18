import type { GuestArguments } from "../ios/objc/host";

/** GNU libstdc++ copy-on-write string _Rep header before the characters: length, capacity, refcount. */
const Rep = { Length: 0, Capacity: 4, RefCount: 8, Bytes: 12 } as const;
/** _S_empty_rep_storage is four words: an empty _Rep and its terminator. */
const EMPTY_REP_BYTES = 16;
const NPOS = 0xffffffff;
/** libstdc++'s _S_max_size: (npos - sizeof(_Rep) - 1) / 4. */
const MAX_SIZE_DIVISOR = 4;
const MAX_SIZE = Math.floor((NPOS - Rep.Bytes - 1) / MAX_SIZE_DIVISOR);
const TERMINATOR = 1;
const GROWTH = 2;
const Arg = { Self: 0, Text: 1, Length: 2 } as const;

export interface StringHost {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
  readBytes(pointer: number, length: number): Uint8Array;
  writeBytes(pointer: number, bytes: Uint8Array): void;
  allocate(bytes: number): number;
  free(pointer: number): void;
  zero(bytes: number): number;
  /** Throws std::length_error with the message; never returns normally. */
  lengthError(message: string): unknown;
}
type Imports = Record<string, (args: GuestArguments) => unknown>;
export const EMPTY_REP_SYMBOL = "__ZNSs4_Rep20_S_empty_rep_storageE";

/** The out-of-line std::string members that old iOS apps import from libstdc++.6. */
export class CowStrings {
  readonly emptyRep: number;
  constructor(private readonly host: StringHost) {
    this.emptyRep = host.zero(EMPTY_REP_BYTES);
  }
  private rep(self: number): number {
    return this.host.read(self) - Rep.Bytes;
  }
  private field(self: number, offset: number): number {
    return this.host.read(this.rep(self) + offset);
  }
  private shared(self: number): boolean {
    return (this.field(self, Rep.RefCount) | 0) > 0;
  }
  private dispose(rep: number): void {
    if (rep === this.emptyRep) return;
    const count = this.host.read(rep + Rep.RefCount) | 0;
    if (count <= 0) this.host.free(rep);
    else this.host.write(rep + Rep.RefCount, count - 1);
  }
  private setLength(self: number, length: number): void {
    const rep = this.rep(self);
    if (rep === this.emptyRep) return;
    this.host.write(rep + Rep.RefCount, 0);
    this.host.write(rep + Rep.Length, length);
    this.host.writeBytes(rep + Rep.Bytes + length, new Uint8Array(TERMINATOR));
  }
  /** Gives `self` unshared storage of at least `capacity`, keeping its first `keep` bytes. */
  private reallocate(self: number, capacity: number, keep: number): void {
    const old = this.field(self, Rep.Capacity);
    const grown = capacity > old && capacity < GROWTH * old ? GROWTH * old : capacity;
    const rep = this.host.allocate(Rep.Bytes + grown + TERMINATOR);
    if (!rep) throw new Error("std::string allocation exhausted guest memory");
    this.host.write(rep + Rep.Capacity, grown);
    this.host.write(rep + Rep.RefCount, 0);
    if (keep)
      this.host.writeBytes(rep + Rep.Bytes, this.host.readBytes(this.host.read(self), keep));
    const previous = this.rep(self);
    this.host.write(self, rep + Rep.Bytes);
    this.dispose(previous);
  }
  /** Returns the string, or the unwinding result of std::length_error. */
  assign(self: number, text: number, length: number): unknown {
    if (length > MAX_SIZE) return this.host.lengthError("basic_string::assign");
    const bytes = this.host.readBytes(text, length);
    if (length > this.field(self, Rep.Capacity) || this.shared(self))
      this.reallocate(self, length, 0);
    this.host.writeBytes(this.host.read(self), bytes);
    this.setLength(self, length);
    return self;
  }
  append(self: number, text: number, length: number): unknown {
    if (!length) return self;
    const size = this.field(self, Rep.Length);
    if (length > MAX_SIZE - size) return this.host.lengthError("basic_string::append");
    const bytes = this.host.readBytes(text, length);
    if (size + length > this.field(self, Rep.Capacity) || this.shared(self))
      this.reallocate(self, size + length, size);
    this.host.writeBytes(this.host.read(self) + size, bytes);
    this.setLength(self, size + length);
    return self;
  }
}

export function gnuStringImports(strings: CowStrings): Imports {
  return {
    __ZNSs6assignEPKcm: (a) => strings.assign(a(Arg.Self), a(Arg.Text), a(Arg.Length)),
    __ZNSs6appendEPKcm: (a) => strings.append(a(Arg.Self), a(Arg.Text), a(Arg.Length)),
  };
}
