import type { FoundationHost } from "../objc/host";
interface PathHost {
  method: FoundationHost["method"];
  string: FoundationHost["string"];
  urls: ReadonlyMap<number, URL>;
}
export function lastPathComponent(url: URL): string {
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  if (!path) return url.pathname ? "/" : "";
  return path.slice(path.lastIndexOf("/") + 1);
}
export function pathExtension(url: URL): string {
  const component = lastPathComponent(url);
  const separator = component.lastIndexOf(".");
  return separator > 0 ? component.slice(separator + 1) : "";
}
export function installUrlPaths(host: PathHost): void {
  const methods = { lastPathComponent, pathExtension };
  for (const [name, read] of Object.entries(methods)) {
    host.method("NSURL", false, name, (self) => {
      const url = host.urls.get(self);
      if (!url) throw new Error("NSURL has no initialized URL.");
      return host.string(read(url));
    });
  }
}
