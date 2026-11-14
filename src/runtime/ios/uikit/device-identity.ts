import type { FoundationHost } from "../objc/host";

const DEVICE_CLASS = "UIDevice";
const LEGACY_IDENTIFIER_PREFIX = "FFFFFFFF";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface DeviceIdentityHost extends Pick<FoundationHost, "method" | "string"> {
  uuid(value?: string): number;
  uuidString(pointer: number): string;
  read(): string | null;
  save(value: string): void;
}
export function installDeviceIdentity(host: DeviceIdentityHost): void {
  let vendor = 0;
  function identifier() {
    if (vendor) return vendor;
    let saved: string | undefined;
    try {
      const value = host.read();
      if (value && UUID_PATTERN.test(value)) saved = value;
    } catch {}
    vendor = host.uuid(saved);
    if (saved === undefined) {
      try {
        host.save(host.uuidString(vendor));
      } catch {}
    }
    return vendor;
  }
  host.method(DEVICE_CLASS, false, "identifierForVendor", identifier);
  host.method(DEVICE_CLASS, false, "uniqueIdentifier", () => {
    const value = host.uuidString(identifier()).replaceAll("-", "").toUpperCase();
    return host.string(LEGACY_IDENTIFIER_PREFIX + value);
  });
}
