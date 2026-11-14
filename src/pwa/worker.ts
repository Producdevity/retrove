import { installWorkerUpdates } from "./worker-update";
import { SHELL_CACHE_PREFIX } from "./update-protocol";
declare const clients: {
  matchAll(options: {
    type: "window";
    includeUncontrolled: boolean;
  }): Promise<readonly { url: string }[]>;
  claim(): Promise<void>;
};
declare function skipWaiting(): Promise<void>;
import { navigationResponse, shellDocument } from "./navigation";
declare const __RETROVE_ASSETS__: readonly string[];
declare const __RETROVE_VERSION__: string;
const CACHE_PREFIX = SHELL_CACHE_PREFIX;
const cacheName = CACHE_PREFIX + __RETROVE_VERSION__;
const assets = new Set(__RETROVE_ASSETS__);
interface LifetimeEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface RequestEvent extends LifetimeEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
function isLifetimeEvent(event: Event): event is LifetimeEvent {
  return "waitUntil" in event && typeof event.waitUntil === "function";
}
function isRequestEvent(event: Event): event is RequestEvent {
  return (
    isLifetimeEvent(event) &&
    "request" in event &&
    event.request instanceof Request &&
    "respondWith" in event &&
    typeof event.respondWith === "function"
  );
}
async function install(): Promise<void> {
  const cache = await caches.open(cacheName);
  try {
    await cache.addAll([...assets]);
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}
async function activate(): Promise<void> {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const keepOld =
    windows.length > 1 ||
    windows.some((client) => new URL(client.url).pathname.startsWith("/player"));
  if (!keepOld)
    for (const name of await caches.keys())
      if (name.startsWith(CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
  await clients.claim();
}
async function respond(request: Request, pathname: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(pathname);
  if (!cached) return fetch(request);
  return request.mode === "navigate" ? navigationResponse(cached) : cached;
}
globalThis.addEventListener("install", (event) => {
  if (isLifetimeEvent(event)) event.waitUntil(install());
});
globalThis.addEventListener("activate", (event) => {
  if (isLifetimeEvent(event)) event.waitUntil(activate());
});
globalThis.addEventListener("fetch", (event) => {
  if (!isRequestEvent(event) || event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  const pathname = shellDocument(url.pathname);
  if (assets.has(pathname)) event.respondWith(respond(event.request, pathname));
  else if (pathname.startsWith("/assets/") || pathname.startsWith("/runtime/"))
    event.respondWith(
      (async () => {
        for (const name of await caches.keys())
          if (name.startsWith(CACHE_PREFIX)) {
            const response = await (await caches.open(name)).match(pathname);
            if (response) return response;
          }
        return fetch(event.request);
      })(),
    );
});

installWorkerUpdates(
  {
    windows: () => clients.matchAll({ type: "window", includeUncontrolled: true }),
    skipWaiting: () => skipWaiting(),
  },
  (handler) => globalThis.addEventListener("message", handler),
);
