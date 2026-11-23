import { at, type Collections } from "./collections";
import { Argument, type CoreFoundationFunction, type CoreFoundationHost } from "./types";

const ARRAY_CLASS = "CFMutableArray";
const DICTIONARY_CLASS = "CFMutableDictionary";

export function collectionFunctions(
  host: CoreFoundationHost,
  collections: Collections,
): Record<string, CoreFoundationFunction> {
  for (const className of [ARRAY_CLASS, DICTIONARY_CLASS]) {
    host.method(className, false, "count", (self) => collections.count(self));
    host.method(className, false, "dealloc", (self) => collections.dealloc(self));
  }
  host.method(ARRAY_CLASS, false, "objectAtIndex:", (self, a) =>
    at(collections.arrayState(self)?.list ?? [], a(0)),
  );
  host.method(ARRAY_CLASS, false, "addObject:", (self, a) => collections.appendArray(self, a(0)));
  host.method(ARRAY_CLASS, false, "removeObjectAtIndex:", (self, a) =>
    collections.removeArray(self, a(0)),
  );
  host.method(DICTIONARY_CLASS, false, "objectForKey:", (self, a) =>
    collections.dictionaryValue(self, a(0)),
  );
  host.method(DICTIONARY_CLASS, false, "setObject:forKey:", (self, a) =>
    collections.changeDictionary(self, a(1), a(0), true),
  );
  host.method(DICTIONARY_CLASS, false, "removeObjectForKey:", (self, a) =>
    collections.changeDictionary(self, a(0), 0),
  );
  const rangeIndex = (a: (index: number) => number): Promise<number> =>
    collections.find(
      a(0),
      collections.array(a(0)),
      a(1) | 0,
      a(Argument.Third) | 0,
      a(Argument.Fourth),
    );
  return {
    _CFArrayCreateMutable: (a) => collections.create(ARRAY_CLASS, a, false),
    _CFArrayGetCount: (a) => collections.array(a(0)).length,
    _CFArrayGetValueAtIndex: (a) => at(collections.array(a(0)), a(1)),
    _CFArrayAppendValue: (a) => collections.appendArray(a(0), a(1)),
    _CFArrayRemoveValueAtIndex: (a) => collections.removeArray(a(0), a(1)),
    _CFArrayGetFirstIndexOfValue: rangeIndex,
    _CFArrayContainsValue: async (a) => Number((await rangeIndex(a)) >= 0),
    _CFDictionaryCreateMutable: (a) => collections.create(DICTIONARY_CLASS, a, true),
    _CFDictionarySetValue: (a) => collections.changeDictionary(a(0), a(1), a(Argument.Third), true),
    _CFDictionaryGetValue: (a) => collections.dictionaryValue(a(0), a(1)),
    _CFDictionaryRemoveValue: (a) => collections.changeDictionary(a(0), a(1), 0),
    _CFDictionaryAddValue: (a) => collections.changeDictionary(a(0), a(1), a(Argument.Third)),
  };
}
