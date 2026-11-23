import { readString } from "../../../memory/guest-memory";
import { comparisonOrder, mergeSorted } from "./sorting";
import type { FoundationContext } from "./types";

interface EnumeratorState {
  at: number;
  list: number[];
}

export function installEnumerators(ctx: FoundationContext): void {
  const { method, hostClass, h, state, ipa, text } = ctx;
  method("NSBundle", false, "infoDictionary", () => h.property(ipa.info));
  method("NSBundle", false, "objectForInfoDictionaryKey:", (_, args) =>
    h.property(ipa.info[text(args(0))]),
  );
  hostClass("NSEnumerator", "NSObject");
  const enumerators = new Map<number, EnumeratorState>();
  const lookupEnumerator = (self: number): EnumeratorState => {
    const found = enumerators.get(self);
    if (!found) throw new Error("Unknown NSEnumerator");
    return found;
  };
  const enumerate = (list: readonly number[]): number => {
    const pointer = ctx.alloc(h.classPointer("NSEnumerator"));
    enumerators.set(pointer, { at: 0, list: list.map((item) => ctx.retain(item)) });
    return ctx.autorelease(pointer);
  };
  method("NSEnumerator", false, "nextObject", (self) => {
    const found = lookupEnumerator(self);
    return found.list[found.at++] ?? 0;
  });
  method("NSEnumerator", false, "dealloc", async (self) => {
    const found = lookupEnumerator(self);
    enumerators.delete(self);
    for (const value of found.list) await ctx.release(value);
    ctx.destroy(self);
  });
  const pairsOf = (self: number) => Array.from(state.dicts.get(self)?.values() ?? []);
  method("NSDictionary", false, "keyEnumerator", (self) =>
    enumerate(pairsOf(self).map((pair) => pair[0])),
  );
  method("NSDictionary", false, "objectEnumerator", (self) =>
    enumerate(pairsOf(self).map((pair) => pair[1])),
  );
  installArraySorting(ctx, enumerate);
}

function installArraySorting(
  ctx: FoundationContext,
  enumerate: (list: readonly number[]) => number,
): void {
  const { method, h, cpu, items, autorelease, send } = ctx;
  const sorted = (list: readonly number[], selector: string) =>
    mergeSorted(list, async (left, right) => comparisonOrder(await send(left, selector, [right])));
  method("NSArray", false, "sortedArrayUsingSelector:", async (self, args) =>
    autorelease(ctx.array(await sorted(items(self), readString(cpu, args(0))))),
  );
  method("NSMutableArray", false, "sortUsingSelector:", async (self, args) => {
    const list = items(self);
    const result = await sorted(list, readString(cpu, args(0)));
    list.splice(0, list.length, ...result);
  });
  method("NSArray", false, "componentsJoinedByString:", (self, args) =>
    ctx.string(
      items(self)
        .map(h.description)
        .join(ctx.text(args(0))),
    ),
  );
  method("NSArray", false, "objectEnumerator", (self) => enumerate(items(self)));
  method("NSArray", false, "reverseObjectEnumerator", (self) =>
    enumerate([...items(self)].reverse()),
  );
}
