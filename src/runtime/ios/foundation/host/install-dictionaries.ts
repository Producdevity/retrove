import { Argument } from "../../objc/host";
import { installCollectionEquality } from "../collection-equality";
import { installCollectionInitializers } from "../collections";
import { installDictionaryArrays } from "../dictionaries";
import { pointer as objectPointer } from "../operations/host";
import { BYTES_PER_WORD, PAIR_STEP } from "./constants";
import type { FoundationContext } from "./types";

const DICTIONARY = "NSDictionary";
const MUTABLE_DICTIONARY = "NSMutableDictionary";
type Pair = [number, number];

export function installDictionaries(ctx: FoundationContext): void {
  const { method, hostClass, h, send, items, read, autorelease } = ctx;
  hostClass(DICTIONARY, "NSObject");
  hostClass(MUTABLE_DICTIONARY, DICTIONARY);
  installCollectionInitializers({ method });
  installCollectionEquality({
    method,
    isKind: ctx.isKind,
    send,
    items,
    entries: (pointer) => ctx.getCFEntries?.(pointer) ?? h.entries(pointer),
  });
  installDictionaryArrays({
    method,
    autorelease,
    release: ctx.release,
    items,
    dictionary: h.dictionary,
    copyKey: async (pointer) => objectPointer(await send(pointer, "copy")),
  });
  method(DICTIONARY, true, "dictionary", (cls) => autorelease(h.dictionary(cls, [])));
  method(MUTABLE_DICTIONARY, true, "dictionaryWithCapacity:", (cls) =>
    autorelease(h.dictionary(cls, [])),
  );
  method(DICTIONARY, true, "dictionaryWithObject:forKey:", (cls, args) =>
    autorelease(h.dictionary(cls, [[args(1), args(0)]])),
  );
  method(DICTIONARY, true, "dictionaryWithObjects:forKeys:count:", (cls, args) => {
    const pairs = Array.from({ length: args(Argument.Third) }, (_, index): Pair => {
      const offset = index * BYTES_PER_WORD;
      return [read(args(1) + offset), read(args(0) + offset)];
    });
    return autorelease(h.dictionary(cls, pairs));
  });
  method(DICTIONARY, true, "dictionaryWithObjectsAndKeys:", (cls, args) => {
    const pairs: Pair[] = [];
    for (let index = 0; args(index); index += PAIR_STEP) pairs.push([args(index + 1), args(index)]);
    return autorelease(h.dictionary(cls, pairs));
  });
  installDictionaryAccess(ctx);
}

function installDictionaryAccess(ctx: FoundationContext): void {
  const { method, state, h, autorelease } = ctx;
  const pairsOf = (self: number): Pair[] => Array.from(state.dicts.get(self)?.values() ?? []);
  method(DICTIONARY, false, "initWithDictionary:", (self, args) => {
    for (const [key, value] of pairsOf(args(0))) void h.associated(self, key, value);
    return self;
  });
  method(MUTABLE_DICTIONARY, false, "addEntriesFromDictionary:", async (self, args) => {
    for (const [key, value] of pairsOf(args(0))) await h.associated(self, key, value);
  });
  method(MUTABLE_DICTIONARY, false, "removeAllObjects", async (self) => {
    for (const [key] of pairsOf(self)) await h.associated(self, key, 0);
  });
  method(DICTIONARY, true, "dictionaryWithDictionary:", (cls, args) =>
    autorelease(h.dictionary(cls, pairsOf(args(0)))),
  );
  for (const name of ["objectForKey:", "objectForKeyedSubscript:", "valueForKey:"]) {
    method(DICTIONARY, false, name, (self, args) => h.get(self, args(0)));
  }
  method(DICTIONARY, false, "objectsForKeys:notFoundMarker:", (self, args) => {
    const marker = args(1);
    const found = ctx.items(args(0)).map((key) => h.get(self, key) || marker);
    return autorelease(ctx.array(found));
  });
  method(DICTIONARY, false, "allValues", (self) =>
    autorelease(ctx.array(pairsOf(self).map((pair) => pair[1]))),
  );
  method(DICTIONARY, false, "allKeys", (self) =>
    autorelease(ctx.array(pairsOf(self).map((pair) => pair[0]))),
  );
  method(DICTIONARY, false, "count", (self) => state.dicts.get(self)?.size ?? 0);
  method(DICTIONARY, false, "countByEnumeratingWithState:objects:count:", (self, args) =>
    state.enumeration.read(
      self,
      args(0),
      args(1),
      args(Argument.Third),
      pairsOf(self).map((pair) => pair[0]),
    ),
  );
  method(DICTIONARY, false, "copy", (self) =>
    h.dictionary(h.classPointer(DICTIONARY), pairsOf(self)),
  );
  method(DICTIONARY, false, "mutableCopy", (self) =>
    h.dictionary(h.classPointer(MUTABLE_DICTIONARY), pairsOf(self)),
  );
  installDictionaryMutation(ctx);
}

function installDictionaryMutation(ctx: FoundationContext): void {
  const { method, state, h } = ctx;
  for (const name of ["setObject:forKey:", "setObject:forKeyedSubscript:", "setValue:forKey:"]) {
    method(MUTABLE_DICTIONARY, false, name, (self, args) => h.associated(self, args(1), args(0)));
  }
  method(MUTABLE_DICTIONARY, false, "removeObjectForKey:", (self, args) =>
    h.associated(self, args(0), 0),
  );
  method(DICTIONARY, false, "dealloc", async (self) => {
    const entries = state.dicts.get(self);
    state.dicts.delete(self);
    state.enumeration.destroy(self);
    for (const [key, value] of entries?.values() ?? []) {
      await ctx.release(key);
      await ctx.release(value);
    }
    ctx.destroy(self);
  });
}
