import { parseBinaryPlist } from "./binary";
import type { PlistValue } from "./values";
import { parseXmlPlist } from "./xml";

export type { PlistDictionary, PlistValue } from "./values";
const BINARY_MAGIC = "bplist00";

export function isBinaryPlist(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, BINARY_MAGIC.length)) === BINARY_MAGIC;
}

export function parsePlist(bytes: Uint8Array): PlistValue {
  return isBinaryPlist(bytes) ? parseBinaryPlist(bytes) : parseXmlPlist(bytes);
}
