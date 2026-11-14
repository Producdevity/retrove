import type { GuestArguments, HostResult } from "../objc/host";
import { Keychain, KeychainError, type KeychainAttributes, type KeychainValue } from "./keychain";
import { AttributeKeys, SecurityKey, SecurityStatus, SecurityValue } from "./constants";
interface SecurityHost {
  entries(pointer: number): ReadonlyArray<readonly [number, number]>;
  isKind(pointer: number, name: string): boolean;
  text(pointer: number): string;
  bytes(pointer: number): Uint8Array;
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
  property(value: unknown): number;
  retain(pointer: number): number;
  write(pointer: number, value: number): void;
  read(): Promise<unknown>;
  save(items: readonly KeychainAttributes[]): Promise<boolean>;
}
interface Query {
  readonly attributes: KeychainAttributes;
  readonly data: boolean;
  readonly attributesResult: boolean;
  readonly all: boolean;
}
async function query(host: SecurityHost, pointer: number, partial = false): Promise<Query> {
  if (!host.isKind(pointer, "NSDictionary")) throw new KeychainError(SecurityStatus.Parameter);
  const attributes: Record<string, KeychainValue> = {};
  let data = false,
    attributesResult = false,
    all = false;
  for (const [keyPointer, value] of host.entries(pointer)) {
    const key = host.text(keyPointer);
    if (key === SecurityKey.ReturnData || key === SecurityKey.ReturnAttributes) {
      if (!host.isKind(value, "NSNumber")) throw new KeychainError(SecurityStatus.Parameter);
      const enabled = Boolean(await host.send(value, "boolValue"));
      if (key === SecurityKey.ReturnData) data = enabled;
      else attributesResult = enabled;
    } else if (key === SecurityKey.MatchLimit) {
      const limit = host.text(value);
      if (limit !== SecurityValue.One && limit !== SecurityValue.All)
        throw new KeychainError(SecurityStatus.Parameter);
      all = limit === SecurityValue.All;
    } else {
      if (!AttributeKeys.has(key)) throw new KeychainError(SecurityStatus.Unimplemented);
      const binary = key === SecurityKey.Data || key === SecurityKey.Generic;
      if (!host.isKind(value, binary ? "NSData" : "NSString"))
        throw new KeychainError(SecurityStatus.Parameter);
      attributes[key] = binary ? host.bytes(value) : host.text(value);
    }
  }
  if (!partial && attributes[SecurityKey.Class] !== SecurityValue.GenericPassword)
    throw new KeychainError(SecurityStatus.Unimplemented);
  return { attributes, data, attributesResult, all };
}
function result(
  host: SecurityHost,
  items: readonly KeychainAttributes[],
  options: Query,
  out: number,
): void {
  if (!out) return;
  if (!options.data && !options.attributesResult) {
    host.write(out, 0);
    return;
  }
  const values = items.map((item) => {
    if (!options.attributesResult) return item[SecurityKey.Data] ?? new Uint8Array();
    const copy = { ...item };
    if (!options.data) delete copy[SecurityKey.Data];
    return copy;
  });
  host.write(out, host.retain(host.property(options.all ? values : values[0])));
}
export function securityImports(host: SecurityHost) {
  const store = new Keychain({ read: () => host.read(), write: (items) => host.save(items) });
  const execute =
    (operation: (args: GuestArguments) => Promise<void>) => async (args: GuestArguments) => {
      try {
        await operation(args);
        return SecurityStatus.Success;
      } catch (error) {
        if (error instanceof KeychainError) return error.status;
        throw error;
      }
    };
  return {
    _SecItemCopyMatching: execute(async (args) => {
      const options = await query(host, args(0)),
        items = await store.query(options.attributes);
      if (!items.length) throw new KeychainError(SecurityStatus.NotFound);
      result(host, options.all ? items : items.slice(0, 1), options, args(1));
    }),
    _SecItemAdd: execute(async (args) => {
      const options = await query(host, args(0));
      await store.add(options.attributes);
      result(host, [options.attributes], options, args(1));
    }),
    _SecItemUpdate: execute(async (args) => {
      await store.update(
        (await query(host, args(0))).attributes,
        (await query(host, args(1), true)).attributes,
      );
    }),
    _SecItemDelete: execute(async (args) => {
      await store.delete((await query(host, args(0))).attributes);
    }),
  };
}
