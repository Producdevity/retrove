const PROXY_CLASS = "NSProxy";
const OBJECT_CLASS = "NSObject";
interface ProxyHost {
  hostClass(name: string, parent: string): number;
  copyMethod(target: string, source: string, classMethod: boolean, selector: string): void;
}
export function installRootProxy(host: ProxyHost): void {
  host.hostClass(PROXY_CLASS, "");
  for (const selector of ["alloc", "allocWithZone:", "class", "self"])
    host.copyMethod(PROXY_CLASS, OBJECT_CLASS, true, selector);
  for (const selector of [
    "retain",
    "release",
    "autorelease",
    "retainCount",
    "dealloc",
    "class",
    "superclass",
    "self",
    "hash",
  ])
    host.copyMethod(PROXY_CLASS, OBJECT_CLASS, false, selector);
}
