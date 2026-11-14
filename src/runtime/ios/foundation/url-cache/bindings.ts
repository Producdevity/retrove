import { MemoryURLCache } from "./memory";
import {
  CACHE_CLASS,
  releaseAll,
  requireMemoryCache,
  StoragePolicy,
  type URLCacheHost,
} from "./host";
import { installCachedResponses } from "./response";
const DEFAULT_MEMORY_BYTES = 4_194_304;
export function installURLCache(host: URLCacheHost): void {
  const cls = host.hostClass(CACHE_CLASS, "NSObject"),
    caches = new Map<number, MemoryURLCache<number>>();
  let shared = 0,
    initialized = false;
  const cache = (pointer: number): MemoryURLCache<number> => {
    let value = caches.get(pointer);
    if (!value) {
      value = new MemoryURLCache(DEFAULT_MEMORY_BYTES);
      caches.set(pointer, value);
    }
    return value;
  };
  installCachedResponses(host);
  host.method(CACHE_CLASS, true, "sharedURLCache", () => {
    if (!initialized) {
      shared = host.alloc(cls);
      initialized = true;
      cache(shared);
    }
    return shared;
  });
  host.method(CACHE_CLASS, true, "setSharedURLCache:", async (_, args) => {
    const old = shared;
    shared = host.retain(args(0));
    initialized = true;
    if (old) await host.release(old);
  });
  host.method(
    CACHE_CLASS,
    false,
    "initWithMemoryCapacity:diskCapacity:diskPath:",
    async (self, args) => {
      const capacity = args(0);
      requireMemoryCache(args(1));
      await releaseAll(host, cache(self).resize(capacity));
      return self;
    },
  );
  host.method(CACHE_CLASS, false, "memoryCapacity", (self) => cache(self).capacity);
  host.method(CACHE_CLASS, false, "setMemoryCapacity:", (self, args) =>
    releaseAll(host, cache(self).resize(args(0))),
  );
  host.method(CACHE_CLASS, false, "currentMemoryUsage", (self) => cache(self).usage);
  for (const selector of ["diskCapacity", "currentDiskUsage"])
    host.method(CACHE_CLASS, false, selector, () => 0);
  host.method(CACHE_CLASS, false, "setDiskCapacity:", (_, args) => requireMemoryCache(args(0)));
  installEntries(host, cache);
  host.method(CACHE_CLASS, false, "dealloc", async (self) => {
    const value = caches.get(self);
    caches.delete(self);
    if (value) await releaseAll(host, value.clear());
    host.destroy(self);
  });
}
function installEntries(
  host: URLCacheHost,
  cache: (pointer: number) => MemoryURLCache<number>,
): void {
  const key = async (request: number): Promise<string | undefined> => {
    const url = await host.send(request, "URL");
    if (!url) return undefined;
    const address = host.text(await host.send(url, "absoluteString")),
      method = host.text(await host.send(request, "HTTPMethod"));
    return JSON.stringify([address, method]);
  };
  host.method(CACHE_CLASS, false, "cachedResponseForRequest:", async (self, args) => {
    const identifier = await key(args(0));
    if (identifier === undefined) return 0;
    const value = cache(self).get(identifier);
    return value === undefined ? 0 : host.autorelease(host.retain(value));
  });
  host.method(CACHE_CLASS, false, "storeCachedResponse:forRequest:", async (self, args) => {
    const value = args(0),
      request = args(1),
      policy = await host.send(value, "storagePolicy");
    if (policy === StoragePolicy.NotAllowed) return;
    const identifier = await key(request);
    if (identifier === undefined) return;
    const bytes = await host.send(await host.send(value, "data"), "length");
    await releaseAll(host, cache(self).store(identifier, host.retain(value), bytes));
  });
  host.method(CACHE_CLASS, false, "removeCachedResponseForRequest:", async (self, args) => {
    const identifier = await key(args(0));
    if (identifier === undefined) return;
    const value = cache(self).remove(identifier);
    if (value !== undefined) await host.release(value);
  });
  host.method(CACHE_CLASS, false, "removeAllCachedResponses", (self) =>
    releaseAll(host, cache(self).clear()),
  );
}
