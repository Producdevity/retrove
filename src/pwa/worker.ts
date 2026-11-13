import { navigationResponse, shellDocument } from "./navigation";
declare const __RETROVE_ASSETS__: readonly string[];
declare const __RETROVE_VERSION__: string;
const CACHE_PREFIX = "retrove.shell:";
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
  for (const name of await caches.keys())
    if (name.startsWith(CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
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
});
