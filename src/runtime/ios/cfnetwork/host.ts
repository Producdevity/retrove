import type { FoundationHost } from "../objc/host";

export interface CFNetworkHost extends FoundationHost {
  read(address: number): number;
  /** Zeroed guest memory that lives as long as the guest. */
  zero(bytes: number): number;
  readBytes(address: number, length: number): Uint8Array;
  callGuest(fn: number, args: number[]): Promise<number>;
  /** Contents of an NSData or CFData object. */
  dataBytes(data: number): Uint8Array;
  /** Each owned* helper returns a +1 reference, as CF Create and Copy functions do. */
  ownedData(bytes: Uint8Array): number;
  ownedDictionary(entries: Readonly<Record<string, string>>): number;
  ownedArray(items: readonly number[]): number;
  ownedURL(address: string): Promise<number>;
  urlString(url: number): Promise<string>;
  error(domain: string, code: number): number;
}
