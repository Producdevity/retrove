import { bitVectorFunctions } from "./bit-vectors";
import { collectionFunctions } from "./core-foundation/collection-functions";
import { Collections } from "./core-foundation/collections";
import { dataSymbols } from "./core-foundation/data-symbols";
import { numberValue } from "./core-foundation/number-value";
import { percentFunctions } from "./core-foundation/percent";
import { stringFunctions } from "./core-foundation/strings";
import { uuidFunctions } from "./core-foundation/uuid";
import type { CoreFoundation, CoreFoundationHost } from "./core-foundation/types";

export type { CoreFoundation, CoreFoundationHost } from "./core-foundation/types";
const MUTABLE_STRING_SIZE = 16;
const UUID_SIZE = 20;

export function coreFoundation(host: CoreFoundationHost): CoreFoundation {
  host.hostClass("CFMutableArray", "NSMutableArray");
  host.hostClass("CFMutableDictionary", "NSMutableDictionary");
  host.hostClass("CFUUID", "NSObject", UUID_SIZE);
  host.hostClass("NSMutableString", "NSString", MUTABLE_STRING_SIZE);
  const resolveData = dataSymbols(host);
  const collections = new Collections(host);
  return {
    funcs: {
      ...bitVectorFunctions({
        ...host,
        string: host.makeString,
        readBytes: (pointer, count) => host.cpu.read(pointer, count),
      }),
      ...collectionFunctions(host, collections),
      _CFNumberGetValue: numberValue(host.cpu, host.foundation),
      _CFMakeCollectable: (a) => a(0),
      _CFRunLoopGetCurrent: () => host.getRunLoop(),
      ...stringFunctions(host),
      ...percentFunctions(host),
      ...uuidFunctions(host),
    },
    resolveData,
    dictionaryEntries: (pointer) => collections.entries(pointer),
  };
}
