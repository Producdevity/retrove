import { FastEnumeration } from "./fast-enumeration";
import { createHelpers } from "./host/helpers";
import { installDevice } from "./host/install-device";
import { installDictionaries } from "./host/install-dictionaries";
import { installEnumerators } from "./host/install-enumerators";
import { installUuids } from "./host/install-identifiers";
import { installLocales, installNullAndJson } from "./host/install-json-locale";
import { installNotifications } from "./host/install-notifications";
import { installNumberHosts } from "./host/install-numbers";
import { installConnections, installResponses } from "./host/install-responses";
import { installOperationService, installRequestObjects } from "./host/install-requests";
import { installProcessInfo, installServices } from "./host/install-services";
import { installStrings } from "./host/install-strings";
import { installThreads } from "./host/install-threads";
import { installUrls } from "./host/install-urls";
import { installWebViews } from "./host/install-web-views";
import {
  Late,
  type FoundationBase,
  type FoundationContext,
  type FoundationParams,
} from "./host/types";
import { RunLoopMode } from "./ports";

function createBase(params: FoundationParams): FoundationBase {
  const { read, write, heap } = params;
  return {
    ...params,
    method: params.method,
    structureMethod: params.method,
    diagnostic: params.diagnostic ?? (() => undefined),
    state: {
      dicts: new Map(),
      numbers: new Map(),
      urls: new Map(),
      requests: new Map(),
      responses: new Map(),
      requestProperties: new Map(),
      mainRequests: [],
      enumeration: new FastEnumeration({
        read,
        write,
        allocate: (bytes) => heap.zero(bytes),
        free: (pointer) => heap.free(pointer),
      }),
    },
    late: { dates: new Late("dates"), decimals: new Late("decimal numbers") },
  };
}

function installAll(ctx: FoundationContext) {
  installNumberHosts(ctx);
  installDictionaries(ctx);
  installEnumerators(ctx);
  installNullAndJson(ctx);
  installLocales(ctx);
  installStrings(ctx);
  installServices(ctx);
  installProcessInfo(ctx);
  installUrls(ctx);
  installUuids(ctx);
  installWebViews(ctx);
  const operations = installOperationService(ctx);
  installRequestObjects(ctx);
  installResponses(ctx);
  const connections = installConnections(ctx, operations);
  installDevice(ctx);
  const { threadIdentity } = installThreads(ctx);
  installNotifications(ctx);
  return { operations, connections, threadIdentity };
}

/** Foundation objects shared by the guest's UIKit bootstrap and property lists. */
export function foundation(params: FoundationParams) {
  const base = createBase(params);
  const ctx: FoundationContext = { ...base, h: createHelpers(base) };
  const { operations, connections, threadIdentity } = installAll(ctx);
  const { h, state } = ctx;
  const dates = ctx.late.dates.get();
  return {
    threadIdentity,
    archiveNumber: (pointer: number) => state.numbers.get(pointer),
    archiveDate: dates.referenceTime,
    archiveEntries: h.entries,
    setArchivedNumber: (pointer: number, value: boolean | number | bigint) => {
      state.numbers.set(pointer, value);
    },
    setArchivedDate: dates.setReferenceTime,
    property: h.property,
    formatted: h.formatted,
    description: h.description,
    unbox: h.unbox,
    get: h.get,
    dictionary: h.dictionary,
    number: h.number,
    associated: h.associated,
    newUUID: h.newUUID,
    uuidString: h.uuidString,
    pollConnections: (loop: number, mode: string) => connections.pump(loop, mode),
    operationsChanged: (self: number) => operations.changed(self),
    pending: () => state.mainRequests.length + connections.pending() + operations.pending(),
    async pollMain(): Promise<void> {
      await operations.pump(true);
      await connections.pump(ctx.getRunLoop(1), RunLoopMode.Default);
      for (const request of state.mainRequests.splice(0)) await request();
    },
  };
}
