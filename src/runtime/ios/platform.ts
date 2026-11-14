import type { FoundationHost } from "./objc/host";
export const IOSPlatform = {
  Name: "iPhone OS",
  Version: "7.1",
  Model: "iPhone5,1",
  NodeName: "localhost",
  KernelName: "Darwin",
  KernelRelease: "14.0.0",
  KernelVersion: "Retrove iOS compatibility runtime",
} as const;
export function installPlatformVersions(host: Pick<FoundationHost, "method" | "string">): void {
  host.method("UIDevice", false, "systemName", () => host.string(IOSPlatform.Name));
  host.method("UIDevice", false, "systemVersion", () => host.string(IOSPlatform.Version));
  host.method("NSProcessInfo", false, "operatingSystemVersionString", () =>
    host.string(IOSPlatform.Name + " " + IOSPlatform.Version),
  );
}
