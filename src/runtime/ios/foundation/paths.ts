import { Argument, type FoundationHost } from "../objc/host";
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

export function appendPathExtension(path: string, extension: string): string | undefined {
  if (!extension) return path;
  const base = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!base || extension.includes("/")) return undefined;
  return base + "." + extension;
}
const PATH_SEPARATOR = "/";
export function pathComponents(path: string): string[] {
  const components = path.split(PATH_SEPARATOR).filter((part) => part.length > 0);
  if (path.startsWith(PATH_SEPARATOR)) components.unshift(PATH_SEPARATOR);
  if (path.endsWith(PATH_SEPARATOR) && path.length > PATH_SEPARATOR.length)
    components.push(PATH_SEPARATOR);
  return components;
}
export function pathWithComponents(components: readonly string[]): string {
  const path = components
    .filter((component) => component.length > 0)
    .join(PATH_SEPARATOR)
    .replace(/\/+/g, PATH_SEPARATOR);
  return path.length > PATH_SEPARATOR.length ? path.replace(/\/$/, "") : path;
}
interface StringPathHost extends Pick<
  FoundationHost,
  "method" | "string" | "text" | "autorelease"
> {
  array(values: readonly number[]): number;
  items(pointer: number): readonly number[];
}
export function installStringPaths(host: StringPathHost): void {
  host.method("NSString", true, "pathWithComponents:", (_, args) =>
    host.string(pathWithComponents(host.items(args(0)).map((pointer) => host.text(pointer)))),
  );

  host.method("NSString", false, "pathComponents", (self) =>
    host.autorelease(
      host.array(pathComponents(host.text(self)).map((value) => host.string(value))),
    ),
  );

  host.method("NSString", false, "stringByAppendingPathExtension:", (self, args) => {
    const result = appendPathExtension(host.text(self), host.text(args(Argument.First)));
    return result === undefined ? 0 : host.string(result);
  });
}
