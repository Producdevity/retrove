import { decodeCharacterBytes } from "../foundation/text/characters";
import type { ClassRegistry } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import type { ObjectOwnership } from "./object-ownership";
import type { ObjcHeap } from "./runtime-types";

/** NSString instances: flags, then a guest buffer and its length in code units. */
export const StringField = { Flags: 4, Data: 8, Length: 12 } as const;
const StringFlags = { UTF8: 0x7c8, UTF16: 0x7d0, Wide: 16 } as const;
const MAX_LENGTH = 0x1000000;
const UTF16_UNIT_BYTES = 2;
const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export interface StringObjects {
  /** Stores text in an owned NSString, a new one unless `self` is given. */
  readonly makeString: (text: string, self?: number) => number;
  readonly makeUTF16: (bytes: Uint8Array, self?: number) => number;
  readonly text: (self: number) => string;
  /** An autoreleased NSString. */
  readonly string: (text: string) => number;
  /** A NUL-terminated UTF-8 copy that lives as long as the string. */
  readonly utf8: (self: number) => number;
}
export function stringObjects(
  memory: GuestAccess,
  heap: ObjcHeap,
  registry: ClassRegistry,
  ownership: ObjectOwnership,
): StringObjects {
  const { read, write } = memory;
  const utf8Cache = new Map<number, number>();
  const stringClass = () => registry.names.get("NSString") ?? 0;
  const storage = (self: number, message: string) => {
    const object = ownership.owned.get(self);
    if (!object) throw new Error(message);
    return object;
  };
  function makeString(value: string, self = ownership.alloc(stringClass())): number {
    const bytes = encoder.encode(value);
    const data = memory.zero(bytes.length + 1);
    memory.writeBytes(data, bytes);
    const object = storage(self, "Cannot initialize a constant NSString");
    for (const old of object.buffers) heap.free(old);
    object.buffers = [data];
    write(self + StringField.Flags, StringFlags.UTF8);
    write(self + StringField.Data, data);
    write(self + StringField.Length, bytes.length);
    return self;
  }
  function text(self: number): string {
    if (!self || !registry.subclass(read(self), stringClass()))
      throw new Error("Expected NSString");
    const wide = Boolean(read(self + StringField.Flags) & StringFlags.Wide);
    const length = read(self + StringField.Length);
    if (length > MAX_LENGTH) throw new Error("Invalid NSString length");
    const bytes = memory.bytes(
      read(self + StringField.Data),
      wide ? length * UTF16_UNIT_BYTES : length,
    );
    return wide ? decodeCharacterBytes(bytes) : utf8Decoder.decode(bytes);
  }
  function makeUTF16(bytes: Uint8Array, self = ownership.alloc(stringClass())): number {
    const object = storage(self, "Cannot modify constant NSString");
    const data = memory.zero(bytes.length + UTF16_UNIT_BYTES);
    memory.writeBytes(data, bytes);
    for (const pointer of object.buffers) heap.free(pointer);
    object.buffers = [data];
    const cached = utf8Cache.get(self);
    if (cached) {
      heap.free(cached);
      utf8Cache.delete(self);
    }
    write(self + StringField.Flags, StringFlags.UTF16);
    write(self + StringField.Data, data);
    write(self + StringField.Length, bytes.length / UTF16_UNIT_BYTES);
    return self;
  }
  function utf8(self: number): number {
    if (!(read(self + StringField.Flags) & StringFlags.Wide)) return read(self + StringField.Data);
    let cached = utf8Cache.get(self);
    if (cached === undefined) utf8Cache.set(self, (cached = heap.string(text(self))));
    return cached;
  }
  return {
    makeString,
    makeUTF16,
    text,
    string: (value) => ownership.autorelease(makeString(value)),
    utf8,
  };
}
