import { NIL_UUID } from "./constants";
import type { FoundationContext } from "./types";

export function installUuids(ctx: FoundationContext): void {
  const { method, hostClass, h, string, autorelease, retain, destroy } = ctx;
  hostClass("NSUUID", "NSObject");
  method("NSUUID", true, "UUID", () => autorelease(h.newUUID()));
  method("NSUUID", false, "UUIDString", (self) => string(h.uuidString(self)));
  method("NSUUID", false, "copy", retain);
  method("NSUUID", false, "dealloc", (self) => {
    h.forgetUUID(self);
    destroy(self);
  });
  hostClass("ASIdentifierManager", "NSObject");
  let noAdvertisingId: number | undefined;
  method("ASIdentifierManager", true, "sharedManager", h.singleton("ASIdentifierManager"));
  method("ASIdentifierManager", false, "isAdvertisingTrackingEnabled", () => 0);
  method("ASIdentifierManager", false, "advertisingTrackingEnabled", () => 0);
  method("ASIdentifierManager", false, "advertisingIdentifier", () => {
    noAdvertisingId ??= h.newUUID(NIL_UUID);
    return noAdvertisingId;
  });
}
