import type { FoundationHost } from "../../objc/host";
export interface URLCacheHost extends FoundationHost {
  send(pointer: number, selector: string, args?: number[]): Promise<number>;
}
export const StoragePolicy = { Allowed: 0, MemoryOnly: 1, NotAllowed: 2 } as const;
export const CACHE_CLASS = "NSURLCache";
export const CACHED_RESPONSE_CLASS = "NSCachedURLResponse";
export async function releaseAll(host: URLCacheHost, pointers: readonly number[]): Promise<void> {
  for (const pointer of pointers) await host.release(pointer);
}
export function requireMemoryCache(diskCapacity: number): void {
  if (diskCapacity !== 0) throw new Error("Disk-backed NSURLCache is not implemented.");
}
