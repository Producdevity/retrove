import { DataField, installDataFactories, installStringDataEncoding } from "../foundation/data";
import { StringEncoding } from "../foundation/text/encoding";
import type { ClassRegistry } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import type { Messenger } from "./messaging";
import type { ObjectOwnership, OwnedObject } from "./object-ownership";
import type { ObjcHeap } from "./runtime-types";
import { pointerResult } from "./runtime-types";
import type { StringObjects } from "./string-objects";

const DATA = "NSData";
const MUTABLE_DATA = "NSMutableData";
const DATA_INSTANCE_BYTES = 12;
const COPY_CHUNK = 65536;
const encoder = new TextEncoder();

export interface DataObjects {
  /** An owned NSData copy of guest bytes, or 0 when they cannot be read or stored. */
  readonly createData: (source: number, count: number, self?: number) => number;
  readonly resizeData: (self: number, length: number) => void;
  /** An owned NSData holding host bytes. */
  readonly archivedData: (bytes: Uint8Array, self?: number) => number;
  readonly contents: (self: number) => Uint8Array;
}
interface DataHost {
  readonly memory: GuestAccess;
  readonly heap: ObjcHeap;
  readonly registry: ClassRegistry;
  readonly ownership: ObjectOwnership;
  readonly strings: StringObjects;
  readonly messenger: Messenger;
}
function copyBytes(memory: GuestAccess, target: number, source: number, count: number): void {
  for (let offset = 0; offset < count; offset += COPY_CHUNK)
    memory.writeBytes(
      target + offset,
      memory.bytes(source + offset, Math.min(count - offset, COPY_CHUNK)),
    );
}
function ownedObject(ownership: ObjectOwnership, self: number, message: string): OwnedObject {
  const object = ownership.owned.get(self);
  if (!object) throw new Error(message);
  return object;
}
export function installDataObjects(host: DataHost): DataObjects {
  const { memory, heap, registry, ownership } = host;
  const { read, write } = memory;
  const { method } = registry;
  registry.hostClass(DATA, "NSObject", DATA_INSTANCE_BYTES);
  registry.hostClass(MUTABLE_DATA, DATA, DATA_INSTANCE_BYTES);
  const owned = (self: number, message: string) => ownedObject(ownership, self, message);
  function createData(source: number, count: number, self?: number): number {
    if (!source && count) return 0;
    const value = self ?? ownership.alloc(registry.names.get(DATA) ?? 0);
    if (count) {
      const bytes = heap.alloc(count);
      if (!bytes) {
        ownership.destroy(value);
        return 0;
      }
      copyBytes(memory, bytes, source, count);
      owned(value, "Cannot store bytes in an NSData the host does not own").buffers.push(bytes);
      write(value + DataField.Bytes, bytes);
    }
    write(value + DataField.Length, count);
    return value;
  }
  function resizeData(self: number, length: number): void {
    const state = owned(self, "Invalid NSMutableData");
    const prior = read(self + DataField.Bytes),
      previous = read(self + DataField.Length);
    if (length === previous) return;
    const target = length ? memory.zero(length) : 0;
    for (let offset = 0; offset < Math.min(previous, length); offset += COPY_CHUNK)
      memory.writeBytes(
        target + offset,
        memory.bytes(prior + offset, Math.min(COPY_CHUNK, length - offset, previous - offset)),
      );
    if (prior) {
      heap.free(prior);
      state.buffers = state.buffers.filter((pointer) => pointer !== prior);
    }
    if (target) state.buffers.push(target);
    write(self + DataField.Bytes, target);
    write(self + DataField.Length, length);
  }
  const data: DataObjects = {
    createData,
    resizeData,
    archivedData(bytes, self) {
      const source = heap.alloc(Math.max(1, bytes.length));
      try {
        memory.writeBytes(source, bytes);
        return createData(source, bytes.length, self);
      } finally {
        heap.free(source);
      }
    },
    contents: (self) => memory.bytes(read(self + DataField.Bytes), read(self + DataField.Length)),
  };
  method(DATA, false, "initWithBytes:length:", (self, args) => createData(args(0), args(1), self));
  method(DATA, false, "initWithData:", (self, args) =>
    createData(read(args(0) + DataField.Bytes), read(args(0) + DataField.Length), self),
  );
  method(DATA, false, "length", (self) => read(self + DataField.Length));
  method(DATA, false, "bytes", (self) => read(self + DataField.Bytes));
  installDataFactories({
    method,
    alloc: ownership.alloc,
    autorelease: ownership.autorelease,
    create: createData,
    resize: resizeData,
    bytes: (pointer) => (pointer ? read(pointer + DataField.Bytes) : 0),
    length: (pointer) => (pointer ? read(pointer + DataField.Length) : 0),
    read: memory.bytes,
    write: (pointer, offset, bytes) =>
      memory.writeBytes(read(pointer + DataField.Bytes) + offset, bytes),
  });
  installMutableData(host, data);
  return data;
}
function installMutableData(host: DataHost, data: DataObjects): void {
  const { memory, registry, ownership, strings } = host;
  const { read } = memory;
  const { method } = registry;
  const { createData, resizeData } = data;
  method(MUTABLE_DATA, true, "dataWithLength:", (cls, args) => {
    const self = ownership.alloc(cls);
    resizeData(self, args(0));
    return ownership.autorelease(self);
  });
  method(MUTABLE_DATA, true, "dataWithCapacity:", (cls) =>
    ownership.autorelease(ownership.alloc(cls)),
  );
  method(MUTABLE_DATA, false, "mutableBytes", (self) => read(self + DataField.Bytes));
  method(MUTABLE_DATA, false, "setLength:", (self, args) => resizeData(self, args(0)));
  method(MUTABLE_DATA, false, "appendData:", (self, args) => {
    const value = args(0),
      size = read(value + DataField.Length),
      old = read(self + DataField.Length);
    resizeData(self, old + size);
    copyBytes(memory, read(self + DataField.Bytes) + old, read(value + DataField.Bytes), size);
  });
  method(DATA, false, "copy", ownership.retain);
  method(MUTABLE_DATA, false, "copy", (self) =>
    createData(read(self + DataField.Bytes), read(self + DataField.Length)),
  );
  method(DATA, false, "mutableCopy", (self) => {
    const copy = ownership.alloc(registry.names.get(MUTABLE_DATA) ?? 0),
      length = read(self + DataField.Length);
    resizeData(copy, length);
    copyBytes(memory, read(copy + DataField.Bytes), read(self + DataField.Bytes), length);
    return copy;
  });
  method("NSString", false, "dataUsingEncoding:allowLossyConversion:", (self, args) => {
    if (args(0) !== StringEncoding.UTF8) return 0;
    const pointer = strings.utf8(self),
      length = encoder.encode(strings.text(self)).length;
    return ownership.autorelease(createData(pointer, length));
  });
  installStringDataEncoding({
    method,
    send: async (pointer, selector, args) =>
      pointerResult(await host.messenger.send(pointer, selector, args)),
  });
}
