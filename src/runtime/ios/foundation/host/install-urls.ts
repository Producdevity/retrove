import { installUrlPaths } from "../paths";
import type { FoundationContext } from "./types";

const URL_CLASS = "NSURL";
const SCHEME_SUFFIX = 1;
const PREFIX = 1;
type Component = [string, (url: URL) => string, (value: string) => string];

export function installUrls(ctx: FoundationContext): void {
  const { method, hostClass, h, state, string, text, utf8, retain, destroy } = ctx;
  hostClass(URL_CLASS, "NSObject");
  installUrlPaths({ method, string, urls: state.urls });
  const urlOf = (self: number): URL => {
    const found = state.urls.get(self);
    if (!found) throw new Error("Unknown NSURL");
    return found;
  };
  method(URL_CLASS, true, "fileURLWithPath:", (cls, args) => h.url(h.fileURL(text(args(0))), cls));
  method(URL_CLASS, true, "fileURLWithPath:isDirectory:", (cls, args) =>
    h.url(h.fileURL(text(args(0)) + (args(1) ? "/" : "")), cls),
  );
  method(URL_CLASS, true, "URLWithString:", (cls, args) => {
    try {
      return h.url(new URL(text(args(0))), cls);
    } catch {
      return 0;
    }
  });
  method(URL_CLASS, false, "isFileURL", (self) =>
    Number(state.urls.get(self)?.protocol === "file:"),
  );
  const components: Component[] = [
    ["host", (url) => url.hostname, (value) => value],
    ["scheme", (url) => url.protocol, (value) => value.slice(0, -SCHEME_SUFFIX)],
    ["query", (url) => url.search, (value) => value.slice(PREFIX)],
    ["fragment", (url) => url.hash, (value) => value.slice(PREFIX)],
    ["user", (url) => url.username, (value) => value],
  ];
  for (const [name, pick, strip] of components) {
    method(URL_CLASS, false, name, (self) => {
      const value = pick(urlOf(self));
      return value ? string(strip(value)) : 0;
    });
  }
  method(URL_CLASS, false, "port", (self) =>
    urlOf(self).port ? h.number(Number(urlOf(self).port)) : 0,
  );
  method(URL_CLASS, false, "absoluteString", (self) => string(urlOf(self).href));
  // URLs are stored resolved, so every NSURL is its own absolute URL with no base.
  method(URL_CLASS, false, "absoluteURL", (self) => self);
  method(URL_CLASS, false, "baseURL", () => 0);
  method(URL_CLASS, false, "relativeString", (self) => string(urlOf(self).href));
  method(URL_CLASS, false, "path", (self) => string(decodeURIComponent(urlOf(self).pathname)));
  method(URL_CLASS, false, "fileSystemRepresentation", (self) =>
    utf8(string(decodeURIComponent(urlOf(self).pathname))),
  );
  method(URL_CLASS, false, "URLByAppendingPathComponent:", (self, args) => {
    const result = new URL(urlOf(self));
    const component = text(args(0)).replace(/^\/+/, "");
    result.pathname = `${result.pathname.replace(/\/$/, "")}/${component}`;
    return h.url(result);
  });
  method(URL_CLASS, false, "copy", retain);
  method(URL_CLASS, false, "copyWithZone:", retain);
  method(URL_CLASS, false, "dealloc", (self) => {
    state.urls.delete(self);
    destroy(self);
  });
  installBundleUrls(ctx);
}

function installBundleUrls(ctx: FoundationContext): void {
  const { method, h, ipa, text, send } = ctx;
  method("NSBundle", false, "bundleURL", () => h.url(h.fileURL(`/${ipa.bundlePath}`)));
  method("NSBundle", false, "resourceURL", () => h.url(h.fileURL(`/${ipa.bundlePath}`)));
  method("NSBundle", false, "URLForResource:withExtension:", async (self, args) => {
    const path = await send(self, "pathForResource:ofType:", [args(0), args(1)]);
    return typeof path === "number" && path ? h.url(h.fileURL(text(path))) : 0;
  });
}
