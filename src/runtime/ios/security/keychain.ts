import { isRecord } from "../../../domain/validation";
import { AttributeKeys, SecurityKey, SecurityStatus, SecurityValue } from "./constants";
export type KeychainValue = string | Uint8Array;
export type KeychainAttributes = Readonly<Record<string, KeychainValue>>;
interface KeychainStorage {
  read(): Promise<unknown>;
  write(items: readonly KeychainAttributes[]): Promise<boolean>;
}
export class KeychainError extends Error {
  constructor(readonly status: number) {
    super("Keychain error " + status);
  }
}
const MAX_ITEMS = 4096;
const MAX_ITEM_BYTES = 1_048_576;
function attributes(value: unknown): KeychainAttributes {
  if (!isRecord(value)) throw new KeychainError(SecurityStatus.Decode);
  const result: Record<string, KeychainValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!AttributeKeys.has(key) || (typeof item !== "string" && !(item instanceof Uint8Array)))
      throw new KeychainError(SecurityStatus.Decode);
    if (
      key === SecurityKey.Data || key === SecurityKey.Generic
        ? !(item instanceof Uint8Array)
        : typeof item !== "string"
    )
      throw new KeychainError(SecurityStatus.Decode);
    if (item.length > MAX_ITEM_BYTES) throw new KeychainError(SecurityStatus.Parameter);
    result[key] = item;
  }
  if (result[SecurityKey.Class] !== SecurityValue.GenericPassword)
    throw new KeychainError(SecurityStatus.Unimplemented);
  return result;
}
function same(left: KeychainValue | undefined, right: KeychainValue): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  return (
    left !== undefined &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
function matches(item: KeychainAttributes, query: KeychainAttributes): boolean {
  return Object.entries(query).every(([key, value]) => same(item[key], value));
}
function duplicate(left: KeychainAttributes, right: KeychainAttributes): boolean {
  return [SecurityKey.Class, SecurityKey.Account, SecurityKey.Service, SecurityKey.Group].every(
    (key) => (left[key] ?? "") === (right[key] ?? ""),
  );
}
export class Keychain {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly storage: KeychainStorage) {}
  transaction<T>(operation: (items: KeychainAttributes[]) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      let value: unknown;
      try {
        value = await this.storage.read();
      } catch {
        throw new KeychainError(SecurityStatus.Decode);
      }
      if (!Array.isArray(value) || value.length > MAX_ITEMS)
        throw new KeychainError(SecurityStatus.Decode);
      const items: readonly unknown[] = value;
      return operation(items.map(attributes));
    });
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  query(query: KeychainAttributes): Promise<KeychainAttributes[]> {
    return this.transaction((items) =>
      Promise.resolve(items.filter((item) => matches(item, query))),
    );
  }
  async add(value: KeychainAttributes): Promise<void> {
    const item = attributes(value);
    return this.transaction(async (items) => {
      if (items.length >= MAX_ITEMS) throw new KeychainError(SecurityStatus.IO);
      if (items.some((other) => duplicate(item, other)))
        throw new KeychainError(SecurityStatus.Duplicate);
      if (!(await this.storage.write([...items, item]))) throw new KeychainError(SecurityStatus.IO);
    });
  }
  async update(query: KeychainAttributes, changes: KeychainAttributes): Promise<void> {
    return this.transaction(async (items) => {
      let changed = false;
      const result = items.map((item) => {
        if (!matches(item, query)) return item;
        changed = true;
        return attributes({ ...item, ...changes });
      });
      if (!changed) throw new KeychainError(SecurityStatus.NotFound);
      if (
        result.some((item, index) =>
          result.some((other, otherIndex) => index !== otherIndex && duplicate(item, other)),
        )
      )
        throw new KeychainError(SecurityStatus.Duplicate);
      if (!(await this.storage.write(result))) throw new KeychainError(SecurityStatus.IO);
    });
  }
  async delete(query: KeychainAttributes): Promise<void> {
    return this.transaction(async (items) => {
      const remaining = items.filter((item) => !matches(item, query));
      if (remaining.length === items.length) throw new KeychainError(SecurityStatus.NotFound);
      if (!(await this.storage.write(remaining))) throw new KeychainError(SecurityStatus.IO);
    });
  }
}
