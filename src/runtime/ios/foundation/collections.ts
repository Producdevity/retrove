import type { FoundationHost } from "../objc/host";
const MUTABLE_COLLECTIONS = ["NSMutableArray", "NSMutableSet", "NSMutableDictionary"] as const;
export function installCollectionInitializers(host: Pick<FoundationHost, "method">): void {
  for (const cls of MUTABLE_COLLECTIONS)
    host.method(cls, false, "initWithCapacity:", (self) => self);
}
