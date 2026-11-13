import { Argument, FoundationClass, type FoundationHost } from "../objc/host";
import { CharacterSet } from "./character-set";

export interface CharacterSets {
  get(pointer: number): CharacterSet;
  create(set: CharacterSet): number;
}
export function installCharacterSets(host: FoundationHost): CharacterSets {
  const sets = new Map<number, CharacterSet>();
  const classPointer = host.hostClass(FoundationClass.CharacterSet, FoundationClass.Object);
  const create = (set: CharacterSet): number => {
    const pointer = host.alloc(classPointer);
    sets.set(pointer, set);
    return pointer;
  };
  const get = (pointer: number): CharacterSet => {
    if (!pointer) return CharacterSet.empty();
    const set = sets.get(pointer);
    if (!set) throw new Error("Expected an NSCharacterSet.");
    return set;
  };
  const classMethod = (selector: string, make: () => CharacterSet): void => {
    host.method(FoundationClass.CharacterSet, true, selector, () =>
      host.autorelease(create(make())),
    );
  };
  classMethod("decimalDigitCharacterSet", () => CharacterSet.decimal());
  classMethod("whitespaceCharacterSet", () => CharacterSet.whitespace());
  classMethod("whitespaceAndNewlineCharacterSet", () => CharacterSet.whitespaceAndNewline());
  host.method(
    FoundationClass.CharacterSet,
    true,
    "characterSetWithCharactersInString:",
    (_self, args) =>
      host.autorelease(create(CharacterSet.characters(host.text(args(Argument.First))))),
  );
  host.method(FoundationClass.CharacterSet, false, "characterIsMember:", (self, args) =>
    Number(get(self).contains(String.fromCharCode(args(Argument.First)))),
  );
  host.method(FoundationClass.CharacterSet, false, "longCharacterIsMember:", (self, args) =>
    Number(get(self).contains(String.fromCodePoint(args(Argument.First)))),
  );
  host.method(FoundationClass.CharacterSet, false, "invertedSet", (self) =>
    host.autorelease(create(get(self).inverted())),
  );
  host.method(FoundationClass.CharacterSet, false, "copyWithZone:", (self) => host.retain(self));
  host.method(FoundationClass.CharacterSet, false, "copy", (self) => host.retain(self));
  host.method(FoundationClass.CharacterSet, false, "dealloc", (self) => {
    sets.delete(self);
    host.destroy(self);
  });
  return { create, get };
}
