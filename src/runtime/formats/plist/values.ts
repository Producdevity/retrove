import type { ArchiveReference } from "../../ios/foundation/archives/graph";

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | ArchiveReference
  | PlistValue[]
  | PlistDictionary;
export interface PlistDictionary {
  [key: string]: PlistValue;
}
export const MAX_PLIST_DEPTH = 128;

export function plistDictionary(
  pairs: Iterable<readonly [PlistValue, PlistValue]>,
): PlistDictionary {
  const result: PlistDictionary = { __proto__: null };
  for (const [key, value] of pairs) {
    if (typeof key !== "string" || Object.hasOwn(result, key))
      throw Error("Invalid plist dictionary key");
    result[key] = value;
  }
  return result;
}

export function plistInteger(value: bigint): number | bigint {
  return Number.isSafeInteger(Number(value)) ? Number(value) : value;
}
