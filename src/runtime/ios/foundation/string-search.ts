import { WORD_BYTES } from "../abi/scalars";
import type { FoundationHost, GuestArguments } from "../objc/host";
import type { CharacterSet } from "./character-set";
import type { CharacterSets } from "./character-set-host";

export const SearchOption = { Backwards: 4, Anchored: 8 } as const;
export const NOT_FOUND = 0x7fffffff;
const SearchArgument = { Set: 0, Options: 1, Location: 2, Length: 3 } as const;
interface SearchRange {
  location: number;
  length: number;
}
export function characterRange(
  value: string,
  set: CharacterSet,
  options = 0,
  start = 0,
  length = value.length,
): SearchRange {
  const end = start + length;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    end > value.length
  )
    throw Error("NSString search range exceeds bounds");
  const backwards = Boolean(options & SearchOption.Backwards),
    anchored = Boolean(options & SearchOption.Anchored);
  let location = start,
    result = { location: NOT_FOUND, length: 0 };
  for (const character of value.slice(start, end)) {
    const atAnchor =
      !anchored || (backwards ? location + character.length === end : location === start);
    if (atAnchor && set.contains(character)) {
      result = { location, length: character.length };
      if (!backwards) return result;
    }
    location += character.length;
  }
  return result;
}
interface SearchHost extends Pick<FoundationHost, "text" | "write"> {
  structureMethod(
    selector: string,
    implementation: (self: number, args: GuestArguments, destination: number) => void,
  ): void;
}
export function installStringSearch(host: SearchHost, sets: CharacterSets): void {
  for (const [selector, options, ranged] of [
    ["rangeOfCharacterFromSet:", false, false],
    ["rangeOfCharacterFromSet:options:", true, false],
    ["rangeOfCharacterFromSet:options:range:", true, true],
  ] as const) {
    host.structureMethod(selector, (self, args, destination) => {
      const pointer = args(SearchArgument.Set);
      if (!pointer) throw Error("NSString character search requires an NSCharacterSet");
      const value = host.text(self);
      const result = characterRange(
        value,
        sets.get(pointer),
        options ? args(SearchArgument.Options) : 0,
        ranged ? args(SearchArgument.Location) : 0,
        ranged ? args(SearchArgument.Length) : value.length,
      );
      host.write(destination, result.location);
      host.write(destination + WORD_BYTES, result.length);
    });
  }
}
