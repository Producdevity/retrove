import type { HostResult } from "../../objc/host";
import { Argument, CallbackSlot, classPointer, type CoreFoundationHost, type Pair } from "./types";

const WORD = Uint32Array.BYTES_PER_ELEMENT;
const CAPTURED_CALLBACKS = 4;

interface Callbacks {
  readonly keys: number[];
  readonly values: number[];
}
interface ArrayState extends Callbacks {
  readonly dictionary: false;
  readonly list: number[];
}
interface DictionaryState extends Callbacks {
  readonly dictionary: true;
  readonly list: Pair[];
}
type CollectionState = ArrayState | DictionaryState;

function entryKey(item: number | Pair | undefined): number {
  if (item === undefined) throw new Error("CFRange outside collection");
  return Array.isArray(item) ? item[0] : item;
}
export function at(list: readonly number[], index: number): number {
  const value = list[index];
  if (index < 0 || value === undefined) throw new Error("CFArray index outside collection");
  return value;
}

/** Mutable CFArray and CFDictionary instances, which keep their own callbacks and storage. */
export class Collections {
  private readonly states = new Map<number, CollectionState>();
  constructor(private readonly host: CoreFoundationHost) {}

  private capture(pointer: number): number[] {
    return pointer
      ? Array.from({ length: CAPTURED_CALLBACKS }, (_, i) =>
          this.host.read(pointer + (i + 1) * WORD),
        )
      : [];
  }
  private async acquire(fn: number | undefined, value: number): Promise<number> {
    return fn ? await this.host.callGuest(fn, [0, value]) : value;
  }
  private async drop(fn: number | undefined, value: number): Promise<void> {
    if (fn) await this.host.callGuest(fn, [0, value]);
  }
  private state(pointer: number): CollectionState {
    const value = this.states.get(pointer);
    if (!value) throw new Error("Invalid CF collection");
    return value;
  }
  arrayState(pointer: number): ArrayState | undefined {
    const value = this.states.get(pointer);
    if (value?.dictionary) throw new Error("CFArray function used on a CFDictionary");
    return value;
  }
  private dictionaryState(pointer: number): DictionaryState | undefined {
    const value = this.states.get(pointer);
    if (value && !value.dictionary) throw new Error("CFDictionary function used on a CFArray");
    return value;
  }
  count(pointer: number): number {
    return this.state(pointer).list.length;
  }
  array(pointer: number): readonly number[] {
    return this.arrayState(pointer)?.list ?? this.host.items(pointer);
  }
  entries(pointer: number): Pair[] | undefined {
    const value = this.states.get(pointer);
    return value?.dictionary ? value.list : undefined;
  }

  create(className: string, a: (index: number) => number, dictionary: boolean): number {
    if (a(0)) throw new Error("Custom CF collection allocator is unsupported");
    const pointer = this.host.alloc(classPointer(this.host, className));
    const keys = this.capture(a(Argument.Third)),
      values = dictionary ? this.capture(a(Argument.Fourth)) : [];
    if (dictionary) this.states.set(pointer, { dictionary, keys, values, list: [] });
    else this.states.set(pointer, { dictionary, keys, values, list: [] });
    return pointer;
  }
  private async same(
    collection: CollectionState | undefined,
    key: number,
    value: number,
  ): Promise<boolean> {
    if (!collection) return Boolean(await this.host.send(key, "isEqual:", [value]));
    const equal = collection.keys[CallbackSlot.Equal];
    return equal ? Boolean(await this.host.callGuest(equal, [key, value])) : false;
  }
  async find(
    pointer: number,
    list: readonly (number | Pair)[],
    start: number,
    count: number,
    value: number,
  ): Promise<number> {
    if (start < 0 || count < 0 || start + count > list.length)
      throw new Error("CFRange outside collection");
    const collection = this.states.get(pointer);
    for (let i = start; i < start + count; i++) {
      const key = entryKey(list[i]);
      if (key === value || (await this.same(collection, key, value))) return i;
    }
    return -1;
  }
  async removeArray(pointer: number, index: number): Promise<HostResult> {
    const collection = this.arrayState(pointer);
    if (!collection) return this.host.send(pointer, "removeObjectAtIndex:", [index]);
    const old = at(collection.list, index);
    collection.list.splice(index, 1);
    await this.drop(collection.keys[CallbackSlot.Release], old);
  }
  async appendArray(pointer: number, value: number): Promise<HostResult> {
    const collection = this.arrayState(pointer);
    if (!collection) return this.host.send(pointer, "addObject:", [value]);
    collection.list.push(await this.acquire(collection.keys[CallbackSlot.Retain], value));
  }
  async changeDictionary(
    pointer: number,
    key: number,
    value: number,
    replace = false,
  ): Promise<void> {
    const collection = this.dictionaryState(pointer);
    if (!collection) {
      if (!value || replace || !this.host.foundation.get(pointer, key))
        await this.host.foundation.associated(pointer, key, value);
      return;
    }
    const i = await this.find(pointer, collection.list, 0, collection.list.length, key);
    const entry = collection.list[i];
    if (!entry) {
      if (value)
        collection.list.push([
          await this.acquire(collection.keys[CallbackSlot.Retain], key),
          await this.acquire(collection.values[CallbackSlot.Retain], value),
        ]);
      return;
    }
    if (value && !replace) return;
    const [oldKey, oldValue] = entry;
    if (value) entry[1] = await this.acquire(collection.values[CallbackSlot.Retain], value);
    else {
      collection.list.splice(i, 1);
      await this.drop(collection.keys[CallbackSlot.Release], oldKey);
    }
    await this.drop(collection.values[CallbackSlot.Release], oldValue);
  }
  async dictionaryValue(pointer: number, key: number): Promise<number> {
    const collection = this.dictionaryState(pointer);
    if (!collection) return this.host.foundation.get(pointer, key);
    const i = await this.find(pointer, collection.list, 0, collection.list.length, key);
    return collection.list[i]?.[1] ?? 0;
  }
  async dealloc(pointer: number): Promise<void> {
    const collection = this.state(pointer);
    this.states.delete(pointer);
    for (const item of collection.list) {
      if (Array.isArray(item)) {
        await this.drop(collection.keys[CallbackSlot.Release], item[0]);
        await this.drop(collection.values[CallbackSlot.Release], item[1]);
      } else await this.drop(collection.keys[CallbackSlot.Release], item);
    }
    this.host.destroy(pointer);
  }
}
