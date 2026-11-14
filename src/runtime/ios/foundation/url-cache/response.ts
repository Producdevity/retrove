import { CACHED_RESPONSE_CLASS, releaseAll, StoragePolicy, type URLCacheHost } from "./host";
interface CachedResponse {
  response: number;
  data: number;
  userInfo: number;
  policy: number;
}
const ArgumentIndex = { Response: 0, Data: 1, UserInfo: 2, Policy: 3 } as const;
export function installCachedResponses(host: URLCacheHost): void {
  host.hostClass(CACHED_RESPONSE_CLASS, "NSObject");
  const records = new Map<number, CachedResponse>();
  async function initialize(
    self: number,
    response: number,
    data: number,
    userInfo: number,
    policy: number,
  ): Promise<number> {
    if (!response || !data)
      throw new Error("NSCachedURLResponse requires response and data objects.");
    if (!Object.values(StoragePolicy).some((value) => value === policy))
      throw new Error("Invalid NSURLCache storage policy.");
    const copies: number[] = [];
    try {
      for (const pointer of [response, data, userInfo])
        copies.push(pointer ? await host.send(pointer, "copy") : 0);
    } catch (error) {
      await releaseAll(host, copies);
      throw error;
    }
    const [ownedResponse, ownedData, ownedInfo] = copies;
    if (ownedResponse === undefined || ownedData === undefined || ownedInfo === undefined)
      throw new Error("Incomplete cached URL response.");
    const previous = records.get(self);
    records.set(self, { response: ownedResponse, data: ownedData, userInfo: ownedInfo, policy });
    if (previous) await releaseAll(host, [previous.response, previous.data, previous.userInfo]);
    return self;
  }
  for (const extended of [false, true])
    host.method(
      CACHED_RESPONSE_CLASS,
      false,
      extended ? "initWithResponse:data:userInfo:storagePolicy:" : "initWithResponse:data:",
      (self, args) =>
        initialize(
          self,
          args(ArgumentIndex.Response),
          args(ArgumentIndex.Data),
          extended ? args(ArgumentIndex.UserInfo) : 0,
          extended ? args(ArgumentIndex.Policy) : StoragePolicy.Allowed,
        ),
    );
  for (const [selector, field] of [
    ["response", "response"],
    ["data", "data"],
    ["userInfo", "userInfo"],
    ["storagePolicy", "policy"],
  ] as const)
    host.method(CACHED_RESPONSE_CLASS, false, selector, (self) => records.get(self)?.[field] ?? 0);
  host.method(CACHED_RESPONSE_CLASS, false, "copy", (self) => host.retain(self));
  host.method(CACHED_RESPONSE_CLASS, false, "dealloc", async (self) => {
    const record = records.get(self);
    records.delete(self);
    if (record) await releaseAll(host, [record.response, record.data, record.userInfo]);
    host.destroy(self);
  });
}
