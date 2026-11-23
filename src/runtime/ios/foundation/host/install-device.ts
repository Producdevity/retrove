import { installPlatformVersions } from "../../platform";
import { installDeviceIdentity } from "../../uikit/device-identity";
import { DeviceOrientation, OrientationName } from "./constants";
import { vendorIdentifierKey } from "./identity";
import type { FoundationContext } from "./types";

const DEVICE = "UIDevice";

export function installDevice(ctx: FoundationContext): void {
  const { method, h, string } = ctx;
  ctx.hostClass(DEVICE, "NSObject");
  const vendorKey = vendorIdentifierKey(ctx.ipa);
  installDeviceIdentity({
    method,
    string,
    uuid: h.newUUID,
    uuidString: h.uuidString,
    read: () => globalThis.localStorage?.getItem(vendorKey) ?? null,
    save: (value) => {
      globalThis.localStorage?.setItem(vendorKey, value);
    },
  });
  method(DEVICE, true, "currentDevice", h.singleton(DEVICE));
  installPlatformVersions({ method, string });
  method(DEVICE, false, "model", () => string("iPhone"));
  method(DEVICE, false, "userInterfaceIdiom", () => 0);
  let orientationRequests = 0;
  method(DEVICE, false, "beginGeneratingDeviceOrientationNotifications", () => {
    orientationRequests++;
  });
  method(DEVICE, false, "endGeneratingDeviceOrientationNotifications", () => {
    orientationRequests = Math.max(0, orientationRequests - 1);
  });
  method(DEVICE, false, "isGeneratingDeviceOrientationNotifications", () =>
    Number(orientationRequests > 0),
  );
  method(DEVICE, false, "orientation", () => {
    if (!orientationRequests) return DeviceOrientation.Unknown;
    const type = globalThis.screen?.orientation?.type;
    return (type === undefined ? undefined : OrientationName[type]) ?? DeviceOrientation.Unknown;
  });
}
